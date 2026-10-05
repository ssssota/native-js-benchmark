export const tools = [
  "node",
  "deno",
  "bun",
  "perry",
  "scriptc",
  "porffor",
  "static_hermes",
  "oseo",
] as const;
export type Tool = (typeof tools)[number];
export const workloads = [
  "hello",
  "node-process",
  "object-stable",
  "object-churn",
  "primes",
  "json",
  "fetch-json",
  "file-cli",
  "http-server",
  "npm-cli",
] as const;
export type Workload = (typeof workloads)[number];
export type Cache = "off" | "on";
export type Variant =
  | { tool: "node" | "bun"; cache: Cache }
  | { tool: "deno"; engine: "v8"; cache: Cache }
  | { tool: "deno"; engine: "quickjs" }
  | { tool: "perry" | "scriptc" | "oseo"; language?: "typescript" }
  | { tool: "static_hermes"; language?: "flow" }
  | { tool: "porffor" };

export const variants: Variant[] = [
  { tool: "node", cache: "off" },
  { tool: "node", cache: "on" },
  { tool: "deno", engine: "v8", cache: "off" },
  { tool: "deno", engine: "v8", cache: "on" },
  { tool: "deno", engine: "quickjs" },
  { tool: "bun", cache: "off" },
  { tool: "bun", cache: "on" },
  { tool: "perry" },
  { tool: "perry", language: "typescript" },
  { tool: "scriptc" },
  { tool: "scriptc", language: "typescript" },
  { tool: "porffor" },
  { tool: "static_hermes" },
  { tool: "static_hermes", language: "flow" },
  { tool: "oseo" },
  { tool: "oseo", language: "typescript" },
];

export function variantName(v: Variant): string {
  if (v.tool === "deno")
    return v.engine === "quickjs" ? "deno-quickjs" : `deno-v8-cache-${v.cache}`;
  if ("language" in v && v.language) return `${v.tool}-${v.language}`;
  return "cache" in v ? `${v.tool}-cache-${v.cache}` : v.tool;
}

export function sourceName(v: Variant, workload: Workload): string {
  if ("language" in v && v.language === "typescript") return `${workload}.ts`;
  if ("language" in v && v.language === "flow") return `${workload}.flow.js`;
  return `${workload}.js`;
}

export function selectVariant(tool: Tool, cache: Cache, engine: "v8" | "quickjs"): Variant {
  if (engine === "quickjs") {
    if (tool !== "deno" || cache !== "off")
      throw new Error("QuickJS requires --tool deno and --cache off.");
    return { tool, engine };
  }
  if (tool === "deno") return { tool, engine, cache };
  if (tool === "node" || tool === "bun") return { tool, cache };
  if (cache !== "off") throw new Error("--cache on applies only to Node, Bun, and Deno/V8.");
  return { tool };
}
