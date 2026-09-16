import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageBenchmarkInputs } from "../benchmark-inputs.ts";

test("stage binary/source/fixtures before measurement without copying build caches", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-inputs-test-"));
  try {
    const paths = { source: join(root, "source"), output: join(root, "output"), temporary: root };
    for (const dir of [
      paths.source,
      paths.output,
      join(paths.source, "node_modules"),
      join(paths.output, "src"),
    ])
      mkdirSync(dir, { recursive: true });
    writeFileSync(join(paths.source, "hello.js"), 'console.log("hello")');
    writeFileSync(join(paths.source, "fixture.txt"), "input");
    writeFileSync(join(paths.source, "node_modules", "dependency.js"), "dependency");
    writeFileSync(join(paths.output, "out"), "binary", { mode: 0o755 });
    writeFileSync(join(paths.output, "out.ll"), "IR");
    writeFileSync(join(paths.output, "src", "hello.js"), "generated loop");

    const binary = stageBenchmarkInputs(
      ["/out/out"],
      ["/src/fixture.txt", "hello world", "/src-other"],
      paths,
    );
    assert.equal(readFileSync(binary.command[0], "utf8"), "binary");
    assert.ok(statSync(binary.command[0]).mode & 0o111);
    assert.equal(readFileSync(binary.args[0], "utf8"), "input");
    assert.deepEqual(binary.args.slice(1), ["hello world", "/src-other"]);
    assert.equal(existsSync(join(binary.directory, "out", "out.ll")), false);
    const source = stageBenchmarkInputs(["bun", "/src/hello.js"], [], paths);
    assert.equal(source.command[0], "bun");
    assert.equal(readFileSync(source.command[1], "utf8"), 'console.log("hello")');
    assert.ok(existsSync(join(source.directory, "src", "node_modules", "dependency.js")));
    const loop = stageBenchmarkInputs(["deno", "run", "-A", "/out/src/hello.js"], [], paths);
    assert.equal(readFileSync(loop.command[3], "utf8"), "generated loop");
    writeFileSync(join(paths.source, "hello.js"), "changed");
    assert.equal(readFileSync(source.command[1], "utf8"), 'console.log("hello")');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("self-contained workloads do not follow workspace dependency links outside the mount", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-workspace-test-"));
  try {
    const source = join(root, "src");
    mkdirSync(join(source, "node_modules"), { recursive: true });
    writeFileSync(join(source, "hello.js"), 'console.log("hello");');
    symlinkSync(
      "/missing-workspace/node_modules/lodash-es",
      join(source, "node_modules", "lodash-es"),
    );
    const staged = stageBenchmarkInputs(
      ["node", "/src/hello.js"],
      [],
      { source, output: root, temporary: root },
      false,
    );
    assert.equal(existsSync(join(staged.directory, "src", "node_modules")), false);
    assert.equal(readFileSync(staged.command[1], "utf8"), 'console.log("hello");');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
