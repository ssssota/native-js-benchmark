import { mkdir, access, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Docker, renderSteps, dockerBuildDirectory } from "./docker.ts";
import { compilePlan } from "./compilers/index.ts";
import {
  variantName,
  sourceTools,
  sourceName,
  requireWorkload,
  usesBunCanary,
} from "./variants.ts";
import { sourceCommand } from "./language-workloads.ts";
import type { Variant, Workload } from "./variants.ts";
import { execute, Interrupted } from "./process.ts";

export async function batch<T>(
  items: T[],
  label: (item: T) => string,
  action: (item: T) => Promise<void>,
): Promise<boolean> {
  const passed: string[] = [],
    failed: string[] = [];
  for (const item of items) {
    console.log(`\n${label(item)}`);
    try {
      await action(item);
      passed.push(label(item));
    } catch (error) {
      if (error instanceof Interrupted) throw error;
      console.error(error instanceof Error ? error.message : error);
      failed.push(label(item));
    }
  }
  console.log(`\nPassed: ${passed.join(", ") || "none"}\nFailed: ${failed.join(", ") || "none"}`);
  return failed.length === 0;
}

export class Workflow {
  readonly docker: Docker;
  private dependencies?: Promise<string>;
  constructor(docker: Docker) {
    this.docker = docker;
  }
  output(v: Variant, workload: Workload): string {
    return join(dockerBuildDirectory(this.docker.root), `${variantName(v)}-${workload}`);
  }
  deps(): Promise<string> {
    return (this.dependencies ??= (async () => {
      await mkdir(dockerBuildDirectory(this.docker.root), { recursive: true });
      const directory = await mkdtemp(
        join(dockerBuildDirectory(this.docker.root), "workload-deps-"),
      );
      // Deploy resolves catalog entries and keeps every dependency inside /src.
      // The current workload dependency (lodash-es) is platform-independent JS.
      await execute(
        "pnpm",
        [
          "--filter",
          "native-js-dream-workloads",
          "deploy",
          "--prod",
          "--frozen-lockfile",
          "--ignore-scripts",
          directory,
        ],
        { cwd: this.docker.root },
      );
      console.log(`Workload dependencies: ${directory}`);
      return directory;
    })());
  }
  async compile(v: Variant, workload: Workload): Promise<void> {
    const plan = compilePlan(v, workload);
    await this.docker.build(v.tool);
    const sourceDirectory = workload === "npm-cli" ? await this.deps() : undefined;
    const output = this.output(v, workload);
    await mkdir(output, { recursive: true });
    if (usesBunCanary(v)) await rm(join(output, "out"), { force: true });
    await this.docker.run(v.tool, ["sh", "-ec", renderSteps(plan)], {
      sourceDirectory,
      mounts: [`${output}:/out`],
    });
  }
  async runBinary(v: Variant, workload: Workload, args: string[], port: number): Promise<void> {
    requireWorkload(v.tool, workload);
    const output = this.output(v, workload);
    try {
      await access(join(output, "out"));
    } catch {
      throw new Error(`Missing ${join(output, "out")}; compile this configuration first.`);
    }
    const mounts = [`${output}:/out:ro`],
      env: string[] = [];
    if (v.tool === "deno" && v.engine === "v8" && v.cache === "on") {
      const cacheDir = join(output, "runtime-cache");
      await mkdir(cacheDir, { recursive: true });
      mounts.push(`${cacheDir}:/runtime-cache`);
      env.push("TMPDIR=/runtime-cache");
    }
    if (workload === "fetch-json") {
      await this.docker.build("benchmark");
      await this.docker.run(
        "benchmark",
        ["node", "/scripts/with-fetch-fixture.ts", "/out/out", ...args],
        {
          mounts: [...mounts, `${join(this.docker.root, "scripts")}:/scripts:ro`],
          env,
        },
      );
      return;
    }
    await this.docker.run(v.tool, ["/out/out", ...args], {
      sourceDirectory: workload === "npm-cli" ? await this.deps() : undefined,
      mounts,
      env,
      port: workload === "http-server" ? port : undefined,
    });
  }
  async run(v: Variant, workload: Workload, args: string[], port: number): Promise<void> {
    requireWorkload(v.tool, workload);
    if (!sourceTools.includes(v.tool as any)) {
      await this.compile(v, workload);
      return this.runBinary(v, workload, args, port);
    }
    if (workload === "fetch-json") {
      await this.docker.build("benchmark");
      await this.docker.run(
        "benchmark",
        [
          "node",
          "/scripts/with-fetch-fixture.ts",
          v.tool,
          ...(v.tool === "deno" ? ["run", "-A"] : []),
          "/src/fetch-json.js",
          ...args,
        ],
        {
          mounts: [`${join(this.docker.root, "scripts")}:/scripts:ro`],
        },
      );
      return;
    }
    await this.docker.build(v.tool);
    const sourceDirectory = workload === "npm-cli" ? await this.deps() : undefined;
    await this.docker.run(
      v.tool,
      [...sourceCommand(v.tool, `/src/${sourceName(v, workload)}`), ...args],
      { sourceDirectory, port: workload === "http-server" ? port : undefined },
    );
  }
}
