// Same wrapper/protocol as the Oseo study; serial timing, separate artifact tree.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { hostCompile, hostToolCommand } from "../host.ts";
import { loopSource } from "../benchmark.ts";
import { execute } from "../process.ts";
import { benchmarkOutput } from "../benchmark-output.ts";
import { sourceName, type Variant, type Workload } from "../variants.ts";

const root = resolve(import.meta.dirname, "../..");
const { values } = parseArgs({
  options: {
    output: { type: "string", default: "build/native-comparison-2026-10-05" },
    phase: { type: "string", default: "all" },
    targets: { type: "string" },
  },
});
if (!["all", "compile", "measure", "inspect"].includes(values.phase!))
  throw new Error("Invalid phase");
const directory = resolve(root, values.output!);
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const save = (file: string, data: unknown) => writeFile(file, JSON.stringify(data, null, 2) + "\n");
const median = (numbers: number[]) =>
  [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const targets: { name: string; variant: Variant; cBackend?: boolean }[] = [
  { name: "porffor", variant: { tool: "porffor" } },
  { name: "shermes", variant: { tool: "static_hermes" } },
  { name: "perry", variant: { tool: "perry" } },
  { name: "scriptc", variant: { tool: "scriptc" } },
  { name: "shermes-flow", variant: { tool: "static_hermes", language: "flow" } },
  { name: "perry-ts", variant: { tool: "perry", language: "typescript" } },
  { name: "scriptc-ts", variant: { tool: "scriptc", language: "typescript" } },
  { name: "scriptc-c", variant: { tool: "scriptc" }, cBackend: true },
];
const expected = {
  hello: "hello",
  primes: 9592,
  json: 1491500,
  "object-stable": 102387360,
  "object-churn": 102387360,
} as const;
async function build(
  body: string,
  target: (typeof targets)[number],
  workload: Workload,
  output: string,
) {
  const src = join(output, "src");
  await mkdir(src, { recursive: true });
  await writeFile(join(src, sourceName(target.variant, workload)), body);
  if (target.cBackend) {
    const [command, ...prefix] = hostToolCommand("scriptc");
    const args = [
      ...prefix,
      "build",
      join(src, sourceName(target.variant, workload)),
      "--backend",
      "c",
      "--keep-c",
      "--emit-ir",
      "-o",
      join(output, "out"),
    ];
    await execute(command, args, { cwd: output });
    await save(join(output, "build.json"), {
      runtimeVersion: execFileSync(command, [...prefix, "--version"], { encoding: "utf8" }).trim(),
      platform: process.platform,
      arch: process.arch,
      backend: "c",
      command,
      args,
      binarySha256: hash(await readFile(join(output, "out"))),
    });
  } else await hostCompile(root, target.variant, workload, output, src);
}
function run(output: string) {
  return benchmarkOutput(
    execFileSync(join(output, "out"), [], {
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    }),
  ).trim();
}
let jobs: any[] = [];
await mkdir(directory, { recursive: true });
if (["all", "compile"].includes(values.phase!)) {
  if (values.targets) {
    try {
      jobs = await json(join(directory, "jobs.json"));
    } catch {}
    jobs = jobs.filter((job) => !values.targets!.split(",").includes(job.target.name));
  }
  for (const target of targets) {
    if (values.targets && !values.targets.split(",").includes(target.name)) continue;
    // A minimal reference persistence check; failing this makes object timings invalid.
    let alias: any;
    try {
      const probe = join(directory, "semantics", target.name);
      await build(
        `const objects${target.variant.tool === "scriptc" && "language" in target.variant ? ": {a: number; b: number}[]" : ""} = []; objects.push({a:0,b:0}); const object = objects[0]; object.a = 9; console.log(objects[0].a);\n`,
        target,
        "hello",
        probe,
      );
      const observation = run(probe);
      alias = { passed: observation === "9", output: observation };
    } catch (error) {
      alias = { passed: false, error: String(error) };
    }
    for (const [workload, result] of Object.entries(expected)) {
      // Typed primes show numeric lowering without conflating object-type changes.
      if (
        target.variant.tool !== "porffor" &&
        "language" in target.variant &&
        target.variant.language &&
        workload !== "primes"
      )
        continue;
      const output = join(directory, workload, target.name);
      await mkdir(output, { recursive: true });
      const job: any = {
        case: workload,
        target,
        expected: result,
        output,
        mode: workload === "hello" ? "process" : "in-process",
        iterations: 1,
        alias,
        status: "prepared",
      };
      jobs.push(job);
      if (workload.startsWith("object-") && !alias.passed) {
        job.status = "semantics-failed";
        await save(join(directory, "jobs.json"), jobs);
        continue;
      }
      console.log(`Prepare ${workload}/${target.name}`);
      try {
        const body = await readFile(
          join(root, "src", sourceName(target.variant, workload as Workload)),
          "utf8",
        );
        job.originalSourceSha256 = hash(body);
        if (workload === "hello") {
          await build(body, target, workload as Workload, join(output, "plain"));
          if (run(join(output, "plain")) !== String(result))
            throw new Error("Incorrect hello output");
        } else {
          await build(
            loopSource(
              body,
              { mode: "in-process", samples: 2, warmup: 1, iterations: 1 },
              target.variant.tool === "scriptc" && "language" in target.variant,
            ),
            target,
            workload as Workload,
            join(output, "pilot"),
          );
          const pilot = JSON.parse(run(join(output, "pilot")));
          if (pilot.result !== result)
            throw new Error(`Incorrect pilot output: ${JSON.stringify(pilot)}`);
          await save(join(output, "pilot.json"), pilot);
          job.iterations = Math.max(
            1,
            Math.min(500, Math.ceil(100 / Math.max(1, median(pilot.durations.slice(1))))),
          );
          await build(
            loopSource(
              body,
              { mode: "in-process", samples: 5, warmup: 2, iterations: job.iterations },
              target.variant.tool === "scriptc" && "language" in target.variant,
            ),
            target,
            workload as Workload,
            join(output, "measured"),
          );
          console.log(
            `Pilot ${workload}/${target.name}: ${pilot.durations}, ${job.iterations} calls/batch`,
          );
        }
      } catch (error) {
        job.status = "compile-failed";
        job.error = String(error);
        console.error(job.error);
      }
      await save(join(directory, "jobs.json"), jobs);
    }
  }
} else jobs = await json(join(directory, "jobs.json"));
if (["all", "measure"].includes(values.phase!)) {
  // Retain the original Oseo study and time its exact artifacts in this pass.
  // This avoids combining timings from different host conditions.
  const baseline = await json(join(root, "build/oseo-study-2026-10-05/results.json"));
  jobs = jobs.filter((job) => !["oseo", "node", "oseo-O2-no-sanitizers"].includes(job.target.name));
  for (const row of baseline.results) {
    if (
      !["oseo-js", "node", "oseo-O2-no-sanitizers"].includes(row.target.name) ||
      !(row.case in expected)
    )
      continue;
    const targetName = row.target.node
      ? "node"
      : row.target.name === "oseo-js"
        ? "oseo"
        : row.target.name;
    jobs.push({
      ...row,
      status: "prepared",
      rounds: undefined,
      target: { name: targetName, node: !!row.target.node },
      artifact: join(row.output, row.mode === "process" ? "plain" : "measured"),
      output: join(directory, row.case, targetName),
      runtimeVersion: row.rounds[0].runtimeVersion,
    });
  }
  await save(join(directory, "jobs.json"), jobs);
  for (let round = 1; round <= 3; round++)
    for (const job of round === 2 ? [...jobs].reverse() : jobs) {
      if (job.status !== "prepared") continue;
      if (values.targets && !values.targets.split(",").includes(job.target.name)) continue;
      const artifact =
        job.artifact ?? join(job.output, job.mode === "process" ? "plain" : "measured");
      const report = join(job.output, `round-${round}`);
      await mkdir(report, { recursive: true });
      const temporary = await mkdtemp(join(tmpdir(), "native-comparison-"));
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        TMPDIR: temporary,
        XDG_CACHE_HOME: join(temporary, "cache"),
      };
      delete env.NODE_OPTIONS;
      delete env.NODE_COMPILE_CACHE;
      try {
        const build = job.artifact ? {} : await json(join(artifact, "build.json"));
        const config = {
          name: `${job.target.name}-${job.case}`,
          workload: job.case,
          mode: job.mode,
          iterations: job.iterations,
          samples: job.mode === "process" ? 15 : 5,
          warmup: job.mode === "process" ? 3 : 2,
          expected: job.expected,
          backend: "host",
          execution: job.target.node ? "source" : "binary",
          runtimeVersion: build.runtimeVersion ?? job.runtimeVersion,
          hermesRevision: build.hermesRevision,
          command: job.target.node ? [process.execPath, "/src/entry.js"] : ["/out/out"],
          args: [],
          inputPaths: {
            source: job.artifact ? artifact : join(artifact, "src"),
            output: artifact,
            temporary,
          },
          artifactSha256: hash(
            await readFile(join(artifact, job.target.node ? "entry.js" : "out")),
          ),
        };
        await save(join(report, "config.json"), config);
        console.log(`Measure round ${round}: ${job.case}/${job.target.name}`);
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
const results = [];
for (const job of jobs) {
  const rounds = [];
  for (let round = 1; round <= 3; round++) {
    try {
      rounds.push(await json(join(job.output, `round-${round}`, "result.json")));
    } catch {}
  }
  results.push({
    ...job,
    status:
      job.status === "prepared" ? (rounds.length === 3 ? "passed" : "incomplete") : job.status,
    rounds,
    medianMs: rounds.length ? median(rounds.map((r) => r.stats.medianMs)) : undefined,
    minRoundMedianMs: rounds.length ? Math.min(...rounds.map((r) => r.stats.medianMs)) : undefined,
    maxRoundMedianMs: rounds.length ? Math.max(...rounds.map((r) => r.stats.medianMs)) : undefined,
  });
}
await save(join(directory, "results.json"), { recordedAt: new Date().toISOString(), results });
for (const r of results)
  console.log(`${r.case}\t${r.target.name}\t${r.status}\t${r.medianMs ?? r.error ?? "—"}`);
