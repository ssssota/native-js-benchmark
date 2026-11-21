import { test } from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compilePlan } from "../compilers/index.ts";
import { parseOptions } from "../options.ts";
import { variantName } from "../variants.ts";
import { hostOseoPlan, oseoDirectory } from "../host-oseo.ts";

const { compileOseo } = await import(new URL("../oseo-compile.mjs", import.meta.url).href);

test("Oseo selects JS/TypeScript and uses the same retaining adapter on both backends", () => {
  const variants = parseOptions(["compile", "--variants", "--tool", "oseo"]).selected;
  assert.deepEqual(variants.map(variantName), ["oseo", "oseo-typescript"]);
  for (const variant of variants) {
    const extension = "language" in variant ? "ts" : "js";
    const docker = compilePlan(variant, "hello");
    assert.deepEqual(docker[0].argv, [
      "node",
      "/opt/oseo-compile.mjs",
      "/opt/oseo",
      `/src/hello.${extension}`,
      "/out/out",
    ]);
    assert.deepEqual(hostOseoPlan("/my project", variant, "hello")[0].argv, [
      "node",
      "/my project/scripts/oseo-compile.mjs",
      oseoDirectory("/my project"),
      `/src/hello.${extension}`,
      "/out/out",
    ]);
  }
  assert.throws(() => parseOptions(["bench", "--tool", "oseo", "--execution", "source"]));
});

for (const fail of [false, true]) {
  test(`Oseo adapter ${fail ? "propagates compile diagnostics and removes a stale binary" : "retains the executable and intermediates without running the workload"}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "native-js-oseo-test-"));
    try {
      const output = join(directory, "out");
      const generated = join(directory, "program.c");
      const executable = join(directory, "native-program");
      await writeFile(output, "stale binary");
      const invoked: string[] = [];
      const host = {
        async run(request: { command: string }) {
          invoked.push(request.command);
          assert.equal(request.command, "zig", "The workload must not run during compilation.");
          return { exitStatus: 0, stdout: "", stderr: "" };
        },
      };
      const target = { name: "macos-aarch64", sanitizers: ["address", "undefined"] };
      const cli = {
        defaultComponents: {
          toolchain: {
            createBuildPlan(input: { target: unknown }) {
              assert.deepEqual(input.target, target);
              return { executablePath: executable };
            },
          },
        },
        async runNativeCli(request: { args: string[] }, compilerHost: typeof host, toolchain: any) {
          assert.equal(request.args[0], "build");
          if (request.args.includes("--dump-mir"))
            return { exitStatus: 0, stdout: "MIR", stderr: "" };
          if (fail)
            return { exitStatus: 1, stdout: "", stderr: "error[OSEO1001]: unsupported source" };
          await writeFile(generated, "generated C");
          toolchain.createBuildPlan({ generatedSourcePath: generated, target });
          await compilerHost.run({ command: "zig" });
          assert.deepEqual(request.args.slice(1), [
            "--build-config",
            "checked",
            "--output",
            output,
            "hello.ts",
          ]);
          await rm(generated);
          await writeFile(output, "native binary");
          await chmod(output, 0o755);
          return { exitStatus: 0, stdout: "", stderr: "" };
        },
      };
      const compiled = compileOseo({ cli, host, version: "test", source: "hello.ts", output });
      if (fail) {
        await assert.rejects(compiled, /OSEO1001/);
        await assert.rejects(access(output));
      } else {
        await compiled;
        assert.deepEqual(invoked, ["zig"]);
        assert.equal(await readFile(output, "utf8"), "native binary");
        assert.ok((await stat(output)).mode & 0o111);
        assert.equal(await readFile(`${output}.c`, "utf8"), "generated C");
        assert.equal(await readFile(`${output}.mir`, "utf8"), "MIR");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
