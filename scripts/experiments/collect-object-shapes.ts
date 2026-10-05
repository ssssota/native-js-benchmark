// Freeze the latest result of every case/target into a reviewable report artifact.
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { cpus, platform, arch, release } from "node:os";

const root = resolve(import.meta.dirname, "../..");
const directory = resolve(root, process.argv[2] ?? "build/object-shape-study-2026-09-25");
const results = [];
for (const c of readdirSync(directory, { withFileTypes: true })) {
  if (!c.isDirectory()) continue;
  for (const target of readdirSync(join(directory, c.name), { withFileTypes: true })) {
    const file = join(directory, c.name, target.name, "result.json");
    if (target.isDirectory() && existsSync(file))
      results.push(JSON.parse(readFileSync(file, "utf8")));
  }
}
results.sort((a, b) => a.case.name.localeCompare(b.case.name) || a.target.localeCompare(b.target));
const v8File = join(directory, "v8-properties.json");
const denoFile = join(directory, "deno-v8-properties.json");
const tracesFile = join(directory, "v8-traces.json");
const profiles = [
  "scriptc-stable",
  "perry-symbols-stable",
  "perry-symbols-churn",
  "perry-ts-symbols-churn",
].flatMap((name) => {
  const file = join(directory, `${name}.sample.txt`);
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, "utf8");
  return [
    {
      name,
      file,
      topOfStack: raw
        .split("Sort by top of stack, same collapsed (when >= 5):")[1]
        ?.split("Binary Images:")[0]
        ?.trim(),
    },
  ];
});
const snapshot = {
  recordedAt: new Date().toISOString(),
  host: { cpu: cpus()[0]?.model, platform: platform(), arch: arch(), kernel: release() },
  protocol: {
    scaling:
      "20,000 updates; one untimed process then five timed fresh processes; spawn-to-exit hrtime",
    throughput:
      "200,000 updates; three fresh processes; pilot chooses calls/batch, two warmup + seven measured batches; per-process median then median across processes",
    shapes: "2,000,000 named loads; same timing protocol as throughput",
    clock:
      "Date.now, integer milliseconds per batch; process startup excluded for throughput/shapes",
    checksum:
      "Each workload invocation checked; deletion requires undefined, not zero. Separate reference identity and key-presence probes.",
    note: "rounds is authoritative per case (some confirmation measurements use five). Earlier passes remain in build/summary-*.json. Cases run serially on an interactive host, no CPU pinning.",
  },
  v8: existsSync(v8File) ? JSON.parse(readFileSync(v8File, "utf8")) : null,
  denoV8: existsSync(denoFile) ? JSON.parse(readFileSync(denoFile, "utf8")) : null,
  traces: existsSync(tracesFile) ? JSON.parse(readFileSync(tracesFile, "utf8")) : null,
  profiles,
  results,
};
const destination = join(root, "reports/object-shapes-study-results.json");
writeFileSync(destination, JSON.stringify(snapshot, null, 2).replaceAll(root, "<repo>") + "\n");
for (const r of results)
  console.log(
    `${r.case.name}\t${r.target}\t${r.status}\t${r.medianMs?.toFixed(3) ?? "—"}\t${r.minRoundMs?.toFixed(3) ?? "—"}\t${r.maxRoundMs?.toFixed(3) ?? "—"}`,
  );
console.log(`Saved ${results.length} case/target results to ${destination}`);
