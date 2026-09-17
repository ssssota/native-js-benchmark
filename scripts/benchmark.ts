import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { renderSteps, dockerBuildDirectory } from "./docker.ts";
import { compilePlan } from "./compilers/index.ts";
import { Workflow } from "./workflow.ts";
import { sourceName, type Workload } from "./variants.ts";
import { benchmarkName, isSource, type BenchmarkTarget } from "./benchmark-targets.ts";

export interface BenchmarkOptions {
  mode: string;
  samples: number;
  iterations: number;
  warmup: number;
}

// Only the three self-contained workloads are accepted. Fail closed if their
// single observable result changes shape, rather than silently timing logging.
export function loopSource(source: string, options: BenchmarkOptions): string {
  const match = /console\.log\(([^\n]+)\);\s*$/.exec(source);
  if (!match || source.match(/console\.log\(/g)?.length !== 1)
    throw new Error("Expected one final console.log(result) in the workload.");
  const body = source.slice(0, match.index) + `return ${match[1]};`;
  return `function benchmarkWorkload() {\n${body}\n}\n
var durations = [];
var result;
for (var sample = 0; sample < ${options.warmup + options.samples}; sample++) {
  var start = Date.now();
  for (var iteration = 0; iteration < ${options.iterations}; iteration++) {
    result = benchmarkWorkload();
  }
  durations.push(Date.now() - start);
}
console.log(JSON.stringify({durations: durations, result: result}));
`;
}

export function asyncLoopSource(source: string, options: BenchmarkOptions): string {
  const entry = "fetchJsonWorkload().then((result) => console.log(result));";
  if (!source.trimEnd().endsWith(entry)) throw new Error("Unexpected fetch-json entry point.");
  return (
    source.trimEnd().slice(0, -entry.length) +
    `
async function benchmarkLoop() {
  var durations = [];
  var result;
  for (var sample = 0; sample < ${options.warmup + options.samples}; sample++) {
    var start = Date.now();
    for (var iteration = 0; iteration < ${options.iterations}; iteration++) {
      result = await fetchJsonWorkload();
    }
    durations.push(Date.now() - start);
  }
  console.log(JSON.stringify({durations: durations, result: result}));
}
benchmarkLoop();
`
  );
}

export async function benchmark(
  workflow: Workflow,
  v: BenchmarkTarget,
  workload: Workload,
  options: BenchmarkOptions,
  args: string[],
): Promise<void> {
  const docker = workflow.docker;
  const source = isSource(v);
  const name = `${benchmarkName(v)}-${workload}`;
  const directory = join(dockerBuildDirectory(docker.root), `bench-${options.mode}-${name}`);
  await mkdir(directory, { recursive: true });
  let output = source ? directory : workflow.output(v, workload);
  if (options.mode === "in-process") {
    output = directory;
    const sourceDirectory = join(directory, "src");
    const inputName = source ? `${workload}.js` : sourceName(v, workload);
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(
      join(sourceDirectory, inputName),
      (workload === "fetch-json" ? asyncLoopSource : loopSource)(
        await readFile(join(docker.root, "src", inputName), "utf8"),
        options,
      ),
    );
    if (!isSource(v)) {
      await docker.build(v.tool);
      await docker.run(v.tool, ["sh", "-ec", renderSteps(compilePlan(v, workload))], {
        sourceDirectory,
        mounts: [`${output}:/out`],
      });
    }
  } else if (!source) {
    await access(join(output, "out")).catch(() => {
      throw new Error(`Compile ${name} before benchmarking.`);
    });
  }
  // Every measured child uses the same OS libraries and Node supervisor.
  await docker.build("benchmark");
  const sourceDirectory = workload === "npm-cli" ? await workflow.deps() : undefined;
  const entry = options.mode === "in-process" ? `/out/src/${workload}.js` : `/src/${workload}.js`;
  const command = source
    ? [v.tool, ...(v.tool === "deno" ? ["run", "-A"] : []), entry]
    : ["/out/out"];
  const artifact = source
    ? options.mode === "in-process"
      ? join(output, "src", `${workload}.js`)
      : join(docker.root, "src", `${workload}.js`)
    : join(output, "out");
  const expected = (
    { hello: "hello", primes: 9592, json: 1491500, "fetch-json": 14915 } as Partial<
      Record<Workload, string | number>
    >
  )[workload];
  await writeFile(
    join(directory, "config.json"),
    JSON.stringify({
      ...options,
      name,
      workload,
      image: docker.image("benchmark"),
      buildImage: source ? undefined : docker.image(v.tool),
      execution: source ? "source" : "binary",
      command,
      args,
      expected,
      [source ? "entrySourceSha256" : "binarySha256"]: createHash("sha256")
        .update(await readFile(artifact))
        .digest("hex"),
    }),
  );
  await docker.run("benchmark", ["node", "/scripts/benchmark-runner.ts"], {
    sourceDirectory,
    mounts: [
      `${join(docker.root, "scripts")}:/scripts:ro`,
      `${output}:/out:ro`,
      `${directory}:/report`,
    ],
    env: ["TMPDIR=/tmp"],
  });
  console.log(`Samples: ${join(directory, "result.json")}`);
}
