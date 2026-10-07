// Validate and freeze paired timings and the contemporaneous unchanged-tool controls.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { loopSource } from "../benchmark.ts";

const root = resolve(import.meta.dirname, "../..");
const directory = resolve(root, process.argv[2] ?? "build/tool-update-performance-2026-10-05");
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const data = json(join(directory, "results.json"));
const environment = json(join(directory, "environment.json"));
const powerRounds = Array.from({ length: 5 }, (_, i) =>
  json(join(directory, `power-round-${i + 1}.json`)),
);
if (
  powerRounds.some(
    (p) =>
      !p.battery.includes("'AC Power'") || !/AC Power:[\s\S]*lowpowermode\s+0/.test(p.settings),
  )
)
  throw new Error("Power condition changed");
const sources = new Map<string, string>();
function intermediateFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const file = join(path, entry.name);
    return entry.isDirectory()
      ? intermediateFiles(file)
      : /\.(?:c|ll|ir|ir\.json)$/.test(entry.name)
        ? [file]
        : [];
  });
}
function validateRounds(
  rounds: any[],
  expected: string | number,
  digest: string,
  iterations: number,
  count: number,
) {
  if (rounds.length !== count || new Set(rounds.map((r) => r.round)).size !== count)
    throw new Error("Missing rounds");
  for (const r of rounds) {
    const value = typeof r.result === "string" ? r.result.trim() : r.result;
    if (
      value !== expected ||
      r.expected !== expected ||
      r.artifactSha256 !== digest ||
      r.iterations !== iterations
    )
      throw new Error("Incorrect checksum or changed artifact/protocol");
    if (
      r.samplesMs.length !== r.warmup + r.samples ||
      r.samplesMs.some((n: number) => !Number.isFinite(n) || n < 0)
    )
      throw new Error("Missing/invalid samples");
  }
}
for (const row of data.results) {
  if (row.status === "semantics-failed") {
    if (
      row.target !== "scriptc" ||
      !row.case.startsWith("object-") ||
      row.alias.old.output !== "0" ||
      row.alias.new.output !== "0"
    )
      throw new Error("Unexpected semantic exclusion");
    continue;
  }
  if (row.status !== "passed") throw new Error(`Incomplete ${row.target}/${row.case}`);
  const suffix =
    row.target === "scriptc-ts" ? "ts" : row.target === "shermes-flow" ? "flow.js" : "js";
  const name = `${row.case}.${suffix}`;
  const source = readFileSync(join(root, "src", name), "utf8");
  sources.set(name, source);
  const wrapper =
    row.mode === "process"
      ? source
      : loopSource(
          source,
          { mode: "in-process", iterations: row.iterations, warmup: 2, samples: 5 },
          suffix !== "js",
        );
  for (const side of ["old", "new"]) {
    const artifact = row[side];
    const input = join(artifact.directory, "src", name);
    const body = readFileSync(input, "utf8");
    if (body !== wrapper || hash(body) !== artifact.sourceSha256)
      throw new Error(`Changed input ${input}`);
    const file = artifact.command[0] === "/out/out" ? join(artifact.directory, "out") : input;
    const digest = hash(readFileSync(file));
    if (digest !== artifact.artifactSha256) throw new Error(`Changed executable ${file}`);
    if (hash(readFileSync(artifact.compilerCommand[0])) !== artifact.compilerSha256)
      throw new Error("Changed compiler");
    validateRounds(artifact.rounds, row.expected, digest, row.iterations, 5);
    if (
      artifact.rounds.some(
        (r: any) =>
          r.sourceSha256 !== artifact.sourceSha256 ||
          r.runtimeVersion !== artifact.runtimeVersion ||
          r.release !== artifact.release,
      )
    )
      throw new Error("Incorrect version/input provenance");
    artifact.inputSource = { file: input, sha256: artifact.sourceSha256, source: body };
    artifact.intermediates = intermediateFiles(artifact.directory).map((file) => ({
      file,
      bytes: readFileSync(file).length,
      sha256: hash(readFileSync(file)),
    }));
  }
  if (row.old.sourceSha256 !== row.new.sourceSha256 || row.pairedNewOverOld.length !== 5)
    throw new Error("Unmatched version pair");
}
const references = json(join(directory, "reference/results.json"));
const originalReferences = json(join(root, "reports/native-comparison-results.json"));
for (const row of references.results) {
  const digest = hash(readFileSync(join(row.artifact, "out")));
  validateRounds(row.rounds, row.expected, digest, row.iterations, 3);
  const original = originalReferences.results.find(
    (r: any) => r.target.name === row.target && r.case === row.case,
  );
  if (!original || original.artifacts.artifactSha256 !== digest)
    throw new Error("Changed reference baseline");
  const sourceFile = original.artifacts.source.file.replace("<repo>", root);
  const body = readFileSync(sourceFile, "utf8");
  if (hash(body) !== original.artifacts.source.sha256) throw new Error("Changed reference input");
  const source = readFileSync(join(root, "src", `${row.case}.js`), "utf8");
  const wrapper =
    row.case === "hello"
      ? source
      : loopSource(
          source,
          { mode: "in-process", iterations: row.iterations, warmup: 2, samples: 5 },
          false,
        );
  if (body !== wrapper) throw new Error("Different reference workload");
  row.artifacts = original.artifacts;
}
const referencePower = Array.from({ length: 3 }, (_, i) =>
  readFileSync(join(directory, `reference/power-${i + 1}.txt`), "utf8"),
);
if (referencePower.some((p) => !p.includes("'AC Power'")))
  throw new Error("Reference power condition changed");
if (
  data.results.filter((r: any) => r.status === "passed").length !== 30 ||
  references.results.length !== 12
)
  throw new Error("Missing cases");
const porfforFunctions: Record<string, string> = {};
const scriptcJson: Record<string, unknown> = {};
for (const side of ["old", "new"]) {
  const c = readFileSync(join(directory, `porffor/primes/${side}/measured/out.c`), "utf8");
  const fn = c.match(/^jsval \w+_countPrimes\(f64 limit\) \{[\s\S]*?^\}/m)?.[0];
  if (!fn) throw new Error("Missing Porffor primes function");
  porfforFunctions[side] = fn.replace(/\b\w+_countPrimes\b/, "countPrimes");
  const llvm = readFileSync(join(directory, `scriptc/json/${side}/measured/json.ll`), "utf8");
  const body = llvm.match(
    /^define internal .* @sc_f_benchmarkWorkload\(\).*\{[^\n]*\n[\s\S]*?^\}/m,
  )?.[0];
  if (!body) throw new Error("Missing scriptc JSON function");
  const helpers: Record<string, number> = {};
  for (const [, name] of body.matchAll(/\bcall\s+[^\n]*?@((?:scr_dyn_|sc_td_|scr_json_)[\w]+)\(/g))
    helpers[name] = (helpers[name] ?? 0) + 1;
  scriptcJson[side] = {
    totalLocal: body.match(/%sc_l_total_0 = alloca (\w+)/)?.[1],
    helpers,
    selectedInstructions: body
      .split("\n")
      .filter((line) =>
        /total_0 = alloca|\bfadd\b|\bfcmp olt\b|@scr_dyn_add|@scr_dyn_compare|@scr_json_stringify_replacer/.test(
          line,
        ),
      ),
  };
}
const probeFile = join(directory, "diagnostics/json-add-probe/results.json");
const nodeRow = data.results.find((r: any) => r.target === "node-source" && r.case === "hello");
const nodeV8 = Object.fromEntries(
  ["old", "new"].map((side) => [
    side,
    execFileSync(nodeRow[side].compilerCommand[0], ["-p", "process.versions.v8"], {
      encoding: "utf8",
    }).trim(),
  ]),
);
const snapshot = {
  ...data,
  environment,
  powerRounds,
  nodeV8,
  references: { ...references, powerRounds: referencePower },
  protocolNotes: {
    summary:
      "Median of 5 process medians per version; paired ratio range is the observed range, not a confidence interval. Reference tools: 3 process medians, unchanged previously built artifacts, measured after version pairs.",
    power:
      "All measurements in this snapshot use AC power. Previous reports used battery with lowpowermode=1; their times are not the version baseline.",
    compiler:
      "Default release commands; optimizer/sanitizer settings not normalized across tools. compileMs includes diagnostic C/IR generation and is not a compile-time benchmark.",
    semantics:
      "All retained workloads have matching checksums. scriptc JS object workloads excluded by shared-reference probe, both versions output 0 instead of 9. Finite probes do not establish full language conformance.",
    limits:
      "Date.now 1ms batch resolution except hrtime hello. Serial execution on an interactive Apple M1 host; no temperature/frequency control or hardware profiling. Measurements are specific to these inputs and native macOS arm64.",
  },
  diagnostics: {
    porfforPrimes: {
      normalizedFunctionEqual: porfforFunctions.old === porfforFunctions.new,
      functions: porfforFunctions,
    },
    scriptcJson: {
      ...scriptcJson,
      counts:
        "Static call sites in benchmarkWorkload, including cleanup branches; not dynamic allocation or invocation counts.",
    },
    ...(existsSync(probeFile) ? { jsonAdditionProbe: json(probeFile) } : {}),
  },
  sourceSnapshots: [...sources].map(([name, source]) => ({ name, source, sha256: hash(source) })),
  harnesses: [
    "tool-update-performance.ts",
    "tool-update-performance-reference.ts",
    "collect-tool-update-performance.ts",
  ].map((name) => {
    const file = join(root, "scripts/experiments", name);
    const source = readFileSync(file, "utf8");
    return { file, source, sha256: hash(source) };
  }),
};
const destination = join(root, "reports/tool-update-performance-results.json");
writeFileSync(
  destination,
  JSON.stringify(snapshot, null, 2).replaceAll(root, "<repo>").replaceAll(homedir(), "<home>") +
    "\n",
);
console.log(
  `Validated 30 version pairs, 2 semantic exclusions, 12 unchanged-tool references: ${destination}`,
);
