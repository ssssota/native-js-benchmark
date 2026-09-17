import type { Step } from "./docker.ts";
import { sourceName, type Variant, type Workload } from "./variants.ts";

export function hostPerryPlan(variant: Variant, workload: Workload): Step[] {
  const source = sourceName(variant, workload);
  // Keep Perry's project discovery and intermediate files out of the workspace.
  // npm-cli (the only workload with imports) is not supported by host yet.
  return [
    { argv: ["mkdir", "-p", "/out/intermediates"] },
    { argv: ["cp", `/src/${source}`, `/out/intermediates/${source}`] },
    {
      cwd: "/out/intermediates",
      argv: [
        "perry",
        "compile",
        `/out/intermediates/${source}`,
        "--no-cache",
        "--keep-intermediates",
        "--trace",
        "llvm",
        "-o",
        "/out/out",
      ],
    },
  ];
}
