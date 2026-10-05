// Run timings serially; preserve source, C, MIR, actual build requests and every round.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loopSource } from "../benchmark.ts";
import { prepareOseo, oseoConfig, oseoDirectory } from "../host-oseo.ts";
import { execute } from "../process.ts";

const root = resolve(import.meta.dirname, "../..");
const { values } = parseArgs({
  options: {
    output: { type: "string", default: "build/oseo-study-2026-10-05" },
    phase: { type: "string", default: "all" },
    rounds: { type: "string", default: "3" },
    targets: { type: "string" },
  },
});
const directory = resolve(root, values.output!);
const rounds = Number(values.rounds);
if (!Number.isInteger(rounds) || rounds < 1) throw new Error("Invalid rounds.");
if (!["all", "compile", "measure", "inspect"].includes(values.phase!))
  throw new Error("Invalid phase.");
await mkdir(directory, { recursive: true });
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const save = (file: string, value: unknown) =>
  writeFile(file, JSON.stringify(value, null, 2) + "\n");
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const median = (numbers: number[]) =>
  [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
const { compileOseo } = await import(new URL("../oseo-compile.mjs", import.meta.url).href);
await prepareOseo(root);
const checkout = oseoDirectory(root);
const cli = await import(pathToFileURL(join(checkout, "packages/cli/dist/index.js")).href);
const version = (await json(join(checkout, "packages/cli/package.json"))).version;
type Target = {
  name: string;
  typed?: boolean;
  node?: boolean;
  optimize?: boolean;
  noSanitizers?: boolean;
  noSpecialization?: boolean;
};
type Case = {
  name: string;
  js: string;
  ts: string;
  expected: string | number;
  mode: "process" | "in-process";
  targets: Target[];
};
const standard: Target[] = [
  { name: "oseo-js" },
  { name: "oseo-ts", typed: true },
  { name: "node", node: true },
];
const controls: Target[] = [
  { name: "oseo-O2", optimize: true },
  { name: "oseo-O2-no-sanitizers", optimize: true, noSanitizers: true },
];
const cases: Case[] = [];
for (const [name, expected] of [
  ["hello", "hello"],
  ["primes", 9592],
  ["json", 1491500],
  ["object-stable", 102387360],
  ["object-churn", 102387360],
] as const) {
  cases.push({
    name,
    expected,
    js: await readFile(join(root, "src", `${name}.js`), "utf8"),
    ts: await readFile(join(root, "src", `${name}.ts`), "utf8"),
    mode: name === "hello" ? "process" : "in-process",
    targets: [...standard, ...(["primes", "object-churn"].includes(name) ? controls : [])],
  });
}
const addition = (
  typed: boolean,
) => `function add(left${typed ? ": number" : ""}, right${typed ? ": number" : ""})${typed ? ": number" : ""} { return left + right; }
var checksum = 0;
for (var i = 0; i < 20000; i++) checksum += add(i % 1024, 7);
console.log(checksum);
`;
cases.push({
  name: "addition",
  js: addition(false),
  ts: addition(true),
  expected: 10239440,
  mode: "in-process",
  targets: [
    ...standard,
    { name: "oseo-ts-no-specialization", typed: true, noSpecialization: true },
  ],
});
// Same numeric algorithm, no escaping per-iteration closures: a lexical-cell control.
const primes = cases.find((c) => c.name === "primes")!;
cases.push({
  ...primes,
  name: "primes-var",
  js: primes.js.replaceAll("let ", "var "),
  ts: primes.ts.replaceAll("let ", "var "),
  targets: [{ name: "oseo-js" }, { name: "oseo-O2", optimize: true }],
});

async function compile(source: string, target: Target, output: string): Promise<void> {
  await mkdir(output, { recursive: true });
  const entry = join(output, `entry.${target.typed ? "ts" : "js"}`);
  await writeFile(entry, source);
  if (target.node) return;
  try {
    const previous = await json(join(output, "build.json"));
    if (
      previous.sourceSha256 === hash(source) &&
      previous.oseoRevision === oseoConfig.revision &&
      JSON.stringify(previous.target) === JSON.stringify(target) &&
      previous.binarySha256 === hash(await readFile(join(output, "out")))
    )
      return;
  } catch {
    /* Rebuild incomplete or changed artifacts. */
  }
  const base = cli.defaultComponents.toolchain;
  const actualPlans: unknown[] = [];
  const effectiveTarget = (targetDescription: any) =>
    target.noSanitizers ? { ...targetDescription, sanitizers: [] } : targetDescription;
  const toolchain = {
    ...base,
    runtimeArchiveReuse: base.runtimeArchiveReuse && {
      ...base.runtimeArchiveReuse,
      // Separate sanitized/unsanitized archive identities; never mix caches.
      createKey(input: any) {
        return base.runtimeArchiveReuse.createKey({
          ...input,
          target: effectiveTarget(input.target),
        });
      },
    },
    createBuildPlan(input: any) {
      const plan = base.createBuildPlan({ ...input, target: effectiveTarget(input.target) });
      const adjusted = {
        ...plan,
        requests: plan.requests.map((request: any) => ({
          ...request,
          args: [
            ...request.args,
            ...(target.optimize && request.args.includes(input.generatedSourcePath) ? ["-O2"] : []),
          ],
        })),
      };
      actualPlans.push({ target: effectiveTarget(input.target), requests: adjusted.requests });
      return adjusted;
    },
  };
  const composition = {
    ...cli,
    defaultComponents: { ...cli.defaultComponents, toolchain },
    runNativeCli(request: any, host: any, selectedToolchain: any) {
      return cli.runNativeCli(
        {
          ...request,
          args: [...(target.noSpecialization ? ["--no-specialization"] : []), ...request.args],
        },
        host,
        selectedToolchain,
      );
    },
  };
  await compileOseo({
    cli: composition,
    host: cli.defaultComponents.createNodeHost(),
    version,
    source: entry,
    output: join(output, "out"),
  });
  await save(join(output, "build.json"), {
    target,
    sourceSha256: hash(source),
    binarySha256: hash(await readFile(join(output, "out"))),
    oseoRevision: oseoConfig.revision,
    version,
    zigVersion: execFileSync("zig", ["version"], { encoding: "utf8" }).trim(),
    actualPlans,
  });
}

function cleanEnvironment(temporary: string): NodeJS.ProcessEnv {
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
function command(target: Target, output: string): string[] {
  return target.node ? [process.execPath, join(output, "entry.js")] : [join(output, "out")];
}

type Job = {
  case: string;
  target: Target;
  expected: string | number;
  mode: "process" | "in-process";
  iterations: number;
  output: string;
  status: string;
  error?: string;
};
let jobs: Job[] = [];
if (["all", "compile"].includes(values.phase!)) {
  for (const spec of cases)
    for (const target of spec.targets) {
      const output = join(directory, spec.name, target.name);
      const job: Job = {
        case: spec.name,
        target,
        expected: spec.expected,
        mode: spec.mode,
        iterations: 1,
        output,
        status: "prepared",
      };
      jobs.push(job);
      console.log(`Prepare ${spec.name}/${target.name}`);
      try {
        const body = target.typed ? spec.ts : spec.js;
        await compile(body, target, join(output, "plain"));
        const plainOutput = execFileSync(
          command(target, join(output, "plain"))[0],
          command(target, join(output, "plain")).slice(1),
          { encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
        ).trim();
        if (plainOutput !== String(spec.expected))
          throw new Error(`Incorrect plain output: ${plainOutput}`);
        if (spec.mode === "in-process") {
          await compile(
            loopSource(
              body,
              { mode: "in-process", samples: 2, warmup: 1, iterations: 1 },
              target.node ? undefined : false,
            ),
            target,
            join(output, "pilot"),
          );
          const pilotCommand = command(target, join(output, "pilot"));
          const pilot = JSON.parse(
            execFileSync(pilotCommand[0], pilotCommand.slice(1), {
              encoding: "utf8",
              timeout: 120000,
              maxBuffer: 16 * 1024 * 1024,
            }),
          );
          if (pilot.result !== spec.expected) throw new Error("Incorrect pilot result.");
          await save(join(output, "pilot.json"), pilot);
          const milliseconds = median(pilot.durations.slice(1));
          job.iterations = Math.max(1, Math.min(500, Math.ceil(100 / Math.max(1, milliseconds))));
          await compile(
            loopSource(
              body,
              { mode: "in-process", samples: 5, warmup: 2, iterations: job.iterations },
              target.node ? undefined : false,
            ),
            target,
            join(output, "measured"),
          );
          console.log(
            `Pilot ${spec.name}/${target.name}: ${milliseconds} ms, ${job.iterations} calls/batch`,
          );
        }
      } catch (error) {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : String(error);
        console.error(job.error);
      }
      await save(join(directory, "jobs.json"), jobs);
    }
  await save(join(directory, "environment.json"), {
    timestamp: new Date().toISOString(),
    cpu: cpus()[0]?.model,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    oseoRevision: oseoConfig.revision,
    version,
    rounds,
    notes:
      "serial timing, Date.now 1ms batches, 2 warmup + 5 measured batches per fresh process, ~100ms adaptive batch target; hello spawn-to-exit includes output",
  });
} else jobs = await json(join(directory, "jobs.json"));

if (["all", "measure"].includes(values.phase!)) {
  for (let round = 1; round <= rounds; round++) {
    // Alternate order across fresh processes to expose gross ordering/thermal drift.
    for (const job of round % 2 === 0 ? [...jobs].reverse() : jobs) {
      if (job.status === "failed") continue;
      if (values.targets && !values.targets.split(",").includes(job.target.name)) continue;
      const output = join(job.output, job.mode === "process" ? "plain" : "measured");
      const report = join(job.output, `round-${round}`);
      await mkdir(report, { recursive: true });
      const temporary = await mkdtemp(join(tmpdir(), "oseo-study-"));
      try {
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
          runtimeVersion: job.target.node ? process.version : `oseo ${version}`,
          oseoRevision: job.target.node ? undefined : oseoConfig.revision,
          experimentTarget: job.target,
          command: job.target.node ? [process.execPath, "/src/entry.js"] : ["/out/out"],
          args: [],
          inputPaths: { source: output, output, temporary },
          artifactSha256: hash(await readFile(command(job.target, output).at(-1)!)),
        };
        await save(join(report, "config.json"), config);
        await rm(join(report, "failure.json"), { force: true });
        console.log(`Measure round ${round}: ${job.case}/${job.target.name}`);
        await execute(
          process.execPath,
          [join(root, "scripts/benchmark-runner.ts"), join(report, "config.json")],
          { env: cleanEnvironment(temporary) },
        );
      } catch (error) {
        await save(join(report, "failure.json"), {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
  }
}

const results = [];
for (const job of jobs) {
  const samples = [];
  for (let round = 1; round <= rounds; round++) {
    try {
      samples.push(await json(join(job.output, `round-${round}`, "result.json")));
    } catch {
      /* Failed/unmeasured rounds stay absent. */
    }
  }
  const row: any = {
    ...job,
    compileStatus: job.status,
    status:
      job.status === "failed"
        ? "compile-failed"
        : samples.length === rounds
          ? "passed"
          : samples.length
            ? "incomplete"
            : "unmeasured",
    rounds: samples,
    medianMs: samples.length ? median(samples.map((r) => r.stats.medianMs)) : undefined,
    minRoundMedianMs: samples.length
      ? Math.min(...samples.map((r) => r.stats.medianMs))
      : undefined,
    maxRoundMedianMs: samples.length
      ? Math.max(...samples.map((r) => r.stats.medianMs))
      : undefined,
  };
  if (!job.target.node && job.status !== "failed") {
    const c = await readFile(join(job.output, "plain/out.c"), "utf8");
    const mir = await readFile(join(job.output, "plain/out.mir"), "utf8");
    const normalizedC = c
      .replace(
        /oseo_context_location\(context, \d+u, \d+u\);/g,
        "oseo_context_location(context, LINE, COLUMN);",
      )
      .replace(/&context, "[^"]+", \d+u\);/g, '&context, "<source>", LENGTH);')
      .replace(
        /static const uint16_t (function_source_units_\d+)\[\] = \{[^\n]+\};/g,
        "static const uint16_t $1[] = {FUNCTION_SOURCE};",
      )
      .replace(
        /(oseo_function_set_source\(context, roots\[\d+\], function_source_units_\d+, )\d+u/g,
        "$1LENGTH",
      );
    const histogram = (matches: string[]) =>
      matches.reduce((result: Record<string, number>, name: string) => {
        result[name] = (result[name] ?? 0) + 1;
        return result;
      }, {});
    row.ir = {
      cBytes: Buffer.byteLength(c),
      mirBytes: Buffer.byteLength(mir),
      normalizedCSha256: hash(normalizedC),
      normalization:
        "Ignore source locations/path/length and embedded Function.toString source text; retain executable statements.",
      rootFrames: [...mir.matchAll(/^function (.+) roots=(\d+)/gm)].map((m) => ({
        name: m[1],
        slots: Number(m[2]),
      })),
      mirOperations: histogram(
        [...mir.matchAll(/^\s+%\d+(?:,\s*%\d+)* = ([\w-]+)/gm)].map((m) => m[1]),
      ),
      cHelpers: histogram([...c.matchAll(/\b(oseo_\w+)\(/g)].map((m) => m[1])),
      binaryBytes: (await readFile(join(job.output, "plain/out"))).length,
    };
  }
  results.push(row);
}
await save(join(directory, "results.json"), {
  environment: await json(join(directory, "environment.json")),
  results,
});
console.log(`Results: ${join(directory, "results.json")}`);
for (const row of results)
  console.log(`${row.case}\t${row.target.name}\t${row.medianMs ?? row.error ?? "unmeasured"}`);
