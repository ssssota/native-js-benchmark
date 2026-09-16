// Executed only inside the benchmark container using the pinned Linux Node.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { arch, release, platform, cpus } from "node:os";
import { dirname, join } from "node:path";
import { benchmarkOutput } from "./benchmark-output.ts";
import { stageBenchmarkInputs } from "./benchmark-inputs.ts";
import { startFetchFixture } from "./fetch-fixture.ts";

const configPath = process.argv[2] ?? "/report/config.json";
const config = JSON.parse(readFileSync(configPath, "utf8"));
const inputs = stageBenchmarkInputs(
  config.command ?? ["/out/out"],
  config.args,
  config.inputPaths,
  !config.workload || config.workload === "npm-cli",
);
const fixture = config.workload === "fetch-json" ? await startFetchFixture() : undefined;
try {
  function run(): string {
    const [program, ...args] = inputs.command;
    return execFileSync(program, [...args, ...inputs.args], {
      encoding: "utf8",
      // In-process mode runs every batch in a single child.
      timeout: config.mode === "in-process" ? 600_000 : 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  const samples: number[] = [];
  let result: unknown;
  if (config.mode === "process") {
    for (let i = 0; i < config.warmup + config.samples; i++) {
      const start = process.hrtime.bigint();
      const output = run();
      samples.push(Number(process.hrtime.bigint() - start) / 1e6);
      if (i && benchmarkOutput(output) !== benchmarkOutput(String(result)))
        throw new Error("Workload output changed between runs.");
      result = output;
    }
  } else {
    const raw = run();
    if (!raw.trim())
      throw new Error("Workload exited without an in-process result; refusing to report timing.");
    const output = JSON.parse(raw);
    if (
      !Array.isArray(output.durations) ||
      output.durations.length !== config.warmup + config.samples ||
      !output.durations.every((n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0)
    )
      throw new Error("Invalid in-process samples.");
    samples.push(...output.durations.map((n: number) => n / config.iterations));
    result = output.result;
  }
  if (
    config.expected !== undefined &&
    (config.mode === "process"
      ? benchmarkOutput(String(result)).trim() !== String(config.expected)
      : result !== config.expected)
  )
    throw new Error("Incorrect workload result; refusing to report timing.");
  const measured = samples.slice(config.warmup);
  const requests = await fixture?.requests();
  if (
    fixture &&
    requests !==
      (config.samples + config.warmup) * (config.mode === "in-process" ? config.iterations : 1)
  )
    throw new Error(`Unexpected HTTP request count: ${requests}`);
  const sorted = [...measured].sort((a, b) => a - b);
  const quantile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  const stats = {
    firstMs: measured[0],
    medianMs: quantile(0.5),
    p95Ms: quantile(0.95),
    minMs: sorted[0],
    meanMs: measured.reduce((a, b) => a + b, 0) / measured.length,
    lastMs: measured.at(-1),
  };
  writeFileSync(
    join(dirname(configPath), "result.json"),
    JSON.stringify(
      {
        ...config,
        inputStorage: config.backend === "host" ? "host-local" : "container-local",
        platform: platform(),
        cpu: cpus()[0]?.model,
        fixture: fixture
          ? {
              endpoint: "http://127.0.0.1:31337/data",
              records: 1000,
              requests,
              readiness: "IPC after listen",
              connectionPolicy: "runtime defaults; sequential requests",
            }
          : undefined,
        measuredCommand: inputs.command,
        measuredArgs: inputs.args,
        timestamp: new Date().toISOString(),
        arch: arch(),
        kernel: release(),
        clock:
          config.mode === "process"
            ? "hrtime (parent spawn-to-exit)"
            : "Date.now (1 ms batch resolution)",
        cachePolicy:
          config.backend === "host"
            ? "fresh temporary/cache directories; retained between samples, including warmup"
            : "fresh container tmp; retained between samples, including warmup",
        samplesMs: samples,
        stats,
        result,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `${config.name} ${config.mode}: median ${stats.medianMs.toFixed(3)} ms/op, p95 ${stats.p95Ms.toFixed(3)}, first ${stats.firstMs.toFixed(3)}, last ${stats.lastMs!.toFixed(3)}`,
  );
  if (measured.some((n) => n === 0))
    console.warn(
      "Zero-duration samples: increase --iterations; the in-process clock has 1 ms resolution.",
    );
} finally {
  await fixture?.stop();
}
