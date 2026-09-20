import { test } from "node:test";
import assert from "node:assert/strict";
import {
  host,
  hostPath,
  hostBuildDirectory,
  requireHostTool,
  assertSystemLibraries,
  hostToolCommand,
} from "../host.ts";
import { mkdtemp, mkdir, symlink, writeFile, readFile, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseOptions } from "../options.ts";
import { hostHermesPlan, shermesPath } from "../host-hermes.ts";
import { hostPerryPlan } from "../host-perry.ts";

test("host Perry isolates sources and preserves LLVM intermediates", () => {
  const plan = hostPerryPlan({ tool: "perry" }, "json");
  assert.ok(plan.some((s) => s.argv.includes("/src/json.js")));
  const compile = plan.find((s) => s.argv[0] === "perry")!;
  assert.equal(compile.cwd, "/out/intermediates");
  for (const arg of ["/out/intermediates/json.js", "--no-cache", "--keep-intermediates", "llvm"])
    assert.ok(compile.argv.includes(arg));
  assert.ok(plan.every((s) => !s.argv.some((arg) => arg.includes("/tmp/workload"))));
});

test("host Hermes uses the mise compiler, static VM linking and intermediates", () => {
  const root = "/my project";
  const plan = hostHermesPlan(root, { tool: "static_hermes" }, "primes");
  assert.ok(plan.every((step) => step.argv[0] === shermesPath(root)));
  assert.ok(plan.some((step) => step.argv.includes("-static-link")));
  assert.ok(plan.every((step) => !step.argv.some((arg) => arg.startsWith("-Wc,"))));
  assert.ok(plan.some((step) => step.argv.includes("/out/out.c")));
  assert.ok(plan.some((step) => step.stdout === "/out/out.ir"));
  assert.ok(plan.every((step) => step.argv.includes("/src/primes.js")));
});

test("host typed AOT variants select typed source files", () => {
  assert.ok(
    hostPerryPlan({ tool: "perry", language: "typescript" }, "primes").some((step) =>
      step.argv.includes("/src/primes.ts"),
    ),
  );
  const flow = hostHermesPlan(
    "/project",
    { tool: "static_hermes", language: "flow" },
    "primes",
  );
  assert.ok(flow.every((step) => step.argv.includes("-typed")));
  assert.ok(flow.every((step) => step.argv.includes("/src/primes.flow.js")));
});

test("host AOT commands use mise Porffor and workspace scriptc", () => {
  requireHostTool("porffor");
  assert.deepEqual(hostToolCommand("porffor"), ["porf"]);
  for (const tool of ["scriptc"]) {
    requireHostTool(tool);
    const command = hostToolCommand(tool);
    assert.equal(command[0], process.execPath);
    assert.ok(command[1].includes("node_modules/"));
    assert.ok(command[1].endsWith("/scriptc/dist/bootstrap.js"));
  }
  assert.deepEqual(hostToolCommand("node"), [process.execPath]);
  requireHostTool("perry");
  assert.equal(hostToolCommand("perry")[0], process.execPath);
  assert.ok(hostToolCommand("perry")[1].endsWith("/@perryts/perry/bin/perry.js"));
  assert.throws(() => requireHostTool("unknown"), /not implemented/);
});

test("Node SEA rejects non-system library dependencies", () => {
  assertSystemLibraries(
    "node:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n\t/System/Library/Frameworks/Security.framework/Security (compatibility version 1.0.0)",
  );
  for (const path of [
    "/nix/store/example/lib/libssl.dylib",
    "/opt/homebrew/lib/libssl.dylib",
    "@rpath/libssl.dylib",
  ])
    assert.throws(
      () => assertSystemLibraries(`node:\n\t${path} (compatibility version 1.0.0)`),
      /non-system/,
    );
  assert.throws(() => assertSystemLibraries("node:"), /Could not inspect/);
});

test("host is opt-in and keeps outputs separate", () => {
  assert.equal(parseOptions(["bench"]).backend, "docker");
  assert.equal(parseOptions(["bench", "--backend", "host"]).backend, "host");
  assert.throws(() => parseOptions(["bench", "--backend", "unknown"]));
  assert.equal(
    hostBuildDirectory("/project"),
    `/project/build/host-${process.platform}-${process.arch}`,
  );
});
test("host compiler paths preserve nested generated sources and spaces", () => {
  assert.equal(
    hostPath("/out/src/primes.js", "/my project/src", "/my project/out"),
    "/my project/out/src/primes.js",
  );
  assert.equal(
    hostPath('{"main":"/src/hello.js","output":"/out/out.blob"}', "/p/src", "/p/out"),
    '{"main":"/p/src/hello.js","output":"/p/out/out.blob"}',
  );
  requireHostTool("node");
  requireHostTool("static_hermes");
});

test(
  "host shares the runner, validates output and cleans temporary inputs in both modes",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "native-js-host-test-"));
    try {
      await mkdir(join(root, "src"));
      await writeFile(join(root, "src", "hello.js"), 'console.log("hello");\n');
      await symlink(fileURLToPath(new URL("../", import.meta.url)), join(root, "scripts"));
      for (const mode of ["process", "in-process"]) {
        await host(
          root,
          parseOptions([
            "bench",
            "--backend",
            "host",
            "--tool",
            "node-source",
            "--samples",
            "2",
            "--warmup",
            "1",
            "--mode",
            mode,
            ...(mode === "in-process" ? ["--iterations", "3"] : []),
          ]),
        );
        const report = JSON.parse(
          await readFile(
            join(hostBuildDirectory(root), `bench-${mode}-node-source-hello`, "result.json"),
            "utf8",
          ),
        );
        assert.equal(report.inputStorage, "host-local");
        assert.equal(report.result.trim(), "hello");
        assert.equal(report.samplesMs.length, 3);
        assert.equal(report.platform, "darwin");
        await assert.rejects(access(report.inputPaths.temporary));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
