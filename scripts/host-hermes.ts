import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { availableParallelism } from "node:os";
import { execute } from "./process.ts";
import type { Step } from "./docker.ts";
import type { Workload } from "./variants.ts";

export const hermesBuildDirectory = (root: string) =>
  join(root, "build", `host-${process.platform}-${process.arch}`, "hermes");
export const shermesPath = (root: string) => join(hermesBuildDirectory(root), "bin", "shermes");

export async function buildHostHermes(root: string): Promise<void> {
  const directory = hermesBuildDirectory(root);
  const sdk = execFileSync("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"], {
    encoding: "utf8",
  }).trim();
  const xcrun = (name: string) =>
    execFileSync("/usr/bin/xcrun", ["--find", name], { encoding: "utf8" }).trim();
  await execute("cmake", [
    "-S",
    join(root, "vendor", "hermes"),
    "-B",
    directory,
    "-G",
    "Ninja",
    "-DCMAKE_BUILD_TYPE=Release",
    `-DPython_EXECUTABLE=${execFileSync("python", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim()}`,
    `-DCMAKE_C_COMPILER=${xcrun("clang")}`,
    `-DCMAKE_CXX_COMPILER=${xcrun("clang++")}`,
    `-DSHERMES_CC_SYSCFLAGS=-isysroot ${sdk}`,
    `-DSHERMES_CC_SYSLDFLAGS=-isysroot ${sdk}`,
  ]);
  await execute("cmake", [
    "--build",
    directory,
    "--target",
    "shermes-dep",
    "--parallel",
    String(Math.min(availableParallelism(), 4)),
  ]);
}

export function hostHermesPlan(root: string, workload: Workload): Step[] {
  const compiler = shermesPath(root);
  const source = `/src/${workload}.js`;
  return [
    { argv: [compiler, "-O", "-emit-c", "-o", "/out/out.c", source] },
    { argv: [compiler, "-O", "-dump-ir", source], stdout: "/out/out.ir" },
    {
      argv: [
        compiler,
        "-O",
        "-static-link",
        `-Wc,${join(hermesBuildDirectory(root), "external/boost/boost_1_86_0/libs/context/libboost_context.a")}`,
        "-o",
        "/out/out",
        source,
      ],
    },
  ];
}
