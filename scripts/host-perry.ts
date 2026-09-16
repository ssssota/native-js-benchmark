import type { Step } from "./docker.ts";
import type { Workload } from "./variants.ts";

export function hostPerryPlan(workload: Workload): Step[] {
  // Keep Perry's project discovery and intermediate files out of the workspace.
  // npm-cli (the only workload with imports) is not supported by host yet.
  return [
    { argv: ["mkdir", "-p", "/out/intermediates"] },
    { argv: ["cp", `/src/${workload}.js`, `/out/intermediates/${workload}.js`] },
    {
      cwd: "/out/intermediates",
      argv: [
        "perry",
        "compile",
        `/out/intermediates/${workload}.js`,
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
