import { copyFileSync, cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Called once before any timestamps are taken. Only execution inputs are
// copied: no compiler intermediates, reports or previous runtime caches.
export function stageBenchmarkInputs(
  command: string[],
  args: string[],
  paths = { source: "/src", output: "/out", temporary: tmpdir() },
  includeDependencies = true,
): { command: string[]; args: string[]; directory: string } {
  const directory = mkdtempSync(join(paths.temporary, "native-js-inputs-"));
  const source = join(directory, "src");
  const output = join(directory, "out");
  cpSync(paths.source, source, {
    recursive: true,
    dereference: true,
    // Workspace links can point outside the Docker source mount. Only npm-cli
    // needs dependencies, and its source is supplied by a self-contained deploy.
    filter: (path) => includeDependencies || path !== join(paths.source, "node_modules"),
  });
  mkdirSync(output);
  if (command[0] === "/out/out") copyFileSync(join(paths.output, "out"), join(output, "out"));
  if (command.some((value) => value.startsWith("/out/src/")))
    cpSync(join(paths.output, "src"), join(output, "src"), { recursive: true, dereference: true });
  const relocate = (value: string): string => {
    if (value === "/src" || value.startsWith("/src/")) return source + value.slice(4);
    if (value === "/out" || value.startsWith("/out/")) return output + value.slice(4);
    return value;
  };
  return { command: command.map(relocate), args: args.map(relocate), directory };
}
