import {
  variantName,
  sourceTools,
  isInterpreter,
  type Variant,
  type SourceTool,
} from "./variants.ts";

export type SourceTarget = { tool: SourceTool; execution: "source" };
export type BenchmarkTarget = Variant | SourceTarget;
export const isSource = (target: BenchmarkTarget): target is SourceTarget => "execution" in target;
export const benchmarkName = (target: BenchmarkTarget): string =>
  isSource(target) ? `${target.tool}-source` : variantName(target);

export function benchmarkTargets(selected: Variant[], execution: string): BenchmarkTarget[] {
  const sources: SourceTarget[] = [];
  for (const { tool } of selected) {
    if (sourceTools.includes(tool as SourceTool) && !sources.some((s) => s.tool === tool))
      sources.push({ tool: tool as SourceTool, execution: "source" });
  }
  return execution === "binary"
    ? selected.filter((v) => !isInterpreter(v.tool))
    : execution === "source"
      ? sources
      : [...selected.filter((v) => !isInterpreter(v.tool)), ...sources];
}
