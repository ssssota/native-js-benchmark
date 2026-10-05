// Untimed diagnostics. Never use these counter-instrumented binaries for timings.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { oseoConfig, oseoDirectory, prepareOseo } from "../host-oseo.ts";

const root = resolve(import.meta.dirname, "../..");
const study = resolve(process.argv[2] ?? join(root, "build/oseo-study-2026-10-05"));
await prepareOseo(root);
const checkout = oseoDirectory(root);
const cli = await import(pathToFileURL(join(checkout, "packages/cli/dist/index.js")).href);
// The CLI does not expose the backend's observation switch. Enable both emitted
// guard counters and runtime counters in this separate diagnostic process.
const originalEmit = cli.defaultComponents.backend.emit;
cli.defaultComponents.backend.emit = (mir: any) =>
  originalEmit({ ...mir, observeSpecialization: true });
const { compileOseo } = await import(new URL("../oseo-compile.mjs", import.meta.url).href);
const version = JSON.parse(
  await readFile(join(checkout, "packages/cli/package.json"), "utf8"),
).version;
const probes: { name: string; source: string; typed?: boolean; expected: string }[] = [];
for (const [name, expected] of [
  ["primes", 9592],
  ["primes-var", 9592],
  ["json", 1491500],
  ["object-stable", 102387360],
  ["object-churn", 102387360],
  ["addition", 10239440],
] as const) {
  probes.push({
    name,
    source: await readFile(join(study, name, "oseo-js/plain/entry.js"), "utf8"),
    expected: String(expected),
  });
}
probes.push({
  name: "addition-typed",
  source: await readFile(join(study, "addition/oseo-ts/plain/entry.ts"), "utf8"),
  typed: true,
  expected: "10239440",
});
probes.push({
  name: "addition-fallback",
  typed: true,
  source: `function add(left: number, right: number): number { return left + right; }
console.log(JSON.stringify([add(20, 22), add("x", 3), add(1.5, 2), add(140737488355327, 1)]));
`,
  expected: '[42,"x3",3.5,140737488355328]',
});
probes.push({
  name: "object-semantics",
  source: `var objects = [{a: 0, b: 2}];
var object = objects[0]; object.a = 9;
var alias = objects[0] === object;
delete object.a;
var absent = object.a === undefined && !("a" in object) && Object.keys(object).length === 1;
object.a = 4;
console.log(JSON.stringify([alias, absent, objects[0].a, Object.keys(object).join(",")]));
`,
  expected: '[true,true,4,"b,a"]',
});
for (const mode of ["same", "alternating", "delete-reinsert"]) {
  probes.push({
    name: `named-${mode}`,
    source: `function readA(object) { return object.a; }
var first = {a: 1, b: 0};
var second = {a: 2, b: 0};
var total = 0;
for (var i = 0; i < 1000; i++) {
  total += readA(${mode === "alternating" ? "i % 2 === 0 ? first : second" : "first"});
  ${mode === "delete-reinsert" ? "delete first.a; first.a = 1;" : ""}
}
console.log(total);
`,
    expected: mode === "alternating" ? "1500" : "1000",
  });
}
const results = [];
for (const probe of probes) {
  const output = join(study, "diagnostics", probe.name);
  await mkdir(output, { recursive: true });
  const source = join(output, `entry.${probe.typed ? "ts" : "js"}`);
  await writeFile(source, probe.source);
  try {
    const base = cli.defaultComponents.toolchain;
    const toolchain = {
      ...base,
      createBuildPlan(input: any) {
        let c = readFileSync(input.generatedSourcePath, "utf8");
        const success = "    oseo_context_destroy(&context);\n    return 0;";
        if (!c.includes("context.observe_specialization = true;") || !c.includes(success))
          throw new Error("Unknown Oseo entrypoint layout.");
        c = c.replace('#include "oseo_runtime.h"', '#include "oseo_runtime.h"\n#include <stdio.h>');
        c = c.replace(
          success,
          '    fprintf(stderr, "OSEO_COUNTERS {\\"hits\\":%zu,\\"misses\\":%zu,\\"overflow\\":%zu,\\"genericAdditions\\":%zu,\\"allocationAttempts\\":%zu,\\"collections\\":%zu}\\n", context.guard_hits, context.guard_misses, context.overflow_misses, context.generic_addition_calls, context.allocation_attempts, context.collections);\n' +
            success,
        );
        writeFileSync(input.generatedSourcePath, c);
        return base.createBuildPlan(input);
      },
    };
    await compileOseo({
      cli: { ...cli, defaultComponents: { ...cli.defaultComponents, toolchain } },
      host: cli.defaultComponents.createNodeHost(),
      version,
      source,
      output: join(output, "out"),
    });
    // spawnSync captures the diagnostic stderr separately from the observable result.
    const observation = spawnSync(join(output, "out"), [], {
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
    await writeFile(join(output, "stdout.txt"), observation.stdout ?? "");
    await writeFile(join(output, "stderr.txt"), observation.stderr ?? "");
    if (
      observation.error ||
      observation.status !== 0 ||
      observation.stdout.trim() !== probe.expected
    )
      throw new Error(
        `Probe failed: ${observation.error?.message ?? observation.stderr ?? observation.stdout}`,
      );
    const counters = JSON.parse(/OSEO_COUNTERS (\{[^\n]+\})/.exec(observation.stderr)![1]);
    results.push({
      name: probe.name,
      output: observation.stdout.trim(),
      status: "passed",
      counters,
      source,
      instrumentedC: join(output, "out.c"),
      mir: join(output, "out.mir"),
    });
    console.log(probe.name, counters);
  } catch (error) {
    results.push({
      name: probe.name,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(results.at(-1));
  }
}
await writeFile(
  join(study, "diagnostics.json"),
  JSON.stringify(
    { oseoRevision: oseoConfig.revision, instrumented: true, timing: false, results },
    null,
    2,
  ) + "\n",
);
