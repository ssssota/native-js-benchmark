import type { Step } from "../docker.ts";
import type { Cache, Variant, Workload } from "../variants.ts";

export function nodePlan(cache: Cache, workload: Workload): Step[] {
  if (!["hello", "primes", "json", "fetch-json"].includes(workload))
    throw new Error("Node SEA: imports require a bundling step; choose hello, primes, json or fetch-json.");
  const config = JSON.stringify(
    {
      main: `/src/${workload}.js`,
      output: "/out/out.blob",
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: cache === "on",
    },
    null,
    2,
  );
  return [
    {
      argv: [
        "node",
        "-e",
        'require("node:fs").writeFileSync(process.argv[1], process.argv[2])',
        "/out/out.sea.json",
        config,
      ],
    },
    { argv: ["node", "--experimental-sea-config", "/out/out.sea.json"] },
    { argv: ["cp", "/usr/local/bin/node", "/out/out"] },
    {
      argv: [
        "postject",
        "/out/out",
        "NODE_SEA_BLOB",
        "/out/out.blob",
        "--sentinel-fuse",
        "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
      ],
    },
  ];
}
export function bunPlan(cache: Cache, workload: Workload): Step[] {
  // Keep module format identical when toggling bytecode.
  return [
    {
      argv: [
        "bun",
        "build",
        "--compile",
        "--format=cjs",
        ...(cache === "on" ? ["--bytecode"] : []),
        `/src/${workload}.js`,
        "--outfile",
        "/out/out",
      ],
    },
  ];
}
export function denoPlan(v: Extract<Variant, { tool: "deno" }>, workload: Workload): Step[] {
  return [
    {
      argv: [
        "deno",
        "compile",
        "--engine",
        v.engine,
        "-A",
        ...(workload === "npm-cli" ? [] : ["--no-config", "--no-npm"]),
        ...(v.engine === "v8" && v.cache === "off" ? ["--no-code-cache"] : []),
        "--output",
        "/out/out",
        `/src/${workload}.js`,
      ],
    },
  ];
}
