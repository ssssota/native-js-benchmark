export const tools = [
  "node",
  "deno",
  "bun",
  "perry",
  "scriptc",
  "porffor",
  "static_hermes",
  "oseo",
  "spinel",
  "lython",
  "cpython",
  "cruby",
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
  | { tool: "node"; cache: Cache }
  | { tool: "bun"; cache: Cache; channel?: "canary" }
  | { tool: "bun"; aot: true; language?: "typescript"; trim?: true }
  | { tool: "deno"; engine: "v8"; cache: Cache }
  | { tool: "deno"; engine: "quickjs" }
  | { tool: "perry" | "scriptc" | "oseo"; language?: "typescript" }
  | { tool: "static_hermes"; language?: "flow" }
  | { tool: "porffor" | "spinel" | "lython" }
  | { tool: "cpython" | "cruby" };

export const variants: Variant[] = [
  { tool: "node", cache: "off" },
  { tool: "node", cache: "on" },
  { tool: "deno", engine: "v8", cache: "off" },
  { tool: "deno", engine: "v8", cache: "on" },
  { tool: "deno", engine: "quickjs" },
  { tool: "bun", cache: "off" },
  { tool: "bun", cache: "on" },
  { tool: "bun", cache: "off", channel: "canary" },
  { tool: "bun", cache: "on", channel: "canary" },
  { tool: "bun", aot: true },
  { tool: "bun", aot: true, language: "typescript" },
  { tool: "bun", aot: true, trim: true },
  { tool: "bun", aot: true, language: "typescript", trim: true },
  { tool: "perry" },
  { tool: "perry", language: "typescript" },
  { tool: "scriptc" },
  { tool: "scriptc", language: "typescript" },
  { tool: "porffor" },
  { tool: "static_hermes" },
  { tool: "static_hermes", language: "flow" },
  { tool: "oseo" },
  { tool: "oseo", language: "typescript" },
  { tool: "spinel" },
  { tool: "lython" },
];

export const sourceTools = ["node", "deno", "bun", "cpython", "cruby"] as const;
export type SourceTool = (typeof sourceTools)[number];
export const isInterpreter = (tool: string) => tool === "cpython" || tool === "cruby";
export const sourceLanguage = (tool: string) =>
  tool === "spinel" || tool === "cruby"
    ? "ruby"
    : tool === "lython" || tool === "cpython"
      ? "python"
      : "javascript";

export function variantName(v: Variant): string {
  if (v.tool === "bun") {
    if ("aot" in v) return `bun-aot${v.language ? "-typescript" : ""}${v.trim ? "-trim" : ""}`;
    return `bun${v.channel ? "-canary" : ""}-cache-${v.cache}`;
  }
  if (v.tool === "deno")
    return v.engine === "quickjs" ? "deno-quickjs" : `deno-v8-cache-${v.cache}`;
  if ("language" in v && v.language) return `${v.tool}-${v.language}`;
  return "cache" in v ? `${v.tool}-cache-${v.cache}` : v.tool;
}

export const usesBunCanary = (v: { tool: string; channel?: string; aot?: boolean }) =>
  v.tool === "bun" && (v.channel === "canary" || v.aot === true);

export function sourceName(v: { tool: string; language?: string }, workload: Workload): string {
  if (v.tool === "lython" && workload === "json") return "json.lython.py";
  if (v.tool === "cpython" && workload === "json") return "json.cpython.py";
  if (sourceLanguage(v.tool) === "ruby") return `${workload}.rb`;
  if (sourceLanguage(v.tool) === "python") return `${workload}.py`;
  if ("language" in v && v.language === "typescript") return `${workload}.ts`;
  if ("language" in v && v.language === "flow") return `${workload}.flow.js`;
  return `${workload}.js`;
}

export function requireWorkload(tool: string, workload: Workload): void {
  if (
    sourceLanguage(tool) !== "javascript" &&
    !["hello", "primes", "json", "object-stable", "object-churn"].includes(workload)
  )
    throw new Error(
      `${tool}: Ruby/Python ports support hello, primes, json, object-stable and object-churn.`,
    );
}

export function selectVariant(tool: Tool, cache: Cache, engine: "v8" | "quickjs"): Variant {
  if (engine === "quickjs") {
    if (tool !== "deno" || cache !== "off")
      throw new Error("QuickJS requires --tool deno and --cache off.");
    return { tool, engine };
  }
  if (tool === "deno") return { tool, engine, cache };
  if (tool === "node") return { tool, cache };
  if (tool === "bun") return { tool, cache };
  if (cache !== "off") throw new Error("--cache on applies only to Node, Bun, and Deno/V8.");
  return { tool };
}
