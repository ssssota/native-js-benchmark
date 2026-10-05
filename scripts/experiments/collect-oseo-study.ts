// Freeze timings, build flags, IR metrics, diagnostic counters and sampled stacks.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir, release, totalmem } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const directory = resolve(root, process.argv[2] ?? "build/oseo-study-2026-10-05");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const timings = readJson(join(directory, "results.json"));
const diagnostics = readJson(join(directory, "diagnostics.json"));
if (timings.results.some((row: any) => !["passed", "compile-failed"].includes(row.status)))
  throw new Error("Incomplete timings; inspect results before freezing.");
if (diagnostics.results.some((row: any) => row.status !== "passed"))
  throw new Error("A diagnostic probe failed.");
const builds = timings.results
  .filter((row: any) => !row.target.node && row.status === "passed")
  .map((row: any) => ({
    case: row.case,
    target: row.target.name,
    artifacts: ["plain", ...(row.mode === "in-process" ? ["measured"] : [])].map((phase) => {
      const artifact = join(row.output, phase);
      const build = readJson(join(artifact, "build.json"));
      return {
        phase,
        source: join(artifact, `entry.${row.target.typed ? "ts" : "js"}`),
        c: join(artifact, "out.c"),
        mir: join(artifact, "out.mir"),
        ...build,
        // Preserve arguments and target policy without unrelated host environment.
        actualPlans: build.actualPlans.map((plan: any) => ({
          target: plan.target,
          requests: plan.requests.map(({ command, args }: any) => ({ command, args })),
        })),
      };
    }),
  }));
const profiles = ["primes", "primes-var", "json", "object-churn"].map((name) => {
  const file = join(directory, `${name}.sample.txt`);
  if (!existsSync(file)) throw new Error(`Missing profile: ${file}`);
  const raw = readFileSync(file, "utf8");
  return {
    name,
    file,
    timed: false,
    binary: join(directory, name, "oseo-js/measured/out"),
    topOfStack: raw
      .split("Sort by top of stack, same collapsed (when >= 5):")[1]
      ?.split("Binary images description")[0]
      ?.split("Binary Images:")[0]
      ?.trim(),
  };
});
const snapshot = {
  recordedAt: new Date().toISOString(),
  ...timings,
  environment: { ...timings.environment, kernel: release(), memoryBytes: totalmem() },
  protocol: {
    workloads:
      "Original hello, primes, json, object-stable/churn; addition: 20,000 function calls; primes-var changes only let to var, no escaping closures.",
    timings:
      "Serial runs; 3 fresh processes per target, 2 warmup + 5 measured batches/process, adaptive 1–500 calls/batch; median of process medians.",
    startup:
      "hello: 3 warmup + 15 spawn-to-exit samples/process, hrtime; includes stdout and shutdown.",
    clock:
      "Other cases use Date.now, 1 ms batch resolution; each batch divided by calls/batch. Node addition batches only 1–2 ms: do not interpret its exact ratio.",
    order:
      "Oseo/native targets measured together, order reversed in round 2. Node measured afterwards in a separate serial pass after correcting its staged input path.",
    controls:
      "O2 appends -O2 only to generated application C. No-sanitizers control also changes runtime archive cache key; all standard targets keep upstream flags.",
    diagnostics:
      "Separate untimed binaries: backend observeSpecialization=true emits guard counters; C entrypoint additionally prints allocation_attempts before teardown. Counts include startup; allocation attempts include heap/buffer malloc/calloc/realloc and are not object counts.",
    profiles:
      "macOS sample, 2 s at 1 ms; launches/stops only its own child. May include startup and sanitizer/runtime overhead; no precise percentage claims.",
    validation:
      "Every successful workload output checked. Object benchmark checksum accepts both undefined and zero; separate probe validates alias identity, actual delete, absence and reinsertion order.",
    limits:
      "Interactive Apple M1 host, no CPU pinning/thermal control; single upstream revision, macOS arm64 only. Source TS failures are preserved, not rewritten. No p95 or small effect claims from 3 process medians.",
  },
  builds,
  diagnostics,
  profiles,
};
const destination = join(root, "reports/oseo-study-results.json");
writeFileSync(
  destination,
  JSON.stringify(snapshot, null, 2).replaceAll(root, "<repo>").replaceAll(homedir(), "<home>") +
    "\n",
);
console.log(
  `Saved ${timings.results.length} targets, ${diagnostics.results.length} probes: ${destination}`,
);
