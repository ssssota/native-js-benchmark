import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { parseArgs } from "node:util";
import { variants, variantName, usesBunCanary, workloads } from "../variants.ts";

const root = resolve(import.meta.dirname, "../..");
const { values } = parseArgs({
  options: { backend: { type: "string", default: "host" }, tools: { type: "string" } },
});
if (!["host", "docker"].includes(values.backend!)) throw new Error("Invalid backend");
const backend = values.backend!;
const directory = join(root, "build/bun-aot-2026-11-03", `smoke-${backend}`);
await mkdir(directory, { recursive: true });
const targets = variants
  .filter(usesBunCanary)
  .map(variantName)
  .filter((name) => !values.tools || values.tools.split(",").includes(name));
const expected: Record<string, string> = {
  hello: "hello",
  primes: "9592",
  json: "1491500",
  "object-stable": "102387360",
  "object-churn": "102387360",
  "file-cli": '{"lines":2,"words":6}',
  "fetch-json": "14915",
  "node-process": "bun-aot-smoke",
  "npm-cli": "hello-native-java-script",
};
const cli = (args: string[]) => [
  join(root, "scripts/cli.ts"),
  ...args,
  "--backend",
  backend,
  ...(backend === "docker" ? ["--skip-image-build"] : []),
];
const rows: any[] = [];
const save = () =>
  writeFile(
    join(directory, "results.json"),
    JSON.stringify({ backend, recordedAt: new Date().toISOString(), rows }, null, 2) + "\n",
  );
async function serverProbe(tool: string): Promise<void> {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(
    process.execPath,
    cli(["run-binary", "--tool", tool, "--workload", "http-server", "--port", String(port)]),
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  try {
    let ready = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`);
        if (response.status !== 200 || (await response.text()) !== "hello\n")
          throw new Error("Wrong server response");
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (!ready) throw new Error(`Server readiness timeout: ${output}`);
    const missing = await fetch(`http://127.0.0.1:${port}/missing`);
    if (missing.status !== 404 || (await missing.text()) !== "not found\n")
      throw new Error("Wrong 404 response");
  } finally {
    child.kill("SIGINT");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
for (const tool of targets)
  for (const workload of workloads) {
    const row: any = { tool, workload, status: "prepared" };
    rows.push(row);
    if (backend === "host" && workload === "npm-cli") {
      row.status = "skipped";
      row.reason =
        "The host CLI does not isolate npm-cli dependencies; verified with Docker instead.";
      await save();
      continue;
    }
    try {
      const compilation = spawnSync(
        process.execPath,
        cli(["compile", "--tool", tool, "--workload", workload]),
        { cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024 },
      );
      await writeFile(
        join(directory, `${tool}-${workload}.compile.log`),
        compilation.stdout + compilation.stderr,
      );
      if (compilation.status !== 0)
        throw new Error(`Compile failed: ${compilation.error ?? compilation.stderr}`);
      if (workload === "http-server") await serverProbe(tool);
      else {
        const containerEnvProbe = backend === "docker" && workload === "node-process";
        const args = containerEnvProbe
          ? [
              "run",
              "--rm",
              "--entrypoint",
              "/out/out",
              "-e",
              "TEST=bun-aot-smoke",
              "-v",
              `${join(root, "build/docker", `${tool}-${workload}`)}:/out:ro`,
              "native-js-dream/bun:check",
            ]
          : cli(["run-binary", "--tool", tool, "--workload", workload]);
        const result = spawnSync(containerEnvProbe ? "docker" : process.execPath, args, {
          cwd: root,
          env: { ...process.env, TEST: "bun-aot-smoke" },
          encoding: "utf8",
          timeout: 120000,
          maxBuffer: 16 * 1024 * 1024,
        });
        await writeFile(
          join(directory, `${tool}-${workload}.run.log`),
          result.stdout + result.stderr,
        );
        row.output = result.stdout.trim().split("\n").at(-1);
        if (result.status !== 0 || row.output !== expected[workload])
          throw new Error(`Incorrect execution: ${result.status}, ${row.output}, ${result.stderr}`);
      }
      row.status = "passed";
    } catch (error) {
      row.status = "failed";
      row.error = String(error);
    }
    console.log(`${backend} ${tool}/${workload}: ${row.status}${row.error ? " " + row.error : ""}`);
    await save();
  }
if (rows.some((row) => row.status === "failed")) process.exitCode = 1;
