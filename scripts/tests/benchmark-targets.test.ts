import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOptions } from "../options.ts";
import { benchmarkName } from "../benchmark-targets.ts";
import { variants, variantName } from "../variants.ts";

test("tool names select each exact configuration without changing artifact names", () => {
  for (const variant of variants) {
    const name = variantName(variant);
    for (const command of ["compile", "run-binary", "sizes", "bench", "bench-results"]) {
      const options = parseOptions([command, "--tool", name]);
      assert.deepEqual(options.selected, [variant]);
      assert.deepEqual(options.benchmarkSelected.map(benchmarkName), [name]);
    }
  }
  for (const tool of ["node", "deno", "bun", "cpython", "cruby"]) {
    for (const command of ["bench", "bench-results"])
      assert.deepEqual(
        parseOptions([command, "--tool", `${tool}-source`]).benchmarkSelected.map(benchmarkName),
        [`${tool}-source`],
      );
    assert.throws(() => parseOptions(["compile", "--tool", `${tool}-source`]));
  }
  assert.throws(() => parseOptions(["run", "--tool", "deno-quickjs"]));
  assert.throws(() => parseOptions(["bench", "--tool", "bun-cache-on", "--execution", "source"]));
});

test("source targets are distinct, deduplicated and opt-in for measurement", () => {
  assert.equal(parseOptions(["bench", "--all"]).benchmarkSelected.length, 18);
  assert.deepEqual(
    parseOptions(["bench", "--all", "--execution", "source"]).benchmarkSelected.map(benchmarkName),
    ["node-source", "deno-source", "bun-source", "cpython-source", "cruby-source"],
  );
  assert.equal(
    parseOptions(["bench", "--all", "--execution", "both"]).benchmarkSelected.length,
    23,
  );
  assert.equal(parseOptions(["bench-results"]).benchmarkSelected.length, 23);
  assert.equal(
    parseOptions(["bench-results", "--tool", "static_hermes"]).benchmarkSelected.length,
    1,
  );
  assert.equal(parseOptions(["bench-results", "--tool", "deno"]).benchmarkSelected.length, 4);
});

test("source execution rejects misleading compile-cache/engine options", () => {
  for (const args of [
    ["--tool", "perry"],
    ["--cache", "on"],
    ["--engine", "v8"],
  ])
    assert.throws(() => parseOptions(["bench", "--execution", "source", ...args]));
  assert.throws(() => parseOptions(["compile", "--execution", "source"]));
});
