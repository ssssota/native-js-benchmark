import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseOptions } from "../options.ts";
import { compilePlan } from "../compilers/index.ts";
import { assertBunAotSupport } from "../host-bun-canary.ts";

test("Bun AOT, typed/trim modes and same-canary JIT controls stay distinct", () => {
  for (const name of ["bun-aot", "bun-aot-typescript", "bun-aot-trim", "bun-aot-typescript-trim"]) {
    const options = parseOptions(["compile", "--tool", name]);
    const steps = compilePlan(options.variant, "primes");
    const args = steps[0].argv;
    assert.equal(args[0], "bun-canary");
    assert.ok(args.includes("--aot"));
    assert.equal(args.includes("--trim"), name.endsWith("-trim"));
    assert.ok(args.includes(`/src/primes.${name.includes("typescript") ? "ts" : "js"}`));
    assert.ok(!args.includes("--bytecode"));
    assert.equal(steps[0].stdout, "/out/out.aot-explain.log");
    assert.ok(steps[1].argv.includes("/out/out.aot-explain.json"));
  }
  for (const name of ["bun-canary-cache-off", "bun-canary-cache-on"]) {
    const args = compilePlan(parseOptions(["compile", "--tool", name]).variant, "primes")[0].argv;
    assert.equal(args[0], "bun-canary");
    assert.ok(!args.includes("--aot"));
    assert.equal(args.includes("--bytecode"), name.endsWith("-on"));
  }
  assert.equal(parseOptions(["compile", "--variants", "--tool", "bun"]).selected.length, 8);
  assert.throws(() => parseOptions(["bench", "--tool", "bun-aot", "--execution", "source"]));
});

const miseBun = spawnSync("mise", ["which", "bun"], { encoding: "utf8" });
const stableCommand = miseBun.status === 0 ? miseBun.stdout.trim() : "bun";
const stable = spawnSync(stableCommand, ["--version"], { encoding: "utf8" });
test(
  "stable Bun 1.4.4 is rejected even though it accepts an unknown --aot flag",
  {
    skip: stable.status !== 0 || stable.stdout.trim() !== "1.4.4",
  },
  () => assert.throws(() => assertBunAotSupport(stableCommand), /no AOT support/),
);

test("explain extraction rejects ordinary compile output and saves valid JSON", () => {
  const args = compilePlan({ tool: "bun", aot: true }, "hello")[1].argv;
  const code = args[2];
  const directory = mkdtempSync(join(tmpdir(), "bun-explain-"));
  const input = join(directory, "input");
  const output = join(directory, "output");
  try {
    writeFileSync(input, '[100ms] compile out\n{"accesses":{},"calls":{}}\n');
    execFileSync(process.execPath, ["-e", code, input, output]);
    assert.equal(JSON.parse(readFileSync(output, "utf8")).length, 1);
    writeFileSync(input, "[100ms] compile out\n");
    assert.throws(
      () => execFileSync(process.execPath, ["-e", code, input, output], { stdio: "pipe" }),
      /Command failed/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
