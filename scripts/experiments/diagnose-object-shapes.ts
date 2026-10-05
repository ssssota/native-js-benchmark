// Diagnostic runs are deliberately separate from throughput measurements.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const output = resolve(root, process.argv[2] ?? "build/object-shape-study-2026-09-25");
mkdirSync(output, { recursive: true });
const probe = join(root, "scripts/experiments/object-shapes-v8.js");
for (const [name, command, args] of [
  ["v8-properties.json", process.execPath, ["--allow-natives-syntax", probe]],
  ["deno-v8-properties.json", "deno", ["run", "-A", "--v8-flags=--allow-natives-syntax", probe]],
] as const) {
  const stdout = execFileSync(command, [...args], { encoding: "utf8", timeout: 30000 });
  writeFileSync(join(output, name), stdout);
  console.log(name, JSON.parse(stdout).cardinality);
}
const traces = [];
for (const name of ["reset-8", "drain-8", "keep-8", "named-shapes-16"]) {
  const input = join(output, name, "node", "src/object-stable.js");
  const stdout = execFileSync(process.execPath, ["--trace-opt", "--trace-deopt", probe, input], {
    encoding: "utf8",
    timeout: 30000,
  });
  writeFileSync(join(output, `v8-${name}-trace.log`), stdout);
  const [warmup, measured] = stdout.split("MEASURED_BATCHES_BEGIN");
  if (measured === undefined) throw new Error("Missing measurement marker");
  const events = (s: string) => s.split("\n").filter((line) => line.includes("deoptimizing"));
  traces.push({ case: name, warmupDeopts: events(warmup), measuredDeopts: events(measured) });
}
writeFileSync(join(output, "v8-traces.json"), JSON.stringify(traces, null, 2) + "\n");
console.log(JSON.stringify(traces, null, 2));
