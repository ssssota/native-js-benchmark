import type { Step } from "../docker.ts";
import type { Workload } from "../variants.ts";

export function perryPlan(workload: Workload): Step[] {
  return [
    { argv: ["mkdir", "-p", "/tmp/workload", "/out/intermediates"] },
    { argv: ["cp", "-R", "/src/.", "/tmp/workload/"] },
    {
      cwd: "/out/intermediates",
      argv: [
        "perry",
        "compile",
        `/tmp/workload/${workload}.js`,
        "--no-cache",
        "--keep-intermediates",
        "--trace",
        "llvm",
        "-o",
        "/out/out",
      ],
    },
  ];
}

export function scriptcPlan(workload: Workload): Step[] {
  const source = `/src/${workload}.js`;
  return [{ argv: ["scriptc", "build", source, "--keep-c", "--emit-ir", "-o", "/out/out"] }];
}

export function porfforPlan(workload: Workload): Step[] {
  const source = `/src/${workload}.js`;
  return [
    { argv: ["porf", "c", source, "-o", "/out/out.c"] },
    { argv: ["porf", "native", source, "-o", "/out/out"] },
  ];
}

export function staticHermesPlan(workload: Workload): Step[] {
  const source = `/src/${workload}.js`;
  return [
    { argv: ["shermes", "-O", "-emit-c", "-o", "/out/out.c", source] },
    { argv: ["shermes", "-O", "-dump-ir", source], stdout: "/out/out.ir" },
    { argv: ["shermes", "-O", "-c", "-o", "/out/out.o", source] },
    {
      argv: [
        "clang++-19",
        "/out/out.o",
        "-Wl,--start-group",
        "/hermes/build/tools/shermes/libshermes_console_a.a",
        "/hermes/build/lib/libhermesvm_a.a",
        "/hermes/build/jsi/libjsi.a",
        "/hermes/build/external/boost/boost_1_86_0/libs/context/libboost_context.a",
        "-Wl,--end-group",
        "-licui18n",
        "-licuuc",
        "-licudata",
        "-ldl",
        "-lpthread",
        "-lm",
        "-o",
        "/out/out",
      ],
    },
  ];
}
