import { test } from "node:test";
import assert from "node:assert/strict";
import { resultRow } from "../benchmark-results.ts";
import { parseOptions } from "../options.ts";

test("saved reports select all variants or filter by tool", () => {
  assert.equal(parseOptions(["bench-results"]).selected.length, 11);
  assert.equal(
    parseOptions(["bench-results", "--tool", "deno", "--mode", "in-process"]).selected.length,
    3,
  );
  assert.throws(() => parseOptions(["bench-results", "--samples", "10"]));
});
test("report rows retain numeric sort keys and reject invalid statistics", () => {
  const r = {
    name: "node-cache-off-hello",
    mode: "process",
    stats: { medianMs: 2, p95Ms: 3, firstMs: 3, lastMs: 1 },
    samples: 3,
    warmup: 0,
    iterations: 10,
    timestamp: "2026-09-13T00:00:00Z",
  };
  assert.equal(resultRow(r, r.name, r.mode).median, 2);
  assert.equal(resultRow(r, r.name, r.mode).cells[1], "2.000");
  assert.throws(() => resultRow(r, r.name, "in-process"));
  assert.throws(() => resultRow({ ...r, stats: { ...r.stats, medianMs: null } }, r.name, r.mode));
});
