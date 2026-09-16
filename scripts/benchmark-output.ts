import { stripVTControlCharacters } from "node:util";

// Normalize only for validation; preserve the original output in reports.
export function benchmarkOutput(output: string): string {
  return stripVTControlCharacters(output);
}
