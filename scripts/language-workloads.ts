import { sourceName, sourceLanguage, type Workload } from "./variants.ts";
import type { BenchmarkOptions } from "./benchmark.ts";

export function sourceCommand(tool: string, entry: string): string[] {
  if (tool === "cpython") return ["python3", "-I", "-B", entry];
  if (tool === "cruby") return ["ruby", "--disable-gems", "--disable-yjit", entry];
  return [tool, ...(tool === "deno" ? ["run", "-A"] : []), entry];
}

export function languageLoopSource(
  source: string,
  tool: string,
  options: BenchmarkOptions,
  workload?: Workload,
): string {
  const language = sourceLanguage(tool);
  const final =
    language === "ruby" ? /puts benchmark_workload\s*$/ : /print\(benchmark_workload\(\)\)\s*$/;
  if (!final.test(source)) throw new Error("Expected one final benchmark_workload output.");
  const body = source.replace(final, "");
  if (language === "ruby")
    return `require "json"\n${body}
durations = []
result = nil
sample = 0
while sample < ${options.warmup + options.samples}
  start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  iteration = 0
  while iteration < ${options.iterations}
    result = benchmark_workload
    iteration += 1
  end
  durations << ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - start) * 1000.0)
  sample += 1
end
puts JSON.generate({"durations" => durations, "result" => result})
`;
  if (language === "python") {
    // Lython's json.dumps accepts a tagged JSONValue tree, not a Python dict.
    // Numeric lists/scalars have JSON-compatible str output; serialize strings
    // through its typed JSON API. This formatting stays outside timed batches.
    const initial = tool === "lython" ? (workload === "hello" ? '""' : "0") : "None";
    const output =
      tool === "lython"
        ? `print('{"durations":' + str(durations) + ',"result":' + ${workload === "hello" ? "json.dumps(json.of_str(result))" : "str(result)"} + '}')`
        : 'print(json.dumps({"durations": durations, "result": result}, separators=(",", ":")))';
    return `import time\nimport json\n${body}
durations = []
result = ${initial}
sample = 0
while sample < ${options.warmup + options.samples}:
    start = time.perf_counter()
    iteration = 0
    while iteration < ${options.iterations}:
        result = benchmark_workload()
        iteration += 1
    durations.append((time.perf_counter() - start) * 1000.0)
    sample += 1
${output}
`;
  }
  throw new Error(`No language wrapper for ${tool}`);
}

export function workloadMetadata(
  target: string | { tool: string; language?: string },
  workload: Workload,
) {
  const variant = typeof target === "string" ? { tool: target } : target;
  const tool = variant.tool;
  return {
    language: variant.language ?? sourceLanguage(tool),
    sourceFile: sourceName(variant, workload),
    ...(tool === "lython" && workload === "json"
      ? { representation: "Lython tagged JSONValue tree (typed JSON API)" }
      : {}),
    ...(sourceLanguage(tool) !== "javascript" && workload.startsWith("object-")
      ? {
          representation:
            tool === "spinel" || tool === "cruby"
              ? "Ruby Hash with string keys"
              : "Python dict with string keys",
        }
      : {}),
  };
}

export const workloadClock = (tool: string) =>
  sourceLanguage(tool) === "ruby"
    ? "Process.clock_gettime(CLOCK_MONOTONIC), milliseconds"
    : sourceLanguage(tool) === "python"
      ? "time.perf_counter, milliseconds"
      : "Date.now (1 ms batch resolution)";
