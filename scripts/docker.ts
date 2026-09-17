import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { execute, Interrupted } from "./process.ts";
import type { Tool } from "./variants.ts";

export type ImageTarget = Tool | "benchmark";
export const dockerBuildDirectory = (root: string): string => join(root, "build", "docker");

export interface Step {
  argv: string[];
  cwd?: string;
  stdout?: string;
}
export const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
export function renderSteps(steps: Step[]): string {
  return (
    "set -eu\n" +
    steps
      .map(
        (s) =>
          `${s.cwd ? `cd ${quote(s.cwd)}\n` : ""}${s.argv.map(quote).join(" ")}${s.stdout ? ` > ${quote(s.stdout)}` : ""}`,
      )
      .join("\n")
  );
}

export class Docker {
  readonly root: string;
  readonly prefix: string;
  readonly tag: string;
  readonly buildImages: boolean;
  private builds = new Map<ImageTarget, Promise<void>>();
  constructor(root: string, prefix: string, tag: string, buildImages = true) {
    this.root = root;
    this.prefix = prefix;
    this.tag = tag;
    this.buildImages = buildImages;
  }
  image(tool: ImageTarget): string {
    return `${this.prefix}/${tool}:${this.tag}`;
  }
  build(tool: ImageTarget): Promise<void> {
    let build = this.builds.get(tool);
    if (!build) {
      build = this.buildImages
        ? execute("docker", [
            "build",
            "-f",
            join(this.root, "dockerfiles", `${tool}.dockerfile`),
            "-t",
            this.image(tool),
            this.root,
          ])
        : Promise.resolve();
      this.builds.set(tool, build);
    }
    return build;
  }
  async run(
    tool: ImageTarget,
    argv: string[],
    options: {
      mounts?: string[];
      env?: string[];
      port?: number;
      sourceWritable?: boolean;
      sourceDirectory?: string;
      cwd?: string;
    } = {},
  ): Promise<void> {
    const name = `native-js-dream-${randomUUID()}`;
    const args = [
      "run",
      "--rm",
      "--init",
      "--name",
      name,
      "--entrypoint",
      argv[0],
      "-v",
      `${options.sourceDirectory ?? join(this.root, "src")}:/src${options.sourceWritable ? "" : ":ro"}`,
      "-w",
      options.cwd ?? "/tmp",
    ];
    for (const mount of options.mounts ?? []) args.push("-v", mount);
    for (const env of options.env ?? []) args.push("-e", env);
    if (options.port !== undefined)
      args.push("-p", `127.0.0.1:${options.port}:3000`, "-e", "PORT=3000");
    try {
      await execute("docker", [...args, this.image(tool), ...argv.slice(1)]);
    } catch (error) {
      if (error instanceof Interrupted) {
        // Ensure a foreground server is not left running after Ctrl-C.
        await new Promise<void>((resolve) =>
          execFile("docker", ["rm", "-f", name], () => resolve()),
        );
      }
      throw error;
    }
  }
}
