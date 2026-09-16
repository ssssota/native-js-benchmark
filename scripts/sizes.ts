import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, open } from "node:fs/promises";
import { join } from "node:path";
import type { Docker } from "./docker.ts";
import { dockerBuildDirectory } from "./docker.ts";
import { variantName, type Variant, type Workload } from "./variants.ts";

const capture = promisify(execFile);
const marker = "---RESOLVED-LIBRARIES---";

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${bytes} B`;
}
// Inspect only our generated ELF files inside their matching image.
const inspectScript = `
set -eu
status=0
ldd /artifact/out > /tmp/dependencies 2>&1 || status=$?
cat /tmp/dependencies
printf '\\n${marker}\\n'
printf 'STATUS\\t%s\\n' "$status"
awk '/=> \\// { print $3 } /^[[:space:]]*\\// { print $1 }' /tmp/dependencies | sort -u |
while IFS= read -r path; do
  resolved=$(readlink -f "$path")
  printf 'LIB\\t%s\\t%s\\n' "$resolved" "$(stat -L -c %s "$resolved")"
done
`;

export interface Library {
  path: string;
  bytes: number;
  system: boolean;
}
export function parseDependencies(output: string): { libraries: Library[]; static: boolean } {
  const [ldd, resolved] = output.split(marker);
  if (!resolved || /=>\s+not found/.test(ldd))
    throw new Error(`Unresolved ELF dependencies: ${ldd.trim()}`);
  const status = resolved.match(/^STATUS\t(\d+)$/m)?.[1];
  const isStatic = /statically linked|not a dynamic executable/.test(ldd);
  if (status === undefined || (status !== "0" && !isStatic))
    throw new Error(`ldd failed: ${ldd.trim()}`);
  const unique = new Map<string, Library>();
  for (const line of resolved.split("\n")) {
    if (!line.startsWith("LIB\t")) continue;
    const [, path, size] = line.split("\t");
    const bytes = Number(size);
    if (!path || !Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error("Invalid dependency size.");
    unique.set(path, { path, bytes, system: /^\/(?:usr\/)?lib(?:32|64)?\//.test(path) });
  }
  if (!isStatic && unique.size === 0) throw new Error(`No resolved dependencies: ${ldd.trim()}`);
  return { libraries: [...unique.values()], static: isStatic };
}

export async function sizes(
  docker: Docker,
  selected: Variant[],
  workload: Workload,
): Promise<boolean> {
  const rows: string[][] = [["Configuration", "Binary", "ELF dependencies"]];
  const notes: string[] = [];
  const binarySizes = new Map<string, number>();
  let success = true;
  for (const v of selected) {
    const name = `${variantName(v)}-${workload}`;
    const directory = join(dockerBuildDirectory(docker.root), name);
    let bytes: number;
    try {
      const file = await stat(join(directory, "out"));
      if (!file.isFile()) throw new Error("out is not a regular file");
      bytes = file.size;
      binarySizes.set(name, bytes);
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      rows.push([name, "—", missing ? "not built" : "stat error"]);
      if (!missing) {
        success = false;
        notes.push(`${name}: ${String(error)}`);
      }
      continue;
    }
    try {
      const file = await open(join(directory, "out"), "r");
      try {
        const header = Buffer.alloc(4);
        await file.read(header, 0, 4, 0);
        if (!header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])))
          throw new Error("Not an ELF binary; dependency inspection is unsupported.");
      } finally {
        await file.close();
      }
      const { stdout } = await capture(
        "docker",
        [
          "run",
          "--rm",
          "--pull=never",
          "--network=none",
          "--entrypoint",
          "sh",
          "-v",
          `${directory}:/artifact:ro`,
          docker.image(v.tool),
          "-ec",
          inspectScript,
        ],
        { timeout: 30000, maxBuffer: 1024 * 1024 },
      );
      const dependencies = parseDependencies(stdout);
      const extras = dependencies.libraries.filter((lib) => !lib.system);
      rows.push([
        name,
        formatBytes(bytes),
        dependencies.static
          ? "static"
          : extras.length
            ? "extra libraries"
            : "system libraries only",
      ]);
      for (const lib of extras)
        notes.push(
          `Warning: ${name} requires non-system library ${lib.path} (not included in Binary).`,
        );
    } catch (error) {
      success = false;
      rows.push([name, formatBytes(bytes), "inspection failed"]);
      notes.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  rows.splice(
    1,
    rows.length - 1,
    ...rows.slice(1).sort((a, b) => (binarySizes.get(b[0]) ?? -1) - (binarySizes.get(a[0]) ?? -1)),
  );
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  console.log(
    rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ")).join("\n"),
  );
  console.log(
    "\nバイナリサイズの降順。共有ライブラリ・中間ファイル・キャッシュ・外部データは含みません。",
  );
  if (notes.length) console.log("\n" + notes.join("\n"));
  return success;
}
