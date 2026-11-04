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
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { compilePlan } from "./compilers/index.ts";
import { hostHermesPlan, shermesManifest, shermesPath } from "./host-hermes.ts";
import { hostPerryPlan } from "./host-perry.ts";
import { hostOseoPlan, oseoConfig, oseoDirectory, prepareOseo } from "./host-oseo.ts";
import { prepareDynamicAot, dynamicAotCommand, dynamicAotConfig } from "./host-dynamic-aot.ts";
import { prepareBunCanary, bunCanaryCommand, bunCanaryConfig } from "./host-bun-canary.ts";
import {
  sourceCommand,
  languageLoopSource,
  workloadMetadata,
  workloadClock,
} from "./language-workloads.ts";
import { execute } from "./process.ts";
import { batch } from "./workflow.ts";
import {
  sourceName,
  sourceLanguage,
  sourceTools,
  tools,
  requireWorkload,
  usesBunCanary,
  variantName,
  type Variant,
  type Workload,
} from "./variants.ts";
import { benchmarkName, isSource, type BenchmarkTarget } from "./benchmark-targets.ts";
import { asyncLoopSource, loopSource } from "./benchmark.ts";
import { benchmarkResults } from "./benchmark-results.ts";
import { formatBytes } from "./sizes.ts";
import type { parseOptions } from "./options.ts";

type Options = ReturnType<typeof parseOptions>;
export const hostBuildDirectory = (root: string) =>
  join(root, "build", `host-${process.platform}-${process.arch}`);
export function requireHostTool(tool: string): void {
  if (!tools.includes(tool as any))
    throw new Error(`${tool}: host backend is not implemented yet; use --backend docker.`);
}

// Perry/scriptc use workspace packages; Porffor uses the mise-managed release binary.
export function hostToolCommand(tool: string, root = resolve(import.meta.dirname, "..")): string[] {
  if (tool === "bun")
    return [execFileSync("mise", ["which", "bun"], { cwd: root, encoding: "utf8" }).trim()];
  if (tool === "spinel" || tool === "lython") return [dynamicAotCommand(root, tool)];
  if (tool === "cpython") return ["python3"];
  if (tool === "cruby") return ["ruby"];
  if (tool === "porffor") return ["porf"];
  if (tool === "scriptc")
    return [createRequire(import.meta.url).resolve("scriptc/bin/scriptc.exe")];
  const entry = { perry: "@perryts/perry/bin/perry.js" }[tool];
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
  requireWorkload(v.tool, workload);
  if (usesBunCanary(v)) await prepareBunCanary(root);
  if (v.tool === "spinel" || v.tool === "lython") await prepareDynamicAot(root, v.tool);
  if (v.tool === "oseo") await prepareOseo(root);
  if (v.tool === "node")
    assertSystemLibraries(
      execFileSync("/usr/bin/otool", ["-L", process.execPath], { encoding: "utf8" }),
    );
  const steps =
    v.tool === "static_hermes"
      ? hostHermesPlan(root, v, workload)
      : v.tool === "perry"
        ? hostPerryPlan(v, workload)
        : v.tool === "oseo"
          ? hostOseoPlan(root, v, workload)
          : compilePlan(v, workload);
  await mkdir(output, { recursive: true });
  await rm(join(output, "build.json"), { force: true });
  if (v.tool === "spinel" || v.tool === "lython" || usesBunCanary(v))
    await rm(join(output, "out"), { force: true });
  if (v.tool === "perry") {
    await mkdir(join(output, "intermediates", "tmp"), { recursive: true });
    await writeFile(join(output, "intermediates", "package.json"), '{"private":true}\n');
  }
  for (const step of steps) {
    const argv = step.argv.map((arg) => hostPath(arg, source, output));
    if (argv[0] === "cp" && argv[1] === "/usr/local/bin/node")
      argv[1] = await realpath(process.execPath);
    if (argv[0] === "node") argv[0] = process.execPath;
    if (argv[0] === "bun") argv[0] = hostToolCommand("bun", root)[0];
    if (argv[0] === "bun-canary") argv[0] = bunCanaryCommand(root);
    if (argv[0] === "spinel" || argv[0] === "lyc")
      argv[0] = dynamicAotCommand(root, argv[0] === "lyc" ? "lython" : "spinel");
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
  if (usesBunCanary(v) || ["static_hermes", "perry", "oseo", "spinel", "lython"].includes(v.tool))
    assertSystemLibraries(
      execFileSync("/usr/bin/otool", ["-L", join(output, "out")], { encoding: "utf8" }),
      `${v.tool} executable`,
    );
  const [runtime, ...runtimeArgs] =
    v.tool === "static_hermes"
      ? [shermesPath(root)]
      : v.tool === "oseo"
        ? [process.execPath, join(root, "scripts", "oseo-compile.mjs"), oseoDirectory(root)]
        : usesBunCanary(v)
          ? [bunCanaryCommand(root)]
          : hostToolCommand(v.tool, root);
  await writeFile(
    join(output, "build.json"),
    JSON.stringify(
      {
        runtimeVersion: execFileSync(runtime, [...runtimeArgs, "--version"], {
          encoding: "utf8",
        }).trim(),
        platform: process.platform,
        arch: process.arch,
        ...workloadMetadata(v, workload),
        ...(usesBunCanary(v)
          ? {
              bunCanaryVersion: bunCanaryConfig.version,
              bunRevision: bunCanaryConfig.revision,
              bunAot: "aot" in v,
              trim: "trim" in v && v.trim === true,
            }
          : {}),
        ...(v.tool === "spinel"
          ? {
              spinelRelease: dynamicAotConfig.spinel.version,
              sourceArchiveSha256: dynamicAotConfig.spinel.sha256,
            }
          : {}),
        ...(v.tool === "lython"
          ? {
              lythonRevision: dynamicAotConfig.lython.revision,
              sourceArchiveSha256: dynamicAotConfig.lython.sha256,
              llvmMajor: dynamicAotConfig.lython.llvmMajor,
            }
          : {}),
        ...(v.tool === "static_hermes" ? { hermesRevision: shermesManifest().hermesRevision } : {}),
        ...(v.tool === "oseo"
          ? { oseoRevision: oseoConfig.revision, sanitizers: ["address", "undefined"] }
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
  requireWorkload(target.tool, options.workload);
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
    const inputName = sourceName(target, options.workload);
    await rm(sourceDirectory, { recursive: true, force: true });
    await mkdir(sourceDirectory, { recursive: true });
    const body = await readFile(join(root, "src", inputName), "utf8");
    await writeFile(
      join(sourceDirectory, inputName),
      sourceLanguage(target.tool) !== "javascript"
        ? languageLoopSource(body, target.tool, options.benchmark, options.workload)
        : (options.workload === "fetch-json" ? asyncLoopSource : loopSource)(
            body,
            options.benchmark,
            target.tool === "oseo" ? false : undefined,
          ),
    );
    if (!isSource(target))
      await hostCompile(root, target, options.workload, output, sourceDirectory);
  }
  const entry =
    options.benchmark.mode === "in-process"
      ? `/out/src/${sourceName(target, options.workload)}`
      : `/src/${sourceName(target, options.workload)}`;
  const artifact = source ? hostPath(entry, join(root, "src"), output) : join(output, "out");
  await access(artifact);
  const sourceArgv = sourceCommand(target.tool, entry);
  if (sourceArgv[0] === "node") sourceArgv[0] = process.execPath;
  if (sourceArgv[0] === "bun") sourceArgv[0] = hostToolCommand("bun", root)[0];
  const runtime = sourceArgv[0];
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
    delete env.RUBYOPT;
    delete env.RUBYLIB;
    delete env.BUN_OPTIONS;
    delete env.BUN_BE_BUN;
    const config = {
      ...options.benchmark,
      name,
      workload: options.workload,
      backend: "host",
      execution: source ? "source" : "binary",
      runtimeVersion,
      ...(buildInfo?.bunRevision
        ? {
            bunRevision: buildInfo.bunRevision,
            bunCanaryVersion: buildInfo.bunCanaryVersion,
            bunAot: buildInfo.bunAot,
            trim: buildInfo.trim,
          }
        : {}),
      ...workloadMetadata(target, options.workload),
      inProcessClock: workloadClock(target.tool),
      ...(buildInfo?.spinelRelease
        ? {
            spinelRelease: buildInfo.spinelRelease,
            sourceArchiveSha256: buildInfo.sourceArchiveSha256,
          }
        : {}),
      ...(buildInfo?.lythonRevision
        ? {
            lythonRevision: buildInfo.lythonRevision,
            llvmMajor: buildInfo.llvmMajor,
            sourceArchiveSha256: buildInfo.sourceArchiveSha256,
          }
        : {}),
      ...(buildInfo?.oseoRevision
        ? { oseoRevision: buildInfo.oseoRevision, sanitizers: buildInfo.sanitizers }
        : {}),
      supervisor: { executable: process.execPath, version: process.version },
      command: source ? sourceArgv : ["/out/out"],
      args: options.args,
      expected: (
        {
          hello: "hello",
          primes: 9592,
          json: 1491500,
          "fetch-json": 14915,
          "object-stable": 102387360,
          "object-churn": 102387360,
        } as Partial<Record<Workload, string | number>>
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
      if (usesBunCanary(options.variant)) {
        await prepareBunCanary(root);
        return;
      }
      if (options.tool === "spinel" || options.tool === "lython") {
        await prepareDynamicAot(root, options.tool);
        return;
      }
      if (options.tool === "cpython" || options.tool === "cruby") {
        const [runtime] = hostToolCommand(options.tool, root);
        execFileSync(runtime, ["--version"], { stdio: "inherit" });
        return;
      }
      if (options.selected.every((v) => v.tool === "oseo")) {
        await prepareOseo(root);
        return;
      }
      if (options.selected.every((v) => v.tool === "static_hermes")) {
        execFileSync(shermesPath(root), ["--version"], { stdio: "inherit" });
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
      requireWorkload(options.tool, options.workload);
      const aot = !sourceTools.includes(options.tool as any);
      if (options.command === "run" && aot)
        await hostCompile(root, options.variant, options.workload, output(options.variant));
      const binary = options.command === "run-binary" || aot;
      const command = binary
        ? [join(output(options.variant), "out")]
        : sourceCommand(
            options.tool,
            join(root, "src", sourceName(options.variant, options.workload)),
          );
      if (command[0] === "node") command[0] = process.execPath;
      if (command[0] === "bun") command[0] = hostToolCommand("bun", root)[0];
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
