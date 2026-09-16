import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { asyncLoopSource } from "../benchmark.ts";
import { startFetchFixture } from "../fetch-fixture.ts";
import { parseOptions } from "../options.ts";

const source = readFileSync(new URL("../../src/fetch-json.js", import.meta.url), "utf8");
test("fetch-json awaits every request and computes the fixed fixture checksum", async () => {
  const fixture = await startFetchFixture();
  try {
    let output: unknown;
    await runInNewContext(source, {
      fetch,
      console: {
        log: (value: unknown) => {
          output = value;
        },
      },
    });
    assert.equal(output, 14915);
    const generated = asyncLoopSource(source, {
      mode: "in-process",
      samples: 2,
      iterations: 3,
      warmup: 1,
    });
    await runInNewContext(generated, {
      fetch,
      console: {
        log: (value: string) => {
          output = JSON.parse(value);
        },
      },
    });
    assert.equal((output as any).result, 14915);
    assert.equal((output as any).durations.length, 3);
    assert.equal(await fixture.requests(), 10);
  } finally {
    await fixture.stop();
  }
});
test("fetch-json surfaces HTTP errors and validates the async entry point", async () => {
  await assert.rejects(
    runInNewContext(source, { fetch: async () => ({ ok: false }), console }),
    /HTTP request failed/,
  );
  assert.throws(() =>
    asyncLoopSource("wrong entry", { mode: "in-process", samples: 1, iterations: 1, warmup: 0 }),
  );
  assert.equal(
    parseOptions(["bench", "--workload", "fetch-json", "--mode", "in-process"]).workload,
    "fetch-json",
  );
});
