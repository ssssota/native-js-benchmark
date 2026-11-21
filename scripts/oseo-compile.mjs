import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Oseo's build command saves the executable. Capture the generated C before
// Oseo removes its temporary build directory.
export async function compileOseo({ cli, host, version, source, output }) {
  await mkdir(dirname(output), { recursive: true });
  await Promise.all(
    [output, `${output}.c`, `${output}.mir`].map((file) => rm(file, { force: true })),
  );
  const mir = await cli.runNativeCli({ args: ["build", "--dump-mir", source], version }, host);
  if (mir.exitStatus !== 0) throw new Error(mir.stderr || "Oseo did not produce MIR.");
  await writeFile(`${output}.mir`, mir.stdout);
  let generatedSource;
  const toolchain = {
    ...cli.defaultComponents.toolchain,
    createBuildPlan(input) {
      const plan = cli.defaultComponents.toolchain.createBuildPlan(input);
      generatedSource = readFileSync(input.generatedSourcePath);
      return plan;
    },
  };
  const compilerHost = {
    ...host,
    async run(request) {
      const observation = await host.run(request);
      if (observation.exitStatus !== 0 && observation.stderr)
        process.stderr.write(observation.stderr);
      return observation;
    },
  };
  try {
    const result = await cli.runNativeCli(
      // The previous Oseo run path used checked mode. Keep the same
      // optimization and sanitizer settings when producing a binary.
      { args: ["build", "--build-config", "checked", "--output", output, source], version },
      compilerHost,
      toolchain,
    );
    if (result.exitStatus !== 0 || !generatedSource)
      throw new Error(result.stderr || "Oseo did not produce an executable.");
    await writeFile(`${output}.c`, generatedSource);
  } catch (error) {
    await rm(output, { force: true });
    throw error;
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
