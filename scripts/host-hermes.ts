import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Step } from "./docker.ts";
import { sourceName, type Variant, type Workload } from "./variants.ts";

// static-hermes-cli is installed and pinned by mise. The executable resolves
// its bundled headers and static libraries relative to its own installation.
export const shermesPath = (_root: string): string => "shermes";

interface StaticHermesManifest {
  version: string;
  hermesRevision: string;
  platform: string;
}

export function shermesManifest(): StaticHermesManifest {
  const executable = execFileSync("mise", ["which", "shermes"], {
    encoding: "utf8",
  }).trim();
  const manifestPath = join(dirname(dirname(executable)), "manifest.json");
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    !manifest ||
    typeof manifest !== "object" ||
    typeof (manifest as Record<string, unknown>).version !== "string" ||
    typeof (manifest as Record<string, unknown>).hermesRevision !== "string" ||
    typeof (manifest as Record<string, unknown>).platform !== "string"
  )
    throw new Error(`Invalid static Hermes manifest: ${manifestPath}`);
  return manifest as StaticHermesManifest;
}

export function hostHermesPlan(root: string, variant: Variant, workload: Workload): Step[] {
  const compiler = shermesPath(root);
  const source = `/src/${sourceName(variant, workload)}`;
  const typed = "language" in variant && variant.language === "flow" ? ["-typed"] : [];
  return [
    { argv: [compiler, ...typed, "-O", "-emit-c", "-o", "/out/out.c", source] },
    { argv: [compiler, ...typed, "-O", "-dump-ir", source], stdout: "/out/out.ir" },
    {
      argv: [
        compiler,
        ...typed,
        "-O",
        "-static-link",
        "-o",
        "/out/out",
        source,
      ],
    },
  ];
}
