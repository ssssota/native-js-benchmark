import { parseArgs } from "node:util";
import {
  tools,
  workloads,
  selectVariant,
  variants,
  variantName,
  sourceTools,
  isInterpreter,
  requireWorkload,
} from "./variants.ts";
import type { Tool, Workload } from "./variants.ts";
import { benchmarkTargets } from "./benchmark-targets.ts";

export function parseOptions(args: string[]) {
  const command = args[0] ?? "help";
  if (
    ![
      "help",
      "--help",
      "-h",
      "build",
      "deps",
      "compile",
      "run",
      "run-binary",
      "sizes",
      "bench",
      "bench-results",
    ].includes(command)
  )
    throw new Error(`Unknown command: ${command}`);
  const separator = args.indexOf("--");
  const forwarded = separator < 0 ? [] : args.slice(separator + 1);
  const { values, positionals } = parseArgs({
    args: args.slice(1, separator < 0 ? undefined : separator),
    strict: true,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      backend: { type: "string" },
      tool: { type: "string" },
      workload: { type: "string" },
      port: { type: "string" },
      all: { type: "boolean" },
      variants: { type: "boolean" },
      "image-prefix": { type: "string" },
      "image-tag": { type: "string" },
      "skip-image-build": { type: "boolean" },
      mode: { type: "string" },
      execution: { type: "string" },
      samples: { type: "string" },
      iterations: { type: "string" },
      warmup: { type: "string" },
    },
  });
  if (positionals.length) throw new Error("Put program arguments after --.");
  const backend = values.backend ?? "docker";
  if (!["docker", "host"].includes(backend)) throw new Error("--backend must be docker or host.");
  const toolName = values.tool ?? "node";
  const exactVariant = variants.find((v) => variantName(v) === toolName);
  const sourceTool = sourceTools.find((t) => `${t}-source` === toolName);
  const tool = sourceTool ?? exactVariant?.tool ?? toolName;
  const workload = values.workload ?? "hello";
  if (!tools.includes(tool as Tool)) throw new Error(`Unknown tool: ${toolName}`);
  if (!workloads.includes(workload as Workload)) throw new Error(`Unknown workload: ${workload}`);
  if (!values.all && !["help", "--help", "-h", "build", "deps"].includes(command))
    requireWorkload(tool, workload as Workload);
  const port = Number(values.port ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("--port must be an integer from 1 to 65535.");
  if (values.all && values.variants) throw new Error("Choose --all or --variants.");
  if (values.all && values.tool) throw new Error("--all selects every tool; omit --tool.");
  if (values.all && !["build", "compile", "bench"].includes(command))
    throw new Error("--all is available for build and compile.");
  if (values.variants && !["compile", "bench"].includes(command))
    throw new Error("--variants is available for compile.");
  if (values.variants && (sourceTool || isInterpreter(tool) || toolName !== tool))
    throw new Error("--variants requires a tool family such as deno or bun.");
  if (forwarded.length && !["run", "run-binary", "bench"].includes(command))
    throw new Error("Program arguments are available for run and run-binary.");
  if (values.port && (!["run", "run-binary"].includes(command) || workload !== "http-server"))
    throw new Error("--port is only available when running http-server.");
  if (command === "run" && toolName !== tool && !sourceTool)
    throw new Error(
      "Use run-binary for compiled configurations, or run --tool node-source for source.",
    );
  if ((sourceTool || isInterpreter(tool)) && ["compile", "run-binary", "sizes"].includes(command))
    throw new Error(`${toolName} is source-only; choose a compiled configuration.`);
  if (["build", "deps"].includes(command) && values.workload)
    throw new Error("build/deps do not take workload options.");
  if (command === "build" && values["skip-image-build"])
    throw new Error("--skip-image-build cannot be used with build.");
  const variant = exactVariant ?? selectVariant(tool as Tool, "off", "v8");
  const execution =
    values.execution ??
    (sourceTool || isInterpreter(tool)
      ? "source"
      : command === "bench-results" && toolName === tool
        ? "both"
        : "binary");
  if (!["binary", "source", "both"].includes(execution))
    throw new Error("--execution must be binary, source or both.");
  if (values.execution && !["bench", "bench-results"].includes(command))
    throw new Error("--execution requires bench or bench-results.");
  if ((sourceTool || isInterpreter(tool)) && execution !== "source")
    throw new Error("A source tool requires --execution source.");
  if (!sourceTool && toolName !== tool && execution !== "binary")
    throw new Error(
      "A compiled tool requires --execution binary; use a tool family to select both.",
    );
  const mode = values.mode ?? "process";
  if (mode !== "process" && mode !== "in-process")
    throw new Error("--mode must be process or in-process.");
  const positive = (name: "samples" | "iterations" | "warmup", fallback: number) => {
    const n = Number(values[name] ?? fallback);
    if (!Number.isSafeInteger(n) || n < (name === "warmup" ? 0 : 1))
      throw new Error(`Invalid --${name}.`);
    return n;
  };
  const benchmark = {
    mode,
    samples: positive("samples", mode === "in-process" ? 5 : 50),
    iterations: positive("iterations", 50),
    warmup: positive("warmup", mode === "in-process" ? 1 : 5),
  };
  if (
    command !== "bench" &&
    [
      command === "bench-results" ? undefined : values.mode,
      values.samples,
      values.iterations,
      values.warmup,
    ].some((v) => v !== undefined)
  )
    throw new Error("Benchmark options require bench.");
  if (command === "bench") {
    if (workload === "http-server")
      throw new Error(
        "http-server requires a readiness/request benchmark; bench only accepts terminating workloads.",
      );
    if (
      mode === "in-process" &&
      (!["hello", "primes", "json", "fetch-json", "object-stable", "object-churn"].includes(
        workload,
      ) ||
        forwarded.length)
    )
      throw new Error(
        "in-process supports hello/primes/json/fetch-json/object-stable/object-churn without program arguments.",
      );
    if (mode === "process" && values.iterations)
      throw new Error("--iterations is for in-process; use --samples for process.");
  }
  const selected = ["sizes", "bench-results"].includes(command)
    ? exactVariant || sourceTool || isInterpreter(tool)
      ? [variant]
      : values.tool
        ? variants.filter((v) => v.tool === tool)
        : variants
    : values.all
      ? variants
      : values.variants
        ? variants.filter((v) => v.tool === tool)
        : [variant];
  if (execution === "source" && values.tool && !sourceTools.includes(tool as any))
    throw new Error("Source execution supports node, deno, bun, cpython and cruby only.");
  const benchmarkSelected =
    !values.tool && (command === "bench-results" || (command === "bench" && values.all))
      ? [...selected, { tool: "cpython" as const }, { tool: "cruby" as const }]
      : selected;
  return {
    backend,
    benchmarkSelected: benchmarkTargets(benchmarkSelected, execution),
    command: values.help || ["--help", "-h"].includes(command) ? "help" : command,
    benchmark,
    tool: tool as Tool,
    workload: workload as Workload,
    variant,
    selected,
    all: values.all ?? false,
    port,
    args: separator < 0 && workload === "file-cli" ? ["/src/fixtures/input.txt"] : forwarded,
    prefix: values["image-prefix"] ?? "native-js-dream",
    tag: values["image-tag"] ?? "check",
    buildImages: !values["skip-image-build"],
  };
}
