import { execFileSync } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compilePlan } from "./compilers/index.ts";
import { buildHostHermes, hostHermesPlan, shermesPath } from "./host-hermes.ts";
import { hostPerryPlan } from "./host-perry.ts";
import { execute } from "./process.ts";
import { batch } from "./workflow.ts";
import { sourceName, variantName, type Variant, type Workload } from "./variants.ts";
import { benchmarkName, isSource, type BenchmarkTarget } from "./benchmark-targets.ts";
import { asyncLoopSource, loopSource } from "./benchmark.ts";
import { benchmarkResults } from "./benchmark-results.ts";
import { formatBytes } from "./sizes.ts";
import type { parseOptions } from "./options.ts";

type Options = ReturnType<typeof parseOptions>;
export const hostBuildDirectory = (root: string) =>
  join(root, "build", `host-${process.platform}-${process.arch}`);
export function requireHostTool(tool: string): void {
  if (!["node", "deno", "bun", "porffor", "scriptc", "static_hermes", "perry"].includes(tool))
    throw new Error(`${tool}: host backend is not implemented yet; use --backend docker.`);
}

// Perry/scriptc use workspace packages; Porffor uses the mise-managed release binary.
export function hostToolCommand(tool: string): string[] {
  if (tool === "porffor") return ["porf"];
  const entry = { scriptc: "scriptc/dist/bootstrap.js", perry: "@perryts/perry/bin/perry.js" }[
    tool
  ];
  return entry
    ? [process.execPath, createRequire(import.meta.url).resolve(entry)]
    : [tool === "node" ? process.execPath : tool];
}

// Only internal compiler-plan paths are rewritten, never shell source or user arguments.
export function hostPath(value: string, source: string, output: string): string {
  return value.replace(/\/(src|out)\//g, (_, name) => `${name === "src" ? source : output}/`);
}

export function assertSystemLibraries(output: string, artifact = "Node SEA"): void {
  const libraries = output
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" (compatibility version")[0]);
  if (!libraries.length) throw new Error("Could not inspect Mach-O dependencies.");
  const external = libraries.filter(
    (path) => !path.startsWith("/usr/lib/") && !path.startsWith("/System/Library/"),
  );
  if (external.length)
    throw new Error(
      `${artifact} requires non-system libraries: ${external.join(", ")}.${artifact === "Node SEA" ? " Run the CLI with mise exec -- using the official Node binary." : ""}`,
    );
}

export async function hostCompile(
  root: string,
  v: Variant,
  workload: Workload,
  output: string,
  source = join(root, "src"),
): Promise<void> {
  requireHostTool(v.tool);
  if (v.tool === "node")
    assertSystemLibraries(
      execFileSync("/usr/bin/otool", ["-L", process.execPath], { encoding: "utf8" }),
    );
  if (v.tool === "static_hermes") await buildHostHermes(root);
  const steps =
    v.tool === "static_hermes"
      ? hostHermesPlan(root, v, workload)
      : v.tool === "perry"
        ? hostPerryPlan(v, workload)
        : compilePlan(v, workload);
  await mkdir(output, { recursive: true });
  await rm(join(output, "build.json"), { force: true });
  if (v.tool === "perry") {
    await mkdir(join(output, "intermediates", "tmp"), { recursive: true });
    await writeFile(join(output, "intermediates", "package.json"), '{"private":true}\n');
  }
  for (const step of steps) {
    const argv = step.argv.map((arg) => hostPath(arg, source, output));
    if (argv[0] === "cp" && argv[1] === "/usr/local/bin/node")
      argv[1] = await realpath(process.execPath);
    if (argv[0] === "node") argv[0] = process.execPath;
    if (["porf", "scriptc", "perry"].includes(argv[0]))
      argv.splice(0, 1, ...hostToolCommand(argv[0] === "porf" ? "porffor" : argv[0]));
    const inject = argv[0] === "postject";
    if (inject) {
      // Make the copied runtime writable before resource injection.
      await chmod(join(output, "out"), 0o755);
      await execute("/usr/bin/codesign", ["--remove-signature", join(output, "out")]);
      argv.push("--macho-segment-name", "NODE_SEA");
      argv.splice(
        0,
        1,
        process.execPath,
        createRequire(import.meta.url).resolve("postject/dist/cli.js"),
      );
    }
    if (step.stdout) {
      await writeFile(
        hostPath(step.stdout, source, output),
        execFileSync(argv[0], argv.slice(1), {
          cwd: output,
          maxBuffer: 64 * 1024 * 1024,
          stdio: ["ignore", "pipe", "inherit"],
        }),
      );
    } else
      await execute(argv[0], argv.slice(1), {
        cwd: step.cwd ? hostPath(step.cwd, source, output) : output,
        ...(v.tool === "perry"
          ? { env: { ...process.env, TMPDIR: join(output, "intermediates", "tmp") } }
          : {}),
      });
    if (inject) await execute("/usr/bin/codesign", ["--sign", "-", join(output, "out")]);
  }
  if (["static_hermes", "perry"].includes(v.tool))
    assertSystemLibraries(
      execFileSync("/usr/bin/otool", ["-L", join(output, "out")], { encoding: "utf8" }),
      `${v.tool} executable`,
    );
  const [runtime, ...runtimeArgs] =
    v.tool === "static_hermes" ? [shermesPath(root)] : hostToolCommand(v.tool);
  await writeFile(
    join(output, "build.json"),
    JSON.stringify(
      {
        runtimeVersion: execFileSync(runtime, [...runtimeArgs, "--version"], {
          encoding: "utf8",
        }).trim(),
        platform: process.platform,
        arch: process.arch,
        ...(v.tool === "static_hermes"
          ? {
              hermesCommit: execFileSync(
                "git",
                ["-C", join(root, "vendor", "hermes"), "rev-parse", "HEAD"],
                { encoding: "utf8" },
              ).trim(),
            }
          : {}),
        binarySha256: createHash("sha256")
          .update(await readFile(join(output, "out")))
          .digest("hex"),
      },
      null,
      2,
    ),
  );
}

async function hostBenchmark(
  root: string,
  options: Options,
  target: BenchmarkTarget,
): Promise<void> {
  requireHostTool(target.tool);
  const name = `${benchmarkName(target)}-${options.workload}`;
  const directory = join(hostBuildDirectory(root), `bench-${options.benchmark.mode}-${name}`);
  await mkdir(directory, { recursive: true });
  // A failed new attempt must not leave an old result looking successful.
  await rm(join(directory, "result.json"), { force: true });
  const source = isSource(target);
  let output = source
    ? directory
    : join(hostBuildDirectory(root), `${variantName(target)}-${options.workload}`);
  if (options.benchmark.mode === "in-process") {
    output = directory;
    const sourceDirectory = join(directory, "src");
    const inputName = source
      ? `${options.workload}.js`
      : sourceName(target, options.workload);
    await mkdir(sourceDirectory, { recursive: true });
    const body = await readFile(join(root, "src", inputName), "utf8");
    await writeFile(
      join(sourceDirectory, inputName),
      (options.workload === "fetch-json" ? asyncLoopSource : loopSource)(body, options.benchmark),
    );
    if (!isSource(target))
      await hostCompile(root, target, options.workload, output, sourceDirectory);
  }
  const entry =
    options.benchmark.mode === "in-process"
      ? `/out/src/${options.workload}.js`
      : `/src/${options.workload}.js`;
  const artifact = source ? hostPath(entry, join(root, "src"), output) : join(output, "out");
  await access(artifact);
  const runtime = target.tool === "node" ? process.execPath : target.tool;
  const digest = createHash("sha256")
    .update(await readFile(artifact))
    .digest("hex");
  const buildInfo = source
    ? undefined
    : JSON.parse(await readFile(join(output, "build.json"), "utf8"));
  if (buildInfo && buildInfo.binarySha256 !== digest)
    throw new Error("Binary changed since compilation; recompile before benchmarking.");
  const runtimeVersion = source
    ? execFileSync(runtime, ["--version"], { encoding: "utf8" }).trim()
    : buildInfo.runtimeVersion;
  const temporary = await mkdtemp(join(tmpdir(), "native-js-host-bench-"));
  try {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TMPDIR: temporary,
      XDG_CACHE_HOME: join(temporary, "cache"),
      DENO_DIR: join(temporary, "deno"),
      BUN_INSTALL_CACHE_DIR: join(temporary, "bun"),
    };
    // Do not inherit user-provided runtime flags or compile caches into measurements.
    delete env.NODE_OPTIONS;
    delete env.NODE_COMPILE_CACHE;
    const config = {
      ...options.benchmark,
      name,
      workload: options.workload,
      backend: "host",
      execution: source ? "source" : "binary",
      runtimeVersion,
      supervisor: { executable: process.execPath, version: process.version },
      command: source
        ? [runtime, ...(target.tool === "deno" ? ["run", "-A"] : []), entry]
        : ["/out/out"],
      args: options.args,
      expected: (
        { hello: "hello", primes: 9592, json: 1491500, "fetch-json": 14915 } as Partial<
          Record<Workload, string | number>
        >
      )[options.workload],
      inputPaths: { source: join(root, "src"), output, temporary },
      [source ? "entrySourceSha256" : "binarySha256"]: digest,
    };
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify(config, null, 2));
    await execute(process.execPath, [join(root, "scripts", "benchmark-runner.ts"), path], { env });
    console.log(`Samples: ${join(directory, "result.json")}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function host(root: string, options: Options): Promise<void> {
  if (process.platform !== "darwin")
    throw new Error("The host backend currently supports macOS only.");
  if (options.workload === "npm-cli")
    throw new Error("Host npm-cli dependencies are not isolated yet; use --backend docker.");
  const build = hostBuildDirectory(root);
  console.log(`Host: ${process.platform}-${process.arch}; output: ${build}`);
  const output = (v: Variant) => join(build, `${variantName(v)}-${options.workload}`);
  switch (options.command) {
    case "bench-results":
      if (
        !(await benchmarkResults(
          root,
          options.benchmarkSelected,
          options.workload,
          options.benchmark.mode,
          build,
        ))
      )
        process.exitCode = 1;
      return;
    case "bench":
      if (
        !(await batch(options.benchmarkSelected, benchmarkName, (v) =>
          hostBenchmark(root, options, v),
        ))
      )
        process.exitCode = 1;
      return;
    case "compile":
      if (
        !(await batch(options.selected, variantName, (v) =>
          hostCompile(root, v, options.workload, output(v)),
        ))
      )
        process.exitCode = 1;
      return;
    case "sizes": {
      const rows = [];
      for (const v of options.selected) {
        const path = join(output(v), "out");
        try {
          const bytes = (await stat(path)).size;
          const dependencies = execFileSync("/usr/bin/otool", ["-L", path], { encoding: "utf8" })
            .trim()
            .split("\n")
            .slice(1)
            .map((line) => line.trim())
            .join("; ");
          rows.push({ name: variantName(v), bytes, dependencies });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          console.log(`${variantName(v)}: not compiled`);
        }
      }
      rows.sort((a, b) => b.bytes - a.bytes);
      for (const row of rows)
        console.log(`${row.name}\t${formatBytes(row.bytes)}\t${row.dependencies}`);
      console.log("Binary bytes only; Mach-O dependency sizes are not included.");
      return;
    }
    case "build":
      if (options.selected.every((v) => v.tool === "static_hermes")) {
        await buildHostHermes(root);
        return;
      }
      throw new Error(
        "Host tools are prepared by mise install, not Docker images. Run mise install first.",
      );
    case "deps":
      throw new Error("Host npm-cli dependencies are not isolated yet; use the Docker backend.");
    case "run":
    case "run-binary": {
      requireHostTool(options.tool);
      const aot = ["porffor", "scriptc", "static_hermes", "perry"].includes(options.tool);
      if (options.command === "run" && aot)
        await hostCompile(root, options.variant, options.workload, output(options.variant));
      const binary = options.command === "run-binary" || aot;
      const runtime = options.tool === "node" ? process.execPath : options.tool;
      const command = binary
        ? [join(output(options.variant), "out")]
        : [
            runtime,
            ...(options.tool === "deno" ? ["run", "-A"] : []),
            join(root, "src", `${options.workload}.js`),
          ];
      command.push(
        ...options.args.map((arg) =>
          arg.startsWith("/src/") ? join(root, "src", arg.slice(5)) : arg,
        ),
      );
      if (options.workload === "fetch-json")
        command.unshift(process.execPath, join(root, "scripts", "with-fetch-fixture.ts"));
      await execute(command[0], command.slice(1), {
        env: { ...process.env, PORT: String(options.port), HOST: "127.0.0.1" },
      });
      return;
    }
  }
}
