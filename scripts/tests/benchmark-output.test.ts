import { test } from "node:test";
import assert from "node:assert/strict";
import { benchmarkOutput } from "../benchmark-output.ts";

test("Porffor colored output matches the expected numeric result", () => {
  const raw = "\u001b[33m9592\u001b[0m\n";
  assert.equal(benchmarkOutput(raw).trim(), "9592");
  assert.equal(benchmarkOutput(raw), benchmarkOutput("9592\n"));
  assert.equal(raw, "\u001b[33m9592\u001b[0m\n");
});

test("normalization preserves meaningful output differences", () => {
  assert.equal(benchmarkOutput(" hello\n"), " hello\n");
  assert.notEqual(benchmarkOutput("\u001b[33m9593\u001b[0m\n").trim(), "9592");
  assert.notEqual(benchmarkOutput("9592\nextra\n").trim(), "9592");
});
