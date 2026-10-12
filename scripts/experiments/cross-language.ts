// Compile first, then measure serially after all builds have finished.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, mkdtemp, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir, cpus, release, arch } from "node:os";
import { parseArgs } from "node:util";
import { hostCompile } from "../host.ts";
import { llvmPrefix, dynamicAotConfig } from "../host-dynamic-aot.ts";
import { loopSource } from "../benchmark.ts";
import {
  languageLoopSource,
  sourceCommand,
  workloadClock,
  workloadMetadata,
} from "../language-workloads.ts";
import { execute } from "../process.ts";
import { benchmarkOutput } from "../benchmark-output.ts";
import { sourceName, sourceLanguage, type Variant, type Workload } from "../variants.ts";

const root = resolve(import.meta.dirname, "../..");
const { values } = parseArgs({
  options: {
    output: { type: "string", default: "build/cross-language-2026-10-07/study" },
    phase: { type: "string", default: "compile" },
    targets: { type: "string" },
    snapshot: { type: "string" },
  },
});
if (!["compile", "measure", "inspect"].includes(values.phase!)) throw new Error("Invalid phase");
const directory = resolve(root, values.output!);
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const save = (file: string, value: unknown) =>
  writeFile(file, JSON.stringify(value, null, 2) + "\n");
const median = (numbers: number[]) =>
  [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
type Target = { name: string; tool: string; variant?: Variant };
const targets: Target[] = [
  { name: "spinel", tool: "spinel", variant: { tool: "spinel" } },
  { name: "cruby", tool: "cruby" },
  { name: "lython", tool: "lython", variant: { tool: "lython" } },
  { name: "cpython", tool: "cpython" },
  { name: "node", tool: "node" },
  { name: "porffor", tool: "porffor", variant: { tool: "porffor" } },
  { name: "shermes", tool: "static_hermes", variant: { tool: "static_hermes" } },
];
const expected = {
  hello: "hello",
  primes: 9592,
  json: 1491500,
  "object-stable": 102387360,
  "object-churn": 102387360,
} as const;
type Job = {
  case: Workload;
  target: Target;
  output: string;
  expected: string | number;
  mode: string;
  iterations: number;
  status: string;
  alias: unknown;
  originalSourceSha256?: string;
  error?: string;
};
const selected = (name: string) => !values.targets || values.targets.split(",").includes(name);
const command = (target: Target, workload: Workload, output: string) =>
  target.variant
    ? [join(output, "out")]
    : sourceCommand(target.tool, join(output, "src", sourceName(target, workload))).map(
        (value, i) => (i === 0 && value === "node" ? process.execPath : value),
      );
async function build(body: string, target: Target, workload: Workload, output: string) {
  const src = join(output, "src");
  await rm(src, { recursive: true, force: true });
  await mkdir(src, { recursive: true });
  await writeFile(join(src, sourceName(target, workload)), body);
  if (target.variant) await hostCompile(root, target.variant, workload, output, src);
  else
    await save(join(output, "build.json"), {
      runtimeVersion: execFileSync(command(target, workload, output)[0], ["--version"], {
        encoding: "utf8",
      }).trim(),
      ...workloadMetadata(target, workload),
    });
}
function run(target: Target, workload: Workload, output: string) {
  const [program, ...args] = command(target, workload, output);
  return benchmarkOutput(
    execFileSync(program, args, {
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    }),
  ).trim();
}
function wrapped(
  body: string,
  target: Target,
  workload: Workload,
  iterations: number,
  pilot = false,
) {
  const options = {
    mode: "in-process" as const,
    samples: pilot ? 1 : 5,
    warmup: pilot ? 0 : 2,
    iterations,
  };
  return sourceLanguage(target.tool) === "javascript"
    ? loopSource(body, options)
    : languageLoopSource(body, target.tool, options, workload);
}
await mkdir(directory, { recursive: true });
let jobs: Job[] = [];
try {
  jobs = await json(join(directory, "jobs.json"));
} catch {}
if (values.phase !== "compile" && !jobs.length)
  throw new Error("No prepared jobs; run --phase compile first.");
if (values.phase === "compile") {
  jobs = jobs.filter((job) => !selected(job.target.name));
  for (const target of targets.filter((target) => selected(target.name))) {
    // Reference persistence and deletion must work before keyed-container timings count.
    let alias: unknown;
    try {
      const probe = join(directory, "semantics", target.name);
      const body =
        sourceLanguage(target.tool) === "ruby"
          ? 'objects = [{"a" => 0}]; object = objects[0]; object["a"] = 9; puts objects[0]["a"]; object.delete("a"); puts(objects[0].key?("a") ? 0 : -1)\n'
          : sourceLanguage(target.tool) === "python"
            ? 'objects = [{"a": 0}]\nobj = objects[0]\nobj["a"] = 9\nprint(objects[0]["a"])\ndel obj["a"]\nprint(0 if "a" in objects[0] else -1)\n'
            : 'const objects = [{a:0}]; const object = objects[0]; object.a = 9; console.log(objects[0].a); delete object.a; console.log("a" in objects[0] ? 0 : -1);\n';
      await build(body, target, "hello", probe);
      const observation = run(target, "hello", probe);
      alias = { passed: observation === "9\n-1", output: observation };
    } catch (error) {
      alias = { passed: false, error: String(error) };
    }
    for (const [workload, result] of Object.entries(expected)) {
      const job: Job = {
        case: workload as Workload,
        target,
        expected: result,
        output: join(directory, workload, target.name),
        mode: workload === "hello" ? "process" : "in-process",
        iterations: 1,
        alias,
        status: "prepared",
      };
      jobs.push(job);
      await mkdir(job.output, { recursive: true });
      if (workload.startsWith("object-") && !(alias as { passed: boolean }).passed) {
        job.status = "semantics-failed";
      } else
        try {
          console.log(`Prepare ${workload}/${target.name}`);
          const body = await readFile(join(root, "src", sourceName(target, job.case)), "utf8");
          job.originalSourceSha256 = hash(body);
          if (workload === "hello") {
            await build(body, target, job.case, join(job.output, "plain"));
            if (run(target, job.case, join(job.output, "plain")) !== String(result))
              throw new Error("Incorrect hello result");
          } else {
            await build(
              wrapped(body, target, job.case, 1, true),
              target,
              job.case,
              join(job.output, "pilot"),
            );
            const pilot = JSON.parse(run(target, job.case, join(job.output, "pilot")));
            if (pilot.result !== result)
              throw new Error(`Incorrect pilot: ${JSON.stringify(pilot)}`);
            await save(join(job.output, "pilot.json"), pilot);
            job.iterations = Math.max(
              1,
              Math.min(500, Math.ceil(150 / Math.max(1, median(pilot.durations)))),
            );
            await build(
              wrapped(body, target, job.case, job.iterations),
              target,
              job.case,
              join(job.output, "measured"),
            );
          }
        } catch (error) {
          job.status = "prepare-failed";
          job.error = String(error);
          console.error(job.error);
        }
      await save(join(directory, "jobs.json"), jobs);
    }
  }
}
if (values.phase === "measure") {
  for (let round = 1; round <= 3; round++) {
    await writeFile(
      join(directory, `power-round-${round}.txt`),
      execFileSync("/usr/bin/pmset", ["-g", "batt"], { encoding: "utf8" }),
    );
    for (const job of round === 2 ? [...jobs].reverse() : jobs) {
      if (job.status !== "prepared" || !selected(job.target.name)) continue;
      const artifact = join(job.output, job.mode === "process" ? "plain" : "measured");
      const report = join(job.output, `round-${round}`);
      await mkdir(report, { recursive: true });
      await rm(join(report, "result.json"), { force: true });
      const temporary = await mkdtemp(join(tmpdir(), "cross-language-"));
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        TMPDIR: temporary,
        XDG_CACHE_HOME: join(temporary, "cache"),
      };
      for (const key of [
        "NODE_OPTIONS",
        "NODE_COMPILE_CACHE",
        "RUBYOPT",
        "RUBYLIB",
        "PYTHONPATH",
        "PYTHONHOME",
      ])
        delete env[key];
      try {
        const info = await json(join(artifact, "build.json"));
        const config = {
          ...info,
          name: `${job.target.name}-${job.case}`,
          workload: job.case,
          mode: job.mode,
          iterations: job.iterations,
          samples: job.mode === "process" ? 15 : 5,
          warmup: job.mode === "process" ? 3 : 2,
          expected: job.expected,
          backend: "host",
          execution: job.target.variant ? "binary" : "source",
          inProcessClock: workloadClock(job.target.tool),
          command: job.target.variant
            ? ["/out/out"]
            : sourceCommand(job.target.tool, `/src/${sourceName(job.target, job.case)}`).map(
                (value, i) => (i === 0 && value === "node" ? process.execPath : value),
              ),
          args: [],
          inputPaths: { source: join(artifact, "src"), output: artifact, temporary },
          artifactSha256: hash(
            await readFile(
              join(
                artifact,
                job.target.variant ? "out" : `src/${sourceName(job.target, job.case)}`,
              ),
            ),
          ),
        };
        await save(join(report, "config.json"), config);
        console.log(`Measure ${round}: ${job.case}/${job.target.name}`);
        await execute(
          process.execPath,
          [join(root, "scripts/benchmark-runner.ts"), join(report, "config.json")],
          { env },
        );
      } catch (error) {
        await save(join(report, "failure.json"), { error: String(error) });
        console.error(error);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
  }
}
const results = [];
for (const job of jobs) {
  const rounds = [];
  for (let round = 1; round <= 3; round++)
    try {
      rounds.push(await json(join(job.output, `round-${round}`, "result.json")));
    } catch {}
  results.push({
    ...job,
    status:
      job.status === "prepared" ? (rounds.length === 3 ? "passed" : "unmeasured") : job.status,
    rounds,
    medianMs: rounds.length ? median(rounds.map((round) => round.stats.medianMs)) : undefined,
    minRoundMedianMs: rounds.length
      ? Math.min(...rounds.map((round) => round.stats.medianMs))
      : undefined,
    maxRoundMedianMs: rounds.length
      ? Math.max(...rounds.map((round) => round.stats.medianMs))
      : undefined,
  });
}
await save(join(directory, "results.json"), { recordedAt: new Date().toISOString(), results });
if (values.snapshot) {
  const rows = [];
  for (const row of results) {
    const artifact = join(row.output, row.mode === "process" ? "plain" : "measured");
    const intermediates = [];
    for (const filename of ["out.c", "out.ll", "out.ir"])
      try {
        const file = await readFile(join(artifact, filename));
        intermediates.push({
          file: join(artifact, filename).slice(root.length + 1),
          bytes: file.length,
          sha256: hash(file),
        });
      } catch {}
    const rounds = row.rounds.map((round) => ({
      timestamp: round.timestamp,
      runtimeVersion: round.runtimeVersion,
      hermesRevision: round.hermesRevision,
      lythonRevision: round.lythonRevision,
      spinelRelease: round.spinelRelease,
      artifactSha256: round.artifactSha256,
      clock: round.clock,
      samplesMs: round.samplesMs,
      stats: round.stats,
      result: round.result,
    }));
    rows.push({
      ...row,
      ...workloadMetadata(row.target, row.case),
      execution: row.target.variant ? "binary" : "source",
      output: row.output.slice(root.length + 1),
      rounds,
      intermediates,
      ...(row.target.variant && row.status === "passed"
        ? {
            binaryBytes: (await stat(join(artifact, "out"))).size,
            libraries: execFileSync("/usr/bin/otool", ["-L", join(artifact, "out")], {
              encoding: "utf8",
            })
              .trim()
              .split("\n")
              .slice(1)
              .map((line) => line.trim()),
          }
        : {}),
    });
  }
  const power = [];
  for (let round = 1; round <= 3; round++)
    try {
      power.push(await readFile(join(directory, `power-round-${round}.txt`), "utf8"));
    } catch {}
  await save(resolve(root, values.snapshot), {
    recordedAt: new Date().toISOString(),
    platform: process.platform,
    arch: arch(),
    kernel: release(),
    cpu: cpus()[0]?.model,
    llvmVersion: execFileSync(join(llvmPrefix(), "bin/llvm-config"), ["--version"], {
      encoding: "utf8",
    }).trim(),
    pins: dynamicAotConfig,
    power,
    method: {
      rounds: 3,
      round2Order: "reversed",
      process: { samples: 15, warmup: 3 },
      inProcess: { samples: 5, warmup: 2, pilotBatchGoalMs: 150 },
      compilerWork: "finished before measurement",
      inputStorage: "host-local",
      unit: "milliseconds per workload call",
      json: "1000 records x 100 transformations per call",
      sourceCommands: {
        node: sourceCommand("node", "entry.js"),
        cruby: sourceCommand("cruby", "entry.rb"),
        cpython: sourceCommand("cpython", "entry.py"),
      },
    },
    results: rows,
  });
}
for (const row of results)
  console.log(
    `${row.case}\t${row.target.name}\t${row.status}\t${row.medianMs ?? row.error ?? "—"}`,
  );
