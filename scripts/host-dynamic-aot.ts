import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execute } from "./process.ts";

export const dynamicAotConfig: {
  spinel: { version: string; url: string; sha256: string };
  lython: { revision: string; url: string; sha256: string; llvmMajor: number };
} = JSON.parse(await readFile(new URL("./dynamic-aot-config.json", import.meta.url), "utf8"));
export type DynamicAot = "spinel" | "lython";
export const dynamicAotDirectory = (root: string, tool: DynamicAot) =>
  join(
    root,
    "build",
    "tools",
    `${tool}-${tool === "spinel" ? dynamicAotConfig.spinel.version : dynamicAotConfig.lython.revision}`,
  );
export const dynamicAotCommand = (root: string, tool: DynamicAot) =>
  join(dynamicAotDirectory(root, tool), tool === "spinel" ? "bin/spinel" : "build/bin/lyc");

export function llvmPrefix(): string {
  const candidates = [
    process.env.LYTHON_LLVM_PREFIX,
    "/opt/homebrew/opt/llvm@23",
    "/opt/homebrew/opt/llvm",
    "/usr/local/opt/llvm@23",
    "/usr/local/opt/llvm",
  ].filter(Boolean) as string[];
  for (const prefix of candidates)
    try {
      const version = execFileSync(join(prefix, "bin/llvm-config"), ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (version.startsWith(`${dynamicAotConfig.lython.llvmMajor}.`)) return prefix;
    } catch {}
  throw new Error(
    "Lython requires LLVM/MLIR 23. Install Homebrew llvm, or set LYTHON_LLVM_PREFIX to an LLVM 23 installation.",
  );
}

const preparations = new Map<string, Promise<void>>();
export function prepareDynamicAot(root: string, tool: DynamicAot): Promise<void> {
  const key = `${root}/${tool}`;
  let preparation = preparations.get(key);
  if (!preparation) {
    preparation = install(root, tool).catch((error) => {
      preparations.delete(key);
      throw error;
    });
    preparations.set(key, preparation);
  }
  return preparation;
}

async function install(root: string, tool: DynamicAot): Promise<void> {
  const directory = dynamicAotDirectory(root, tool);
  const config = dynamicAotConfig[tool];
  try {
    if ((await readFile(join(directory, ".ready"), "utf8")).trim() === config.sha256) {
      await access(dynamicAotCommand(root, tool));
      return;
    }
  } catch {}
  const llvm = tool === "lython" ? llvmPrefix() : undefined;
  await mkdir(dirname(directory), { recursive: true });
  const staging = await mkdtemp(join(dirname(directory), `${tool}-install-`));
  try {
    const archive = join(staging, tool === "spinel" ? "source.tar.xz" : "source.tar.gz");
    const checkout = join(staging, "checkout");
    console.log(`Preparing ${tool}: ${config.url}`);
    await execute("curl", ["-fsSL", config.url, "-o", archive]);
    if (
      createHash("sha256")
        .update(await readFile(archive))
        .digest("hex") !== config.sha256
    )
      throw new Error(`${tool} source archive checksum mismatch.`);
    await mkdir(checkout);
    await execute("tar", ["-xf", archive, "--strip-components=1", "-C", checkout]);
    // Configure in the final path: Lython embeds build-time runtime/tool paths.
    await rm(directory, { recursive: true, force: true });
    await rename(checkout, directory);
    if (tool === "spinel") await execute("make", ["-j2"], { cwd: directory });
    else {
      await execute("cmake", [
        "-S",
        directory,
        "-B",
        join(directory, "build"),
        "-G",
        "Ninja",
        "-DCMAKE_BUILD_TYPE=Release",
        "-DLYTHON_BUILD_TESTS=OFF",
        `-DLLVM_DIR=${llvm}/lib/cmake/llvm`,
        `-DMLIR_DIR=${llvm}/lib/cmake/mlir`,
        `-DCMAKE_C_COMPILER=${llvm}/bin/clang`,
        `-DCMAKE_CXX_COMPILER=${llvm}/bin/clang++`,
      ]);
      await execute("cmake", ["--build", join(directory, "build"), "--target", "lyc", "-j2"]);
    }
    await access(dynamicAotCommand(root, tool));
    await writeFile(join(directory, ".ready"), `${config.sha256}\n`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
