import { fileURLToPath } from "node:url";
import { Docker } from "./docker.ts";
import { parseOptions } from "./options.ts";
import { batch, Workflow } from "./workflow.ts";
import { tools, variantName } from "./variants.ts";
import { Interrupted } from "./process.ts";
import { sizes } from "./sizes.ts";
import { benchmarkResults } from "./benchmark-results.ts";
import { benchmark } from "./benchmark.ts";
import { benchmarkName } from "./benchmark-targets.ts";
import { host } from "./host.ts";

const help = `Usage: node scripts/cli.ts <command> [options] [-- program arguments]

  build --all                       Build all images
  build --tool perry                 Build one image (default: node)
  deps                              Install locked workload dependencies
  sizes --workload hello             List binary sizes and ELF dependencies
  bench-results --workload hello     List saved process timings (fastest first)
  bench-results --workload primes --mode in-process
  sizes --workload hello --tool deno Filter the size report
  bench --tool bun --workload hello --mode process --samples 30
  bench --tool node --workload primes --mode in-process --iterations 100
  bench --all --workload primes --mode in-process
  bench --all --execution source --workload hello
  bench --all --execution both --workload primes
  compile --tool bun --workload hello
  compile --all --workload hello     Compile all 11 configurations
  compile --variants --tool deno     Compile Deno V8 off/on and QuickJS
  run --tool node --workload json    Run source (AOT tools compile first)
  run-binary --tool node-cache-on   Run a previously compiled binary
  compile --tool deno-quickjs        Compile Deno QuickJS
  bench --tool bun-cache-on          Benchmark a compiled configuration
  bench --tool node-source           Benchmark normal source execution
  run --workload http-server --port 3000
  run --workload npm-cli -- Hello World

Tools: node-cache-off, node-cache-on, bun-cache-off, bun-cache-on,
       deno-v8-cache-off, deno-v8-cache-on, deno-quickjs,
       perry, scriptc, porffor, static_hermes, node-source, deno-source, bun-source
Options: --tool, --workload, --execution binary|source|both,
         --backend docker|host, --port, --image-prefix, --image-tag, --help
Defaults: node (= node-cache-off for compilation/bench), hello, port 3000, native-js-dream:check
Output: build/docker/<tool>[-variant]-<workload>/out (host: build/host-<platform>-<arch>/...)
Node SEA supports hello/primes/json/fetch-json. API compatibility errors remain visible.
No timestamp-based rebuild detection; Docker still caches image layers.
`;

try {
  const options = parseOptions(process.argv.slice(2));
  if (options.command === "help") console.log(help);
  else if (options.backend === "host") {
    await host(fileURLToPath(new URL("../", import.meta.url)), options);
  } else {
    const docker = new Docker(
      fileURLToPath(new URL("../", import.meta.url)),
      options.prefix,
      options.tag,
    );
    const workflow = new Workflow(docker);
    switch (options.command) {
      case "bench-results":
        if (
          !(await benchmarkResults(
            docker.root,
            options.benchmarkSelected,
            options.workload,
            options.benchmark.mode,
          ))
        )
          process.exitCode = 1;
        break;
      case "bench":
        if (
          !(await batch(options.benchmarkSelected, benchmarkName, (v) =>
            benchmark(workflow, v, options.workload, options.benchmark, options.args),
          ))
        )
          process.exitCode = 1;
        break;
      case "sizes":
        if (!(await sizes(docker, options.selected, options.workload))) process.exitCode = 1;
        break;
      case "build":
        if (
          !(await batch(
            options.all ? [...tools] : [options.tool],
            (t) => `image:${t}`,
            (t) => docker.build(t),
          ))
        )
          process.exitCode = 1;
        break;
      case "deps":
        await workflow.deps();
        break;
      case "compile":
        if (
          !(await batch(
            options.selected,
            (v) => `${variantName(v)}-${options.workload}`,
            (v) => workflow.compile(v, options.workload),
          ))
        )
          process.exitCode = 1;
        break;
      case "run":
        await workflow.run(options.variant, options.workload, options.args, options.port);
        break;
      case "run-binary":
        await workflow.runBinary(options.variant, options.workload, options.args, options.port);
        break;
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = error instanceof Interrupted ? error.exitCode : 1;
}
