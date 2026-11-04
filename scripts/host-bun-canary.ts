import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { execute } from "./process.ts";

export const bunCanaryConfig: {
  version: string;
  revision: string;
  artifacts: Record<string, { url: string; integrity: string }>;
} = JSON.parse(await readFile(new URL("./bun-canary-config.json", import.meta.url), "utf8"));
export const bunCanaryDirectory = (root: string) =>
  join(root, "build", "tools", `bun-canary-${bunCanaryConfig.version}`);
export const bunCanaryCommand = (root: string) => join(bunCanaryDirectory(root), "bin", "bun");

// Stable Bun accepts an unknown --aot flag without producing AOT code. Never
// use successful compilation alone as evidence that AOT is available.
export function assertBunAotSupport(command: string): void {
  const help = execFileSync(command, ["build", "--help"], { encoding: "utf8" });
  if (!/^\s+--aot\s/m.test(help))
    throw new Error(
      `${command}: no AOT support; refusing to measure a bundled JIT executable as AOT.`,
    );
  const revision = execFileSync(command, ["-e", "console.log(Bun.revision)"], {
    encoding: "utf8",
  }).trim();
  if (revision !== bunCanaryConfig.revision)
    throw new Error(`Unexpected Bun canary revision: ${revision}`);
}

const preparations = new Map<string, Promise<void>>();
export function prepareBunCanary(root: string): Promise<void> {
  let pending = preparations.get(root);
  if (!pending) {
    pending = install(root).catch((error) => {
      preparations.delete(root);
      throw error;
    });
    preparations.set(root, pending);
  }
  return pending;
}
async function install(root: string): Promise<void> {
  const platform = `${process.platform}-${process.arch === "arm64" ? "aarch64" : process.arch}`;
  const artifact = bunCanaryConfig.artifacts[platform];
  if (!artifact) throw new Error(`Bun canary: unsupported platform ${platform}`);
  const directory = bunCanaryDirectory(root);
  try {
    const ready = JSON.parse(await readFile(join(directory, "ready.json"), "utf8"));
    const executable = await readFile(bunCanaryCommand(root));
    if (
      ready.integrity === artifact.integrity &&
      ready.binarySha256 === createHash("sha256").update(executable).digest("hex")
    ) {
      assertBunAotSupport(bunCanaryCommand(root));
      return;
    }
  } catch {}
  await mkdir(dirname(directory), { recursive: true });
  const staging = await mkdtemp(join(dirname(directory), "bun-canary-install-"));
  try {
    const archive = join(staging, "source.tgz");
    if (process.env.BUN_CANARY_ARCHIVE) await copyFile(process.env.BUN_CANARY_ARCHIVE, archive);
    else await execute("curl", ["-fsSL", artifact.url, "-o", archive]);
    const integrity =
      "sha512-" +
      createHash("sha512")
        .update(await readFile(archive))
        .digest("base64");
    if (integrity !== artifact.integrity) throw new Error("Bun canary archive integrity mismatch.");
    await execute("tar", ["-xzf", archive, "--strip-components=1", "-C", staging]);
    const executable = join(staging, "bin", "bun");
    await chmod(executable, 0o755);
    assertBunAotSupport(executable);
    await writeFile(
      join(staging, "ready.json"),
      JSON.stringify(
        {
          version: bunCanaryConfig.version,
          revision: bunCanaryConfig.revision,
          integrity,
          binarySha256: createHash("sha256")
            .update(await readFile(executable))
            .digest("hex"),
        },
        null,
        2,
      ) + "\n",
    );
    await rm(directory, { recursive: true, force: true });
    await rename(staging, directory);
    await access(bunCanaryCommand(root));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
