import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Oseo's current CLI runs and then deletes its native executable. Compose its
// host and toolchain adapters to retain the artifact without executing it.
// Keep Oseo's target, optimization and sanitizer policy unchanged.
export async function compileOseo({ cli, host, version, source, output }) {
  await mkdir(dirname(output), { recursive: true });
  await Promise.all(
    [output, `${output}.c`, `${output}.mir`].map((file) => rm(file, { force: true })),
  );
  const mir = await cli.runNativeCli({ args: ["--dump-mir", source], version }, host);
  if (mir.exitStatus !== 0) throw new Error(mir.stderr || "Oseo did not produce MIR.");
  await writeFile(`${output}.mir`, mir.stdout);
  let executable;
  let generatedSource;
  let retained = false;
  const toolchain = {
    ...cli.defaultComponents.toolchain,
    createBuildPlan(input) {
      const plan = cli.defaultComponents.toolchain.createBuildPlan(input);
      executable = plan.executablePath;
      generatedSource = input.generatedSourcePath;
      return plan;
    },
  };
  const retainingHost = {
    ...host,
    async run(request) {
      if (executable && request.command === executable) {
        await copyFile(generatedSource, `${output}.c`);
        await copyFile(executable, output);
        retained = true;
        return { exitStatus: 0, stdout: "", stderr: "" };
      }
      const observation = await host.run(request);
      if (observation.exitStatus !== 0 && observation.stderr)
        process.stderr.write(observation.stderr);
      return observation;
    },
  };
  const result = await cli.runNativeCli({ args: [source], version }, retainingHost, toolchain);
  if (result.exitStatus !== 0 || !retained) {
    await rm(output, { force: true });
    throw new Error(result.stderr || "Oseo did not produce an executable.");
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  try {
    const [checkout, source, output] = process.argv.slice(2);
    if (!checkout || !source || (source !== "--version" && !output))
      throw new Error("Usage: oseo-compile.mjs CHECKOUT SOURCE OUTPUT | CHECKOUT --version");
    const manifest = JSON.parse(
      await readFile(join(checkout, "packages", "cli", "package.json"), "utf8"),
    );
    if (source === "--version") console.log(`oseo ${manifest.version}`);
    else {
      const cli = await import(
        pathToFileURL(join(checkout, "packages", "cli", "dist", "index.js")).href
      );
      await compileOseo({
        cli,
        host: cli.defaultComponents.createNodeHost(),
        version: manifest.version,
        source: resolve(source),
        output: resolve(output),
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
