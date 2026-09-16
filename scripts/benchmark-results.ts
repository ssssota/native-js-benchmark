import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dockerBuildDirectory } from "./docker.ts";
import type { Workload } from "./variants.ts";
import { benchmarkName, type BenchmarkTarget } from "./benchmark-targets.ts";

export function resultRow(
  value: unknown,
  name: string,
  mode: string,
): { cells: string[]; median: number } {
  const r = value as Record<string, any>;
  const keys = ["medianMs", "p95Ms", "firstMs", "lastMs"];
  if (
    !r ||
    r.name !== name ||
    r.mode !== mode ||
    !keys.every(
      (k) => typeof r.stats?.[k] === "number" && Number.isFinite(r.stats[k]) && r.stats[k] >= 0,
    ) ||
    !Number.isSafeInteger(r.samples) ||
    r.samples < 1 ||
    !Number.isSafeInteger(r.warmup) ||
    r.warmup < 0 ||
    !Number.isSafeInteger(r.iterations) ||
    r.iterations < 1 ||
    typeof r.timestamp !== "string"
  )
    throw new Error("Invalid benchmark report.");
  return {
    median: r.stats.medianMs,
    cells: [
      name,
      ...keys.map((k) => r.stats[k].toFixed(3)),
      String(r.samples),
      mode === "in-process" ? String(r.iterations) : "—",
      String(r.warmup),
      ["container-local", "host-local"].includes(r.inputStorage)
        ? r.inputStorage
        : "legacy/unknown",
      r.timestamp,
    ],
  };
}

export async function benchmarkResults(
  root: string,
  selected: BenchmarkTarget[],
  workload: Workload,
  mode: string,
  buildDirectory = dockerBuildDirectory(root),
): Promise<boolean> {
  const entries: { cells: string[]; median: number }[] = [];
  const notes: string[] = [];
  let success = true;
  for (const v of selected) {
    const name = `${benchmarkName(v)}-${workload}`;
    try {
      const value: unknown = JSON.parse(
        await readFile(join(buildDirectory, `bench-${mode}-${name}`, "result.json"), "utf8"),
      );
      entries.push(resultRow(value, name, mode));
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      entries.push({
        median: Infinity,
        cells: [
          name,
          "—",
          "—",
          "—",
          "—",
          "—",
          "—",
          "—",
          "—",
          missing ? "not measured" : "invalid report",
        ],
      });
      if (!missing) {
        success = false;
        notes.push(`${name}: ${String(error)}`);
      }
    }
  }
  entries.sort((a, b) => a.median - b.median);
  const rows = [
    [
      "Configuration",
      "Median",
      "p95",
      "First",
      "Last",
      "Samples",
      "Iterations",
      "Warmup",
      "Inputs",
      "Measured at",
    ],
    ...entries.map((e) => e.cells),
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  console.log(`${mode}: ms/op, sorted by median ascending (fastest first).`);
  console.log(rows.map((r) => r.map((c, i) => c.padEnd(widths[i])).join("  ")).join("\n"));
  console.log(
    "\nSaved results only; no benchmarks run. Settings, environment and measurement dates may differ.",
  );
  if (notes.length) console.error(notes.join("\n"));
  return success;
}
