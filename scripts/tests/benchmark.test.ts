import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { loopSource } from "../benchmark.ts";
import { parseOptions } from "../options.ts";
import { staticHermesPlan } from "../compilers/native.ts";

test("benchmark defaults and explicit overrides", () => {
  assert.deepEqual(parseOptions(["bench", "--mode", "in-process"]).benchmark, {
    mode: "in-process",
    samples: 5,
    iterations: 50,
    warmup: 1,
  });
  assert.deepEqual(parseOptions(["bench"]).benchmark, {
    mode: "process",
    samples: 50,
    iterations: 50,
    warmup: 5,
  });
  assert.deepEqual(
    parseOptions([
      "bench",
      "--mode",
      "in-process",
      "--samples",
      "2",
      "--iterations",
      "3",
      "--warmup",
      "0",
    ]).benchmark,
    {
      mode: "in-process",
      samples: 2,
      iterations: 3,
      warmup: 0,
    },
  );
});

test("benchmark options reject unbounded workloads and invalid counts", () => {
  for (const args of [
    ["--workload", "http-server"],
    ["--samples", "0"],
    ["--warmup", "-1"],
    ["--mode", "bad"],
    ["--iterations", "2"],
    ["--mode", "in-process", "--workload", "file-cli"],
  ])
    assert.throws(() => parseOptions(["bench", ...args]));
  assert.equal(parseOptions(["bench", "--all"]).selected.length, 18);
  assert.equal(parseOptions(["bench", "--variants", "--tool", "deno"]).selected.length, 3);
});

test("loop wrapper preserves results and emits warmup plus measured batches", () => {
  for (const [name, expected] of [
    ["hello", "hello"],
    ["primes", 9592],
    ["json", 1491500],
  ] as const) {
    const source = readFileSync(new URL(`../../src/${name}.js`, import.meta.url), "utf8");
    let output = "";
    runInNewContext(
      loopSource(source, { mode: "in-process", samples: 2, iterations: 2, warmup: 1 }),
      {
        console: {
          log: (s: string) => {
            output = s;
          },
        },
      },
    );
    const result = JSON.parse(output);
    assert.equal(result.result, expected);
    assert.equal(result.durations.length, 3);
  }
  assert.throws(() =>
    loopSource("console.log(1); console.log(2);", {
      mode: "in-process",
      samples: 1,
      iterations: 1,
      warmup: 0,
    }),
  );
});

test("loop wrapper gives typed sources a typed duration array", () => {
  const generated = loopSource(
    "// @flow\nfunction f(x: number): number { return x; }\nconsole.log(f(1));",
    { mode: "in-process", samples: 1, iterations: 1, warmup: 0 },
  );
  assert.match(generated, /var durations: number\[\] = \[\];/);
});

test("Oseo loop wrapper preserves workload hints without an unsupported array hint", () => {
  const generated = loopSource(
    "function f(x: number): number { return x; }\nconsole.log(f(1));",
    { mode: "in-process", samples: 1, iterations: 1, warmup: 0 },
    false,
  );
  assert.match(generated, /function f\(x: number\): number/);
  assert.match(generated, /var durations = \[\];/);
  assert.doesNotMatch(generated, /durations: number\[\]/);
});

test("Docker Hermes uses the release compiler's static-link mode", () => {
  const plan = staticHermesPlan({ tool: "static_hermes" }, "hello");
  assert.deepEqual(plan.at(-1)!.argv, [
    "shermes",
    "-O",
    "-static-link",
    "-o",
    "/out/out",
    "/src/hello.js",
  ]);
});
