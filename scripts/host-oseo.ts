import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "./process.ts";
import { oseoPlan } from "./compilers/native.ts";
import type { Variant, Workload } from "./variants.ts";

export const oseoConfig: { revision: string; sha256: string } = JSON.parse(
  await readFile(new URL("./oseo-config.json", import.meta.url), "utf8"),
);
export const oseoDirectory = (root: string) =>
  join(root, "build", "tools", `oseo-${oseoConfig.revision}`);

const preparations = new Map<string, Promise<void>>();
export function prepareOseo(root: string): Promise<void> {
  let preparation = preparations.get(root);
  if (!preparation) {
    preparation = installOseo(root).catch((error) => {
      preparations.delete(root);
      throw error;
    });
    preparations.set(root, preparation);
  }
  return preparation;
}

async function installOseo(root: string): Promise<void> {
  const directory = oseoDirectory(root);
  try {
    await access(join(directory, ".ready"));
    await access(join(directory, "packages", "cli", "dist", "index.js"));
    return;
  } catch {
    // Only a completed installation can be reused.
  }
  const parent = join(root, "build", "tools");
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, "oseo-install-"));
  const archive = join(staging, "source.tar.gz");
  const checkout = join(staging, "checkout");
  try {
    console.log(`Preparing Oseo ${oseoConfig.revision}`);
    await execute("curl", [
      "-fsSL",
      `https://codeload.github.com/dahlia/oseo/tar.gz/${oseoConfig.revision}`,
      "-o",
      archive,
    ]);
    const digest = createHash("sha256")
      .update(await readFile(archive))
      .digest("hex");
    if (digest !== oseoConfig.sha256) throw new Error("Oseo source archive checksum mismatch.");
    await mkdir(checkout);
    await execute("tar", ["-xzf", archive, "--strip-components=1", "-C", checkout]);
    await execute("aube", ["install", "--frozen-lockfile"], { cwd: checkout });
    await execute("aube", ["exec", "--", "tsdown"], { cwd: checkout });
    await writeFile(join(checkout, ".ready"), `${oseoConfig.revision}\n`);
    await rm(directory, { recursive: true, force: true });
    await rename(checkout, directory);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export function hostOseoPlan(root: string, variant: Variant, workload: Workload) {
  return oseoPlan(
    variant,
    workload,
    oseoDirectory(root),
    join(root, "scripts", "oseo-compile.mjs"),
  );
}
