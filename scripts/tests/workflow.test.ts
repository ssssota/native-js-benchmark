import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { parseOptions } from "../options.ts";
import { variantName, variants } from "../variants.ts";
import { compilePlan } from "../compilers/index.ts";
import { Docker, renderSteps } from "../docker.ts";
import { batch } from "../workflow.ts";
import { Interrupted } from "../process.ts";

test("matrix has eighteen distinct output names and valid cache settings", () => {
  assert.equal(new Set(variants.map(variantName)).size, 18);
  assert.equal(parseOptions(["compile", "--all"]).selected.length, 18);
  assert.deepEqual(
    parseOptions(["compile", "--variants", "--tool", "deno"]).selected.map(variantName),
    ["deno-v8-cache-off", "deno-v8-cache-on", "deno-quickjs"],
  );
  for (const v of variants) {
    const plan = compilePlan(v, "hello");
    assert.ok(plan.length);
    if (v.tool === "deno") {
      assert.equal(
        plan[0].argv.includes("--no-code-cache"),
        v.engine === "v8" && v.cache === "off",
      );
    }
    if (v.tool === "bun") assert.equal(plan[0].argv.includes("--bytecode"), v.cache === "on");
    if (v.tool === "node")
      assert.equal(JSON.parse(plan[0].argv.at(-1)!).useCodeCache, v.cache === "on");
    if (v.tool === "node") {
      assert.equal(plan.at(-1)!.argv[0], "postject");
      assert.ok(plan.every((step) => step.argv[0] !== "npx"));
    }
    if ("language" in v && v.language === "typescript")
      assert.ok(plan.some((step) => step.argv.some((arg) => arg.endsWith("/hello.ts"))));
    if ("language" in v && v.language === "flow") {
      assert.ok(
        plan
          .filter((step) => step.argv[0] === "shermes")
          .every((step) => step.argv.includes("-typed")),
      );
      assert.ok(plan.some((step) => step.argv.includes("/src/hello.flow.js")));
    }
  }
});

test("reject unsupported selections before Docker work", () => {
  for (const args of [
    ["compile", "--tool", "deno", "--engine", "quickjs", "--cache", "on"],
    ["compile", "--tool", "perry", "--cache", "on"],
    ["compile", "--tool", "bun", "--engine", "quickjs"],
    ["compile", "--all", "--cache", "on"],
    ["compile", "--all", "--variants"],
    ["run", "--tool", "deno", "--engine", "quickjs"],
    ["run", "--workload", "http-server", "--port", "70000"],
    ["compile", "--workload", "../secret"],
    ["build", "--skip-image-build"],
  ])
    assert.throws(() => parseOptions(args));
});

test("can use images built outside the CLI", async () => {
  const docker = new Docker("/project", "example", "ci", false);
  assert.equal(docker.image("node"), "example/node:ci");
  await docker.build("node");
  assert.equal(parseOptions(["compile", "--skip-image-build"]).buildImages, false);
});

test("forward argument boundaries including flags, whitespace, and shell syntax", () => {
  const input = ["hello world", "a'b", "$(printf injected)", "`printf injected`", "--flag", ""];
  assert.deepEqual(parseOptions(["run", "--", ...input]).args, input);
  assert.deepEqual(parseOptions(["run", "--workload", "file-cli"]).args, [
    "/src/fixtures/input.txt",
  ]);
  assert.deepEqual(parseOptions(["run", "--workload", "file-cli", "--"]).args, []);
  const script = renderSteps([
    {
      argv: [
        process.execPath,
        "-e",
        "console.log(JSON.stringify(process.argv.slice(1)))",
        "--",
        ...input,
      ],
    },
  ]);
  assert.deepEqual(JSON.parse(execFileSync("sh", ["-c", script], { encoding: "utf8" })), input);
});

test("batch continues after ordinary failures but stops on interruption", async () => {
  const visited: number[] = [];
  assert.equal(
    await batch([1, 2, 3], String, async (item) => {
      visited.push(item);
      if (item === 2) throw new Error("expected failure");
    }),
    false,
  );
  assert.deepEqual(visited, [1, 2, 3]);
  visited.length = 0;
  await assert.rejects(
    batch([1, 2, 3], String, async (item) => {
      visited.push(item);
      throw new Interrupted("SIGINT");
    }),
    Interrupted,
  );
  assert.deepEqual(visited, [1]);
});
