// Compare both versions on the current host; historical timings are not a baseline.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, release, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loopSource } from "../benchmark.ts";
import { benchmarkOutput } from "../benchmark-output.ts";
import { execute } from "../process.ts";

const root = resolve(import.meta.dirname, "../..");
const { values } = parseArgs({
  options: {
    output: { type: "string", default: "build/tool-update-performance-2026-10-05" },
    phase: { type: "string", default: "all" },
  },
});
if (!["all", "compile", "measure"].includes(values.phase!)) throw new Error("Invalid phase");
const directory = resolve(root, values.output!);
const save = (file: string, data: unknown) => writeFile(file, JSON.stringify(data, null, 2) + "\n");
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const median = (ns: number[]) => [...ns].sort((a, b) => a - b)[Math.floor(ns.length / 2)];
const mise = (tool: string, executable: string) =>
  join(execFileSync("mise", ["where", tool], { encoding: "utf8" }).trim(), executable);
const node24 = mise("node@24.21.0", "bin/node");
const node26 = mise("node@26.10.0", "bin/node");
type Side = "old" | "new";
type Kind = "porffor" | "shermes" | "scriptc" | "source" | "quickjs";
interface Target {
  name: string;
  kind: Kind;
  old: string[];
  new: string[];
  releases: [string, string];
  typed?: "typescript" | "flow";
}
const porffor = (version: string) => [mise(`github:CanadaHonk/porffor@${version}`, "porf")];
const hermes = (version: string) => [
  mise(`github:ssssota/static-hermes-cli@${version}`, "bin/shermes"),
];
const scriptcOld = [
  node24,
  join(
    root,
    "build/tool-update-2026-10-05/packages/scriptc-old/node_modules/scriptc/dist/bootstrap.js",
  ),
];
const scriptcNew = [join(root, "node_modules/scriptc/bin/scriptc.exe")];
const denoOld = mise("deno@2.9.6", "bin/deno");
const denoNew = mise("deno@2.9.7", "bin/deno");
const targets: Target[] = [
  {
    name: "porffor",
    kind: "porffor",
    old: porffor("alpha-6"),
    new: porffor("alpha-15"),
    releases: ["alpha-6", "alpha-15"],
  },
  {
    name: "scriptc",
    kind: "scriptc",
    old: scriptcOld,
    new: scriptcNew,
    releases: ["0.0.36", "0.2.3"],
  },
  {
    name: "shermes",
    kind: "shermes",
    old: hermes("2026.9.20"),
    new: hermes("2026.10.1"),
    releases: ["2026.9.20", "2026.10.1"],
  },
  {
    name: "scriptc-ts",
    kind: "scriptc",
    old: scriptcOld,
    new: scriptcNew,
    releases: ["0.0.36", "0.2.3"],
    typed: "typescript",
  },
  {
    name: "shermes-flow",
    kind: "shermes",
    old: hermes("2026.9.20"),
    new: hermes("2026.10.1"),
    releases: ["2026.9.20", "2026.10.1"],
    typed: "flow",
  },
  {
    name: "node-source",
    kind: "source",
    old: [node24],
    new: [node26],
    releases: ["24.21.0", "26.10.0"],
  },
  {
    name: "deno-v8-source",
    kind: "source",
    old: [denoOld, "run", "-A", "--no-config", "--no-npm"],
    new: [denoNew, "run", "-A", "--no-config", "--no-npm"],
    releases: ["2.9.6", "2.9.7"],
  },
  {
    name: "deno-quickjs",
    kind: "quickjs",
    old: [denoOld],
    new: [denoNew],
    releases: ["2.9.6", "2.9.7"],
  },
];
const expected: Record<string, string | number> = {
  hello: "hello",
  primes: 9592,
  json: 1491500,
  "object-stable": 102387360,
  "object-churn": 102387360,
};
interface Artifact {
  directory: string;
  command: string[];
  sourceSha256: string;
  artifactSha256: string;
  runtimeVersion: string;
  release: string;
  compileMs: number;
  compilerCommand: string[];
  compilerSha256: string;
  hermesRevision?: string;
  binaryBytes?: number;
}
interface Job {
  target: string;
  case: string;
  expected: string | number;
  mode: "process" | "in-process";
  iterations: number;
  status: "prepared" | "semantics-failed" | "compile-failed";
  alias?: Record<string, unknown>;
  error?: string;
  old?: Artifact;
  new?: Artifact;
  pilot?: Record<string, unknown>;
}
function cleanEnv(temporary: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TMPDIR: temporary,
    XDG_CACHE_HOME: join(temporary, "cache"),
    DENO_DIR: join(temporary, "deno"),
    BUN_INSTALL_CACHE_DIR: join(temporary, "bun"),
  };
  delete env.NODE_OPTIONS;
  delete env.NODE_COMPILE_CACHE;
  return env;
}
function localRun(artifact: Artifact): string {
  const command = artifact.command.map((arg) =>
    arg.replace("/src/", `${artifact.directory}/src/`).replace("/out/", `${artifact.directory}/`),
  );
  return benchmarkOutput(
    execFileSync(command[0], command.slice(1), {
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    }),
  ).trim();
}
async function compile(
  target: Target,
  side: Side,
  workload: string,
  body: string,
  output: string,
): Promise<Artifact> {
  await mkdir(join(output, "src"), { recursive: true });
  const suffix = target.typed === "typescript" ? "ts" : target.typed === "flow" ? "flow.js" : "js";
  const source = join(output, "src", `${workload}.${suffix}`);
  await writeFile(source, body);
  const [compiler, ...prefix] = target[side];
  const release = target.releases[side === "old" ? 0 : 1];
  const runtimeVersion = execFileSync(
    compiler,
    [...(target.kind === "source" ? [] : prefix), "--version"],
    { encoding: "utf8" },
  ).trim();
  const binary = join(output, "out");
  const start = performance.now();
  const run = (args: string[], stdout?: string) => {
    const data = execFileSync(compiler, [...prefix, ...args], {
      cwd: output,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout ? writeFile(stdout, data) : undefined;
  };
  if (target.kind === "porffor") {
    run(["c", source, "-o", join(output, "out.c")]);
    run(["native", source, "-o", binary]);
  } else if (target.kind === "shermes") {
    const typed = target.typed ? ["-typed"] : [];
    run([...typed, "-O", "-emit-c", "-o", join(output, "out.c"), source]);
    await run([...typed, "-O", "-dump-ir", source], join(output, "out.ir"));
    run([...typed, "-O", "-static-link", "-o", binary, source]);
  } else if (target.kind === "scriptc")
    run(["build", source, side === "old" ? "--keep-c" : "--keep-llvm", "--emit-ir", "-o", binary]);
  else if (target.kind === "quickjs")
    run([
      "compile",
      "--engine",
      "quickjs",
      "-A",
      "--no-config",
      "--no-npm",
      "--output",
      binary,
      source,
    ]);
  const executable = target.kind === "source" ? source : binary;
  const result: Artifact = {
    directory: output,
    command:
      target.kind === "source" ? [...target[side], `/src/${workload}.${suffix}`] : ["/out/out"],
    sourceSha256: hash(body),
    artifactSha256: hash(await readFile(executable)),
    runtimeVersion,
    release,
    compileMs: performance.now() - start,
    compilerCommand: target[side],
    compilerSha256: hash(await readFile(compiler)),
    ...(target.kind === "shermes"
      ? {
          hermesRevision: (await json(join(resolve(compiler, "../.."), "manifest.json")))
            .hermesRevision,
        }
      : {}),
    ...(target.kind !== "source" ? { binaryBytes: (await readFile(binary)).length } : {}),
  };
  await save(join(output, "build.json"), result);
  return result;
}
await mkdir(directory, { recursive: true });
let jobs: Job[] = [];
if (["all", "compile"].includes(values.phase!)) {
  for (const target of targets) {
    const alias: Record<string, unknown> = {};
    if (["porffor", "scriptc", "shermes"].includes(target.kind) && !target.typed)
      for (const side of ["old", "new"] as Side[]) {
        try {
          const artifact = await compile(
            target,
            side,
            "hello",
            "const objects=[];objects.push({a:0,b:0});const object=objects[0];object.a=9;console.log(objects[0].a);\n",
            join(directory, "semantics", target.name, side),
          );
          const output = localRun(artifact);
          alias[side] = { passed: output === "9", output };
        } catch (error) {
          alias[side] = { passed: false, error: String(error) };
        }
      }
    for (const [workload, result] of Object.entries(expected)) {
      if (target.typed && workload !== "primes") continue;
      const job: Job = {
        target: target.name,
        case: workload,
        expected: result,
        mode: workload === "hello" ? "process" : "in-process",
        iterations: 1,
        status: "prepared",
        alias,
      };
      jobs.push(job);
      if (workload.startsWith("object-") && Object.values(alias).some((a: any) => !a.passed)) {
        job.status = "semantics-failed";
        await save(join(directory, "jobs.json"), jobs);
        continue;
      }
      console.log(`Prepare ${target.name}/${workload}`);
      try {
        const suffix =
          target.typed === "typescript" ? "ts" : target.typed === "flow" ? "flow.js" : "js";
        const body = await readFile(join(root, "src", `${workload}.${suffix}`), "utf8");
        const pilot: Record<string, number[]> = {};
        for (const side of ["old", "new"] as Side[]) {
          const artifact = await compile(
            target,
            side,
            workload,
            workload === "hello"
              ? body
              : loopSource(
                  body,
                  { mode: "in-process", iterations: 1, warmup: 1, samples: 2 },
                  !!target.typed,
                ),
            join(
              directory,
              target.name,
              workload,
              side,
              workload === "hello" ? "measured" : "pilot",
            ),
          );
          const output = localRun(artifact);
          if (workload === "hello") {
            if (output !== result) throw new Error(`Incorrect hello: ${output}`);
            job[side] = artifact;
          } else {
            const parsed = JSON.parse(output);
            if (parsed.result !== result || parsed.durations.length !== 3)
              throw new Error(`Incorrect pilot: ${output}`);
            pilot[side] = parsed.durations;
          }
        }
        if (workload !== "hello") {
          job.pilot = pilot;
          job.iterations = Math.min(
            500,
            Math.max(
              1,
              Math.ceil(
                150 / Math.max(1, Math.min(median(pilot.old.slice(1)), median(pilot.new.slice(1)))),
              ),
            ),
          );
          const wrapper = loopSource(
            body,
            { mode: "in-process", iterations: job.iterations, warmup: 2, samples: 5 },
            !!target.typed,
          );
          for (const side of ["old", "new"] as Side[])
            job[side] = await compile(
              target,
              side,
              workload,
              wrapper,
              join(directory, target.name, workload, side, "measured"),
            );
          if (job.old!.sourceSha256 !== job.new!.sourceSha256)
            throw new Error("Mismatched wrapper input");
        }
        console.log(`Prepared ${target.name}/${workload}: ${job.iterations} calls/batch`);
      } catch (error) {
        job.status = "compile-failed";
        job.error = String(error);
        console.error(job.error);
      }
      await save(join(directory, "jobs.json"), jobs);
    }
  }
} else jobs = await json(join(directory, "jobs.json"));
const power = () => ({
  battery: execFileSync("pmset", ["-g", "batt"], { encoding: "utf8" }),
  settings: execFileSync("pmset", ["-g", "custom"], { encoding: "utf8" }),
});
if (["all", "measure"].includes(values.phase!)) {
  await save(join(directory, "environment.json"), {
    recordedAt: new Date().toISOString(),
    cpu: cpus()[0]?.model,
    platform: process.platform,
    arch: process.arch,
    kernel: release(),
    supervisor: { executable: process.execPath, version: process.version },
    power: power(),
    protocol:
      "5 paired rounds; alternating old/new order and reversed case order in alternate rounds. Identical input + calls/batch within each pair, ~150ms target for the faster pilot. 2 warmup + 5 measured batches per fresh process; hello 3 warmup + 15 spawn-to-exit samples. Serial execution; fresh cache/input directories per condition. Standard release compiler settings. No frequency/thermal control.",
  });
  for (let round = 1; round <= 5; round++) {
    await save(join(directory, `power-round-${round}.json`), power());
    const ordered = round % 2 ? jobs : [...jobs].reverse();
    for (const job of ordered) {
      if (job.status !== "prepared") continue;
      for (const side of (round + jobs.indexOf(job)) % 2 ? ["old", "new"] : ["new", "old"]) {
        const artifact = job[side as Side]!;
        const output = join(directory, job.target, job.case, side, `round-${round}`);
        await mkdir(output, { recursive: true });
        const temporary = await mkdtemp(join(tmpdir(), "tool-update-performance-"));
        try {
          const path = join(output, "config.json");
          await save(path, {
            name: `${job.target}-${side}-${job.case}`,
            round,
            workload: job.case,
            mode: job.mode,
            iterations: job.iterations,
            samples: job.mode === "process" ? 15 : 5,
            warmup: job.mode === "process" ? 3 : 2,
            expected: job.expected,
            backend: "host",
            execution: artifact.command[0] === "/out/out" ? "binary" : "source",
            runtimeVersion: artifact.runtimeVersion,
            release: artifact.release,
            artifactSha256: artifact.artifactSha256,
            sourceSha256: artifact.sourceSha256,
            hermesRevision: artifact.hermesRevision,
            command: artifact.command,
            args: [],
            supervisor: { executable: process.execPath, version: process.version },
            inputPaths: {
              source: join(artifact.directory, "src"),
              output: artifact.directory,
              temporary,
            },
          });
          const entry =
            artifact.command[0] === "/out/out"
              ? join(artifact.directory, "out")
              : join(artifact.directory, "src", artifact.command.at(-1)!.split("/").at(-1)!);
          if (hash(await readFile(entry)) !== artifact.artifactSha256)
            throw new Error("Changed artifact");
          console.log(`Measure round ${round}: ${job.target}/${job.case}/${side}`);
          await execute(process.execPath, [join(root, "scripts/benchmark-runner.ts"), path], {
            env: cleanEnv(temporary),
          });
        } catch (error) {
          await save(join(output, "failure.json"), { error: String(error) });
          console.error(error);
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
      }
    }
  }
}
const results: any[] = [];
for (const job of jobs) {
  const sides: Record<string, any> = {};
  for (const side of ["old", "new"]) {
    const rounds = [];
    for (let round = 1; round <= 5; round++)
      try {
        rounds.push(
          await json(join(directory, job.target, job.case, side, `round-${round}/result.json`)),
        );
      } catch {}
    sides[side] = {
      ...job[side as Side],
      rounds,
      medianMs: rounds.length ? median(rounds.map((r) => r.stats.medianMs)) : undefined,
      roundMedianRangeMs: rounds.length
        ? [
            Math.min(...rounds.map((r) => r.stats.medianMs)),
            Math.max(...rounds.map((r) => r.stats.medianMs)),
          ]
        : undefined,
    };
  }
  const pairedRatios = sides.old.rounds
    .map(
      (r: any) =>
        sides.new.rounds.find((n: any) => n.round === r.round)?.stats.medianMs / r.stats.medianMs,
    )
    .filter(Number.isFinite);
  results.push({
    ...job,
    ...sides,
    status:
      job.status === "prepared"
        ? sides.old.rounds.length === 5 && sides.new.rounds.length === 5
          ? "passed"
          : "incomplete"
        : job.status,
    newOverOld: sides.new.medianMs / sides.old.medianMs || undefined,
    pairedNewOverOld: pairedRatios,
    pairedRatioRange: pairedRatios.length
      ? [Math.min(...pairedRatios), Math.max(...pairedRatios)]
      : undefined,
  });
}
await save(join(directory, "results.json"), { recordedAt: new Date().toISOString(), results });
for (const r of results)
  console.log(
    `${r.target}\t${r.case}\t${r.status}\t${r.old.medianMs ?? "—"}\t${r.new.medianMs ?? "—"}\t${r.newOverOld ?? "—"}`,
  );
