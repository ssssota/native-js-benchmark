// Freeze the matched native comparison, including skipped semantics and artifacts.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { cpus, release, homedir } from "node:os";
import { sourceName } from "../variants.ts";

const root = resolve(import.meta.dirname, "../..");
const directory = resolve(root, process.argv[2] ?? "build/native-comparison-2026-10-05");
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const data = json(join(directory, "results.json"));
const originalOseo = json(join(root, "reports/oseo-study-results.json"));
function intermediates(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const file = join(path, entry.name);
    return entry.isDirectory()
      ? intermediates(file)
      : /\.(?:c|ll|mir|ir|ir\.json)$/.test(entry.name)
        ? [file]
        : [];
  });
}
for (const row of data.results) {
  if (!["passed", "semantics-failed", "compile-failed"].includes(row.status))
    throw new Error(`Incomplete ${row.case}/${row.target.name}`);
  if (row.status !== "passed") continue;
  if (row.rounds.length !== 3) throw new Error("Missing rounds");
  for (const round of row.rounds) {
    const output = typeof round.result === "string" ? round.result.trim() : round.result;
    if (output !== row.expected) throw new Error("Incorrect checksum");
  }
  const artifact = row.artifact ?? join(row.output, row.mode === "process" ? "plain" : "measured");
  const binary = join(artifact, row.target.node ? "entry.js" : "out");
  const hash = createHash("sha256").update(readFileSync(binary)).digest("hex");
  if (row.rounds.some((round: any) => round.artifactSha256 !== hash))
    throw new Error(`Changed artifact: ${binary}`);
  const inputFile = row.artifact
    ? join(artifact, "entry.js")
    : join(artifact, "src", sourceName(row.target.variant, row.case));
  row.artifacts = {
    binary,
    artifactSha256: hash,
    source: {
      file: inputFile,
      sha256: createHash("sha256").update(readFileSync(inputFile)).digest("hex"),
    },
    build: existsSync(join(artifact, "build.json")) ? json(join(artifact, "build.json")) : null,
    intermediates: row.target.node
      ? []
      : intermediates(artifact).map((file) => ({ file, bytes: readFileSync(file).length })),
  };
  if (row.artifacts.build?.actualPlans) {
    row.artifacts.build.actualPlans = row.artifacts.build.actualPlans.map((plan: any) => ({
      target: plan.target,
      requests: plan.requests.map(({ command, args }: any) => ({ command, args })),
    }));
  }
}
const sourceSnapshots = [
  "hello.js",
  "primes.js",
  "primes.ts",
  "primes.flow.js",
  "json.js",
  "object-stable.js",
  "object-churn.js",
].map((name) => ({ name, source: readFileSync(join(root, "src", name), "utf8") }));
const snapshot = {
  ...data,
  host: {
    cpu: cpus()[0]?.model,
    platform: process.platform,
    arch: process.arch,
    kernel: release(),
    power: execFileSync("pmset", ["-g", "batt"], { encoding: "utf8" }),
    settings: execFileSync("pmset", ["-g", "custom"], { encoding: "utf8" }),
  },
  protocol: {
    timings:
      "Same loopSource as Oseo study: 3 fresh processes, 2 warmup + 5 measured batches, adaptive calls/batch; hello 3 warmup + 15 spawn-to-exit samples. Serial, round 2 reverse order; medians of process medians.",
    controls:
      "Oseo and Node artifacts reused and measured in this pass, previous timings preserved. Oseo O2/no-sanitizers controls measured afterwards separately. Standard production compiler settings, not normalized optimizer/sanitizer flags.",
    semantics:
      "Object timings skipped if minimal alias probe prints 0 instead of 9. All successful workload checksums validated; finite probes are not whole-language conformance.",
    wrapper:
      "Oseo and JS inputs use untyped durations; scriptc TS requires number[] for its measurement array. Workload annotations preserved.",
    clock:
      "Date.now 1ms resolution except hello hrtime; interactive host without thermal or frequency control. Current battery/low-power settings captured; not a causal explanation of older timings.",
    provenance:
      "Original inputs saved below, retained C/IR paths and binary/source hashes per result. Native CLI versions from actual executables. Source artifacts are unoptimized IR unless tool says otherwise.",
  },
  originalOseoRevision: originalOseo.environment.oseoRevision,
  originalOseoDiagnostics: originalOseo.diagnostics,
  sourceSnapshots,
};
const destination = join(root, "reports/native-comparison-results.json");
writeFileSync(
  destination,
  JSON.stringify(snapshot, null, 2).replaceAll(root, "<repo>").replaceAll(homedir(), "<home>") +
    "\n",
);
console.log(`Saved ${data.results.length} results: ${destination}`);
