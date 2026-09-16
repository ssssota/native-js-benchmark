import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDependencies } from "../sizes.ts";
import { parseOptions } from "../options.ts";

test("sizes selects all variants by default and supports tool filters", () => {
  assert.equal(parseOptions(["sizes", "--workload", "hello"]).selected.length, 11);
  assert.equal(parseOptions(["sizes", "--tool", "deno"]).selected.length, 3);
  assert.equal(parseOptions(["sizes", "--tool", "deno-quickjs"]).selected.length, 1);
  assert.throws(() => parseOptions(["sizes", "--cache", "on"]));
});

test("dependencies deduplicate resolved files and separate OS libraries", () => {
  const result = parseDependencies(
    "libc.so => /lib/libc.so (0x01)\n---RESOLVED-LIBRARIES---\nSTATUS\t0\nLIB\t/usr/lib/aarch64-linux-gnu/libc.so.6\t100\nLIB\t/hermes/lib.so\t200\nLIB\t/hermes/lib.so\t200\n",
  );
  assert.equal(result.libraries.length, 2);
  assert.equal(
    result.libraries.filter((lib) => !lib.system).reduce((sum, lib) => sum + lib.bytes, 0),
    200,
  );
  assert.equal(result.static, false);
});

test("unknown and unresolved dependencies are never reported as zero", () => {
  assert.throws(() =>
    parseDependencies("libx => not found\n---RESOLVED-LIBRARIES---\nSTATUS\t0\n"),
  );
  assert.throws(() => parseDependencies("ldd: missing\n---RESOLVED-LIBRARIES---\nSTATUS\t127\n"));
  assert.throws(() => parseDependencies("\n---RESOLVED-LIBRARIES---\nSTATUS\t0\n"));
  assert.equal(
    parseDependencies("statically linked\n---RESOLVED-LIBRARIES---\nSTATUS\t0\n").static,
    true,
  );
});
