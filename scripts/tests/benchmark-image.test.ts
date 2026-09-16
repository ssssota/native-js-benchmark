import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Docker, type ImageTarget } from "../docker.ts";
import { Workflow } from "../workflow.ts";
import { benchmark } from "../benchmark.ts";

for (const mode of ["process", "in-process"]) {
  test(`${mode} measures in the common image, not the compiler image`, async () => {
    const root = await mkdtemp(join(tmpdir(), "native-js-benchmark-test-"));
    try {
      const builds: ImageTarget[] = [];
      const runs: { target: ImageTarget; argv: string[] }[] = [];
      class FakeDocker extends Docker {
        override async build(target: ImageTarget) {
          builds.push(target);
        }
        override async run(target: ImageTarget, argv: string[]) {
          runs.push({ target, argv });
          if (target === "porffor")
            await writeFile(
              join(root, "build", "docker", "bench-in-process-porffor-hello", "out"),
              "binary",
            );
        }
      }
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "hello.js"), 'console.log("hello");\n');
      await mkdir(join(root, "build", "docker", "porffor-hello"), { recursive: true });
      await writeFile(join(root, "build", "docker", "porffor-hello", "out"), "binary");
      await benchmark(
        new Workflow(new FakeDocker(root, "test", "check")),
        { tool: "porffor" },
        "hello",
        { mode, samples: 2, iterations: 2, warmup: 0 },
        [],
      );
      assert.deepEqual(builds, mode === "process" ? ["benchmark"] : ["porffor", "benchmark"]);
      assert.deepEqual(runs.at(-1), {
        target: "benchmark",
        argv: ["node", "/scripts/benchmark-runner.ts"],
      });
      assert.equal(runs.length, mode === "process" ? 1 : 2);
      const config = JSON.parse(
        await readFile(
          join(root, "build", "docker", `bench-${mode}-porffor-hello`, "config.json"),
          "utf8",
        ),
      );
      assert.equal(config.image, "test/benchmark:check");
      assert.equal(config.buildImage, "test/porffor:check");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
