// Focused causal experiments; generated inputs/IR/raw output stay under build/.
// node scripts/experiments/object-shapes.ts --group semantics --tools node,scriptc,scriptc-record,scriptc-map
// node scripts/experiments/object-shapes.ts --group scaling --tools scriptc,scriptc-record,scriptc-map
// node scripts/experiments/object-shapes.ts --group throughput --tools node,node-jitless,bun,deno,porffor,perry,perry-ts,hermes,quickjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { hostCompile } from "../host.ts";
import { benchmarkOutput } from "../benchmark-output.ts";
import type { Variant } from "../variants.ts";

const root = resolve(import.meta.dirname, "../..");
const { values } = parseArgs({
  options: {
    group: { type: "string", default: "semantics" },
    tools: {
      type: "string",
      default: "node,bun,deno,porffor,perry,perry-ts,hermes,scriptc,scriptc-record,scriptc-map",
    },
    cases: { type: "string" },
    rounds: { type: "string", default: "3" },
    output: { type: "string", default: "build/object-shape-study-2026-09-25" },
    compile: { type: "string" },
    input: { type: "string" },
    destination: { type: "string" },
  },
});

function variant(target: string): Variant | undefined {
  if (target === "porffor") return { tool: "porffor" };
  if (target === "perry") return { tool: "perry" };
  if (target === "perry-ts") return { tool: "perry", language: "typescript" };
  if (target.startsWith("scriptc"))
    return {
      tool: "scriptc",
      ...(target === "scriptc" ? {} : { language: "typescript" as const }),
    };
  if (target.startsWith("hermes"))
    return { tool: "static_hermes", ...(target === "hermes" ? {} : { language: "flow" as const }) };
  if (target === "quickjs") return { tool: "deno", engine: "quickjs" };
  if (!["node", "node-jitless", "bun", "deno"].includes(target))
    throw new Error(`Unknown target ${target}`);
}

if (values.compile) {
  await hostCompile(
    root,
    variant(values.compile)!,
    "object-stable",
    values.destination!,
    values.input!,
  );
  process.exit(0);
}

interface Case {
  name: string;
  group: string;
  count: number;
  keys: number;
  steps: number;
  operation: string;
  expected?: number;
}
const cases: Case[] = [];
for (const operation of [
  "alias",
  "identity",
  "persist",
  "delete",
  "delete-read",
  "delete-keys",
  "delete-roundtrip",
])
  cases.push({
    name: `semantic-${operation}`,
    group: "semantics",
    count: 4,
    keys: 8,
    steps: 1000,
    operation,
  });
for (const count of [1, 16, 64, 256, 1024])
  cases.push({
    name: `array-${count}`,
    group: "scaling",
    count,
    keys: 8,
    steps: 20000,
    operation: "reset",
  });
cases.push({
  name: "array-256-named",
  group: "scaling",
  count: 256,
  keys: 8,
  steps: 20000,
  operation: "named",
});
for (const operation of ["reset", "drain", "keep", "empty", "dictionary", "undefined"])
  cases.push({
    name: `${operation}-8`,
    group: "throughput",
    count: 256,
    keys: 8,
    steps: 200000,
    operation,
  });
for (const keys of [32, 128])
  for (const operation of ["reset", "keep", "dictionary"])
    cases.push({
      name: `${operation}-${keys}`,
      group: "throughput",
      count: 256,
      keys,
      steps: 200000,
      operation,
    });
for (const count of [1, 4, 16])
  cases.push({
    name: `named-shapes-${count}`,
    group: "shapes",
    count,
    keys: 8,
    steps: 2000000,
    operation: "shapes",
  });

const names = (n: number) =>
  Array.from({ length: n }, (_, i) => (i < 8 ? String.fromCharCode(97 + i) : `k${i}`));
function declaration(target: string, keys: string[]): string {
  if (target === "scriptc-record") return `: { ${keys.map((k) => `${k}: number`).join("; ")} }[]`;
  if (target === "scriptc-optional") return ": { [key: string]: number | undefined }[]";
  if (target === "hermes-optional") return ": { [key: string]: number | void }[]";
  if (["scriptc-map", "perry-ts", "hermes-flow"].includes(target))
    return ": { [key: string]: number }[]";
  return "";
}

function source(c: Case, target: string): { body: string; expected: number } {
  const keys = names(c.keys);
  const decl = declaration(target, keys);
  const literal = `{${keys.map((k) => `${k}: 0`).join(", ")}}`;
  const keyType =
    target === "scriptc-record" ? `: (${keys.map((k) => JSON.stringify(k)).join(" | ")})[]` : "";
  let body = `const keys${keyType} = ${JSON.stringify(keys)};\nconst objects${decl} = [];\n`;
  if (c.group === "semantics") {
    body += `objects.push(${literal});\nconst object = objects[0];\n`;
    if (c.operation === "alias")
      return { body: body + "object.a = 7;\nconst checksum = objects[0].a;", expected: 7 };
    if (c.operation === "identity")
      return { body: body + "const checksum = object === objects[0] ? 1 : 0;", expected: 1 };
    if (c.operation === "persist")
      return {
        body:
          body +
          `for (let i = 0; i < 1000; i++) { const item = objects[0]; const previous = item.a; ${target.endsWith("-optional") ? "if (previous !== undefined) " : ""}item.a = ${target === "hermes-optional" ? "Number(previous)" : "previous"} + 1; }\nconst checksum = objects[0].a;`,
        expected: 1000,
      };
    if (c.operation === "delete-roundtrip")
      return {
        body:
          body +
          "const key = keys[0];\nobject[key] = 7;\ndelete object[key];\nconst after = object[key];\nconst checksum = after === undefined ? 1 : 0;",
        expected: 1,
      };
    if (c.operation === "delete-read")
      return {
        body:
          body + "delete object[keys[0]];\nconst checksum = object[keys[0]] === undefined ? 1 : 0;",
        expected: 1,
      };
    if (c.operation === "delete-keys")
      return {
        body: body + "delete object[keys[0]];\nconst checksum = Object.keys(object).length;",
        expected: 7,
      };
    return {
      body:
        body +
        `delete object[keys[0]];\nlet checksum = 0;\nif (object.a === undefined) checksum += 1;\nif (!("a" in object)) checksum += 2;\nif (Object.keys(object).length === 7) checksum += 4;`,
      expected: 7,
    };
  }
  if (c.operation === "shapes") {
    // Equal cardinality/values; only insertion order differs. read site is shared.
    const orders: string[][] = [];
    for (let n = 0; n < c.count; n++) {
      const order = keys.slice(n % 8).concat(keys.slice(0, n % 8));
      if (n >= 8) [order[0], order[1]] = [order[1], order[0]];
      orders.push(order);
    }
    body += "for (let j = 0; j < 256; j++) {\n";
    orders.forEach((order, i) => {
      body += `${i ? "else " : ""}if (j % ${c.count} === ${i}) objects.push({${order.map((k) => `${k}: j`).join(", ")}});\n`;
    });
    body += `}\nlet checksum = 0;\nfor (let i = 0; i < ${c.steps}; i++) { checksum += objects[i % 256].a; }`;
    let expected = 0;
    for (let i = 0; i < c.steps; i++) expected += i % 256;
    return { body, expected };
  }
  body += `for (let j = 0; j < ${c.count}; j++) {\n  objects.push(${c.operation === "empty" ? "{}" : c.operation === "dictionary" ? literal.replace("{", "{sentinel: 0, ") : literal});\n`;
  if (c.operation === "dictionary") body += "  delete objects[j].sentinel;\n";
  body += `}\nlet checksum = 0;\nfor (let i = 0; i < ${c.steps}; i++) {\n const object = objects[i % ${c.count}];\n const key = keys[Math.floor(i / ${c.count}) % ${c.keys}];\n const value = i % 1024;\n`;
  const access = c.operation === "named" ? "object.a" : "object[key]";
  body += ` ${access} = value;\n`;
  body += target.endsWith("-optional")
    ? ` const current = ${access};\n if (current !== undefined) checksum += ${target === "hermes-optional" ? "Number(current)" : "current"};\n`
    : ` checksum += ${access};\n`;
  const deleted = ["drain", "keep", "empty"].includes(c.operation);
  body += deleted
    ? ` delete ${access};\n`
    : ` ${access} = ${c.operation === "undefined" ? "undefined" : "0"};\n`;
  body += ` const after = ${access};\n if (after === ${deleted || c.operation === "undefined" ? "undefined" : "0"}) checksum += 1;\n`;
  if (c.operation === "keep") body += ` ${access} = 0;\n`;
  body += "}\n";
  let expected = c.steps;
  for (let i = 0; i < c.steps; i++) expected += i % 1024;
  return { body, expected };
}

function timed(body: string, expected: number, typed: boolean): string {
  return (
    `function benchmarkWorkload() {\n${body}\nreturn checksum;\n}\n` +
    `var failures = 0;\nvar result = 0;\nvar pilotStart = Date.now();\nfor (var p = 0; p < 2; p++) { result = benchmarkWorkload(); if (result !== ${expected}) failures++; }\n` +
    `var pilotMs = (Date.now() - pilotStart) / 2;\nvar calls = Math.max(1, Math.min(50, Math.ceil(100 / Math.max(1, pilotMs))));\n` +
    `var durations${typed ? ": number[]" : ""} = [];\nfor (var sample = 0; sample < 9; sample++) {\n var start = Date.now();\n for (var iteration = 0; iteration < calls; iteration++) { result = benchmarkWorkload(); if (result !== ${expected}) failures++; }\n durations.push(Date.now() - start);\n}\nconsole.log(JSON.stringify({durations: durations, calls: calls, result: result, failures: failures}));\n`
  );
}

const outputRoot = resolve(root, values.output!);
mkdirSync(outputRoot, { recursive: true });
const requested = values.cases?.split(",");
const selected = cases.filter(
  (c) =>
    (values.group === "all" || c.group === values.group) &&
    (!requested || requested.includes(c.name)),
);
if (!selected.length) throw new Error("No matching cases");
const rounds = Number(values.rounds);
if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error("Invalid rounds");
const summaries: Record<string, unknown>[] = [];
for (const c of selected)
  for (const target of values.tools!.split(",")) {
    const directory = join(outputRoot, c.name, target);
    mkdirSync(join(directory, "src"), { recursive: true });
    const v = variant(target);
    const ext =
      v && "language" in v && v.language ? (v.language === "flow" ? "flow.js" : "ts") : "js";
    const input = join(directory, "src", `object-stable.${ext}`);
    const { body, expected } = source(c, target);
    const inProcess = ["throughput", "shapes"].includes(c.group);
    const program =
      (ext === "flow.js" ? "// @flow\n" : "") +
      (inProcess ? timed(body, expected, ext !== "js") : body + "\nconsole.log(checksum);\n");
    const digest = createHash("sha256").update(program).digest("hex");
    const manifest = {
      case: c,
      target,
      expected,
      sourceSha256: digest,
      rounds,
      mode: inProcess ? "in-process" : "process",
      timestamp: new Date().toISOString(),
    };
    writeFileSync(input, program);
    writeFileSync(join(directory, "experiment.json"), JSON.stringify(manifest, null, 2) + "\n");
    let result: Record<string, unknown> = { ...manifest };
    try {
      const builtDigest = join(directory, "source.sha256");
      if (
        v &&
        (!existsSync(join(directory, "out")) ||
          !existsSync(builtDigest) ||
          readFileSync(builtDigest, "utf8") !== digest)
      ) {
        try {
          const stdout = execFileSync(
            process.execPath,
            [
              import.meta.filename,
              "--compile",
              target,
              "--input",
              join(directory, "src"),
              "--destination",
              directory,
            ],
            {
              encoding: "utf8",
              stdio: ["ignore", "pipe", "pipe"],
              timeout: 120000,
              maxBuffer: 16 * 1024 * 1024,
            },
          );
          writeFileSync(join(directory, "compile.log"), stdout);
        } catch (e: any) {
          writeFileSync(
            join(directory, "compile.log"),
            String(e.stdout ?? "") + String(e.stderr ?? ""),
          );
          throw new Error(`compile failed: ${e.message}`);
        }
        writeFileSync(builtDigest, digest);
      }
      const command = v
        ? [join(directory, "out")]
        : target === "node-jitless"
          ? [process.execPath, "--jitless", input]
          : target === "node"
            ? [process.execPath, input]
            : target === "deno"
              ? ["deno", "run", "--no-config", input]
              : [target, input];
      const version = v
        ? JSON.parse(readFileSync(join(directory, "build.json"), "utf8"))
        : { runtimeVersion: execFileSync(command[0], ["--version"], { encoding: "utf8" }).trim() };
      result = { ...result, ...version, command };
      // Fresh native binaries may incur one-time loader/security work on macOS.
      if (c.group === "scaling") {
        const warmup = execFileSync(command[0], command.slice(1), {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 90000,
        });
        if (Number(benchmarkOutput(warmup).trim()) !== expected)
          throw new Error(`Incorrect warmup output ${warmup}`);
      }
      const records = [];
      for (let round = 0; round < rounds; round++) {
        const start = process.hrtime.bigint();
        const raw = execFileSync(command[0], command.slice(1), {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 90000,
          maxBuffer: 16 * 1024 * 1024,
        });
        const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
        writeFileSync(join(directory, `round-${round}.stdout`), raw);
        if (inProcess) {
          const parsed = JSON.parse(benchmarkOutput(raw).trim());
          if (parsed.result !== expected || parsed.failures !== 0)
            throw new Error(`Incorrect output ${raw.trim()}; expected ${expected}`);
          if (parsed.durations.length !== 9 || !(parsed.calls >= 1))
            throw new Error("Invalid durations");
          const samplesMs = parsed.durations.slice(2).map((d: number) => d / parsed.calls);
          const sorted = samplesMs.slice().sort((a: number, b: number) => a - b);
          records.push({ ...parsed, samplesMs, medianMs: sorted[3], elapsedMs });
        } else {
          if (Number(benchmarkOutput(raw).trim()) !== expected)
            throw new Error(`Incorrect output ${raw.trim()}; expected ${expected}`);
          records.push({ result: expected, elapsedMs, medianMs: elapsedMs });
        }
      }
      const sorted = records.map((r) => r.medianMs).sort((a, b) => a - b);
      result = {
        ...result,
        status: "ok",
        records,
        medianMs: sorted[Math.floor(sorted.length / 2)],
        minRoundMs: sorted[0],
        maxRoundMs: sorted.at(-1),
      };
      console.log(
        `${c.name} ${target}: ${Number(result.medianMs).toFixed(3)} ms/op (${sorted.map((x) => x.toFixed(3)).join(", ")})`,
      );
    } catch (e: any) {
      result = {
        ...result,
        status: "failed",
        error: String(e.message),
        stdout: String(e.stdout ?? ""),
        stderr: String(e.stderr ?? ""),
        signal: e.signal,
        exitCode: e.status,
      };
      console.log(`${c.name} ${target}: FAILED ${String(e.message).slice(0, 180)}`);
    }
    writeFileSync(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
    summaries.push(result);
  }
writeFileSync(
  join(outputRoot, `summary-${values.group}-${Date.now()}.json`),
  JSON.stringify(summaries, null, 2) + "\n",
);
