import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { loopSource } from "../benchmark.ts";
import { parseOptions } from "../options.ts";

for (const name of ["object-stable", "object-churn"]) {
  test(name + " preserves its checksum in source and generated loops", () => {
    const source = readFileSync(new URL("../../src/" + name + ".js", import.meta.url), "utf8");
    let expected = 200000;
    for (let i = 0; i < 200000; i++) expected += i % 1024;
    let output: unknown;
    const context = {
      console: {
        log: (value: unknown) => {
          output = value;
        },
      },
    };
    runInNewContext(source, { ...context });
    assert.equal(output, expected);
    const options = parseOptions([
      "bench",
      "--workload",
      name,
      "--mode",
      "in-process",
      "--samples",
      "2",
      "--warmup",
      "1",
      "--iterations",
      "2",
    ]).benchmark;
    runInNewContext(loopSource(source, options), { ...context });
    const report = JSON.parse(String(output));
    assert.equal(report.result, expected);
    assert.equal(report.durations.length, 3);
    runInNewContext(
      source.replace(name === "object-churn" ? "delete object[key];" : "object[key] = 0;", ""),
      { ...context },
    );
    assert.notEqual(output, expected, "ignored cleanup must not pass the checksum");
  });
}
