import { variantName, type Variant } from "./variants.ts";

export type SourceTarget = { tool: "node" | "deno" | "bun"; execution: "source" };
export type BenchmarkTarget = Variant | SourceTarget;
export const isSource = (target: BenchmarkTarget): target is SourceTarget => "execution" in target;
export const benchmarkName = (target: BenchmarkTarget): string =>
  isSource(target) ? `${target.tool}-source` : variantName(target);

export function benchmarkTargets(selected: Variant[], execution: string): BenchmarkTarget[] {
  const sources: SourceTarget[] = [];
  for (const { tool } of selected) {
    if (
      (tool === "node" || tool === "deno" || tool === "bun") &&
      !sources.some((s) => s.tool === tool)
    )
      sources.push({ tool, execution: "source" });
  }
  return execution === "binary"
    ? selected
    : execution === "source"
      ? sources
      : [...selected, ...sources];
}
