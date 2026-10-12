import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseOptions } from "../options.ts";
import { compilePlan } from "../compilers/index.ts";
import { sourceName } from "../variants.ts";
import { sourceCommand, languageLoopSource } from "../language-workloads.ts";

test("interpreter baselines use source only and select the matching language", () => {
  for (const [tool, suffix] of [
    ["cpython", "py"],
    ["cruby", "rb"],
  ]) {
    const options = parseOptions(["bench", "--tool", tool, "--workload", "json"]);
    assert.deepEqual(options.benchmarkSelected, [{ tool, execution: "source" }]);
    assert.deepEqual(parseOptions(["bench-results", "--tool", tool]).benchmarkSelected, [
      { tool, execution: "source" },
    ]);
    assert.equal(
      sourceName(options.variant, "json"),
      tool === "cpython" ? "json.cpython.py" : `json.${suffix}`,
    );
    for (const command of ["compile", "run-binary", "sizes"])
      assert.throws(() => parseOptions([command, "--tool", tool]), /source-only/);
    assert.throws(() => parseOptions(["bench", "--tool", tool, "--execution", "binary"]));
    assert.throws(
      () => parseOptions(["run", "--tool", tool, "--workload", "npm-cli"]),
      /ports support/,
    );
  }
  assert.ok(sourceCommand("cpython", "/src/json.py").includes("-I"));
  assert.ok(sourceCommand("cruby", "/src/json.rb").includes("--disable-yjit"));
});

test("Ruby/Python AOT plans retain C/LLVM and reject missing ports", () => {
  const ruby = compilePlan({ tool: "spinel" }, "primes");
  assert.ok(ruby.some((s) => s.argv.includes("/out/out.c")));
  assert.ok(ruby.every((s) => s.argv.includes("/src/primes.rb")));
  const python = compilePlan({ tool: "lython" }, "primes");
  assert.ok(python.some((s) => s.argv.includes("--emit-llvm")));
  assert.ok(python.every((s) => s.argv.includes("/src/primes.py")));
  assert.ok(python.every((s) => !s.argv.includes("jit")));
  assert.equal(sourceName({ tool: "lython" }, "json"), "json.lython.py");
  assert.ok(
    compilePlan({ tool: "lython" }, "json").every((s) => s.argv.includes("/src/json.lython.py")),
  );
  for (const tool of ["spinel", "lython"] as const)
    assert.throws(() => compilePlan({ tool }, "http-server"), /ports support/);
});

for (const tool of ["cpython", "cruby"] as const) {
  const command = sourceCommand(tool, "unused")[0];
  test(
    `${tool} ports preserve results in plain and repeated execution`,
    { skip: !!spawnSync(command, ["--version"]).error },
    () => {
      const root = resolve(import.meta.dirname, "../..");
      const temporary = mkdtempSync(join(tmpdir(), "language-workloads-"));
      try {
        const cases = {
          hello: "hello",
          primes: 9592,
          json: 1491500,
          "object-stable": 102387360,
          "object-churn": 102387360,
        };
        for (const [workload, expected] of Object.entries(cases)) {
          const file = sourceName({ tool }, workload as any);
          const body = readFileSync(join(root, "src", file), "utf8");
          const plain = sourceCommand(tool, join(root, "src", file));
          assert.equal(
            execFileSync(plain[0], plain.slice(1), { encoding: "utf8" }).trim(),
            String(expected),
          );
          const entry = join(temporary, file);
          writeFileSync(
            entry,
            languageLoopSource(body, tool, {
              mode: "in-process",
              iterations: 2,
              warmup: 1,
              samples: 2,
            }),
          );
          const run = sourceCommand(tool, entry);
          const value = JSON.parse(execFileSync(run[0], run.slice(1), { encoding: "utf8" }));
          assert.equal(value.result, expected);
          assert.equal(value.durations.length, 3);
          assert.ok(value.durations.every((n: number) => Number.isFinite(n) && n >= 0));
        }
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    },
  );
}
