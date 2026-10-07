// Remeasure unchanged tools after the version-pair run, without overlapping it.
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const directory = resolve(root, process.argv[2] ?? "build/tool-update-performance-2026-10-05");
const base = join(directory, "reference");
const save = (file: string, data: unknown) => writeFile(file, JSON.stringify(data, null, 2) + "\n");
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const median = (ns: number[]) => [...ns].sort((a, b) => a - b)[Math.floor(ns.length / 2)];
await mkdir(base, { recursive: true });
const original = await json(join(root, "build/native-comparison-2026-10-05/results.json"));
const jobs = original.results.filter(
  (r: any) =>
    ["perry", "oseo", "oseo-O2-no-sanitizers"].includes(r.target.name) && r.status === "passed",
);
const outputs: any[] = [];
for (let round = 1; round <= 3; round++) {
  await writeFile(
    join(base, `power-${round}.txt`),
    execFileSync("pmset", ["-g", "batt"], { encoding: "utf8" }),
  );
  for (const job of round % 2 ? jobs : [...jobs].reverse()) {
    const artifact =
      job.artifact ?? join(job.output, job.mode === "process" ? "plain" : "measured");
    const digest = createHash("sha256")
      .update(await readFile(join(artifact, "out")))
      .digest("hex");
    if (job.rounds.some((r: any) => r.artifactSha256 !== digest))
      throw new Error("Changed reference artifact");
    const output = join(base, job.target.name, job.case, `round-${round}`);
    await mkdir(output, { recursive: true });
    const temporary = await mkdtemp(join(tmpdir(), "tool-update-reference-"));
    const config = {
      name: `${job.target.name}-${job.case}`,
      round,
      workload: job.case,
      mode: job.mode,
      iterations: job.iterations,
      samples: job.mode === "process" ? 15 : 5,
      warmup: job.mode === "process" ? 3 : 2,
      expected: job.expected,
      backend: "host",
      execution: "binary",
      runtimeVersion: job.rounds[0].runtimeVersion,
      artifactSha256: digest,
      command: ["/out/out"],
      args: [],
      inputPaths: {
        source: job.artifact ? artifact : join(artifact, "src"),
        output: artifact,
        temporary,
      },
      supervisor: { executable: process.execPath, version: process.version },
    };
    const path = join(output, "config.json");
    await save(path, config);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TMPDIR: temporary,
      XDG_CACHE_HOME: join(temporary, "cache"),
    };
    delete env.NODE_OPTIONS;
    delete env.NODE_COMPILE_CACHE;
    console.log(`Reference round ${round}: ${job.target.name}/${job.case}`);
    try {
      execFileSync(process.execPath, [join(root, "scripts/benchmark-runner.ts"), path], {
        env,
        stdio: "inherit",
        timeout: 600000,
      });
      outputs.push(await json(join(output, "result.json")));
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
const results = jobs.map((j: any) => {
  const rounds = outputs.filter((r) => r.name === `${j.target.name}-${j.case}`);
  return {
    target: j.target.name,
    case: j.case,
    expected: j.expected,
    iterations: j.iterations,
    artifact: j.artifact ?? join(j.output, j.mode === "process" ? "plain" : "measured"),
    rounds,
    medianMs: median(rounds.map((r) => r.stats.medianMs)),
    roundMedianRangeMs: [
      Math.min(...rounds.map((r) => r.stats.medianMs)),
      Math.max(...rounds.map((r) => r.stats.medianMs)),
    ],
  };
});
await save(join(base, "results.json"), { recordedAt: new Date().toISOString(), results });
