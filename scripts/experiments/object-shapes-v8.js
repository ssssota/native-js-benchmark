// node --allow-natives-syntax scripts/experiments/object-shapes-v8.js
// node --trace-opt --trace-deopt scripts/experiments/object-shapes-v8.js <generated-input.js>
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

if (process.argv[2]) {
  const input = readFileSync(process.argv[2], "utf8").replace(
    "var start = Date.now();",
    'if (sample === 2) console.log("MEASURED_BATCHES_BEGIN");\nvar start = Date.now();',
  );
  runInThisContext(input, { filename: process.argv[2] });
} else {
  const fast = new Function("object", "return %HasFastProperties(object);");
  const same = new Function("a", "b", "return %HaveSameMap(a, b);");
  const keys = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const observations = [];
  for (const mode of ["drain", "keep", "dictionary"]) {
    const objects = Array.from({ length: 256 }, () =>
      mode === "dictionary"
        ? { sentinel: 0, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0 }
        : { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0 },
    );
    if (mode === "dictionary") for (const object of objects) delete object.sentinel;
    const record = (steps) =>
      observations.push({
        mode,
        steps,
        ownKeysTotal: objects.reduce((s, o) => s + Object.keys(o).length, 0),
        firstObjectKeys: Object.keys(objects[0]).length,
        fastObjects: objects.filter(fast).length,
      });
    record(0);
    for (let i = 0; i < 4096; i++) {
      const object = objects[i % 256];
      const key = keys[Math.floor(i / 256) % 8];
      object[key] = i % 1024;
      if (mode === "dictionary") object[key] = 0;
      else {
        delete object[key];
        if (mode === "keep") object[key] = 0;
      }
      if ([1, 256, 2048, 2049, 4096].includes(i + 1)) record(i + 1);
    }
  }
  const shapeCounts = [];
  for (const count of [1, 4, 16]) {
    const objects = [];
    for (let n = 0; n < count; n++) {
      const order = keys.slice(n % 8).concat(keys.slice(0, n % 8));
      if (n >= 8) [order[0], order[1]] = [order[1], order[0]];
      objects.push(new Function(`return {${order.map((k) => `${k}: 0`).join(",")}}`)());
    }
    const representatives = [];
    for (const object of objects)
      if (!representatives.some((r) => same(r, object))) representatives.push(object);
    shapeCounts.push({
      requested: count,
      distinctMaps: representatives.length,
      fastObjects: objects.filter(fast).length,
    });
  }
  const cardinality = [];
  for (const count of [8, 32, 128]) {
    const propertyNames = Array.from({ length: count }, (_, n) =>
      n < 8 ? String.fromCharCode(97 + n) : `k${n}`,
    );
    const make = new Function(`return {${propertyNames.map((k) => `${k}:0`).join(",")}}`);
    const objects = Array.from({ length: 256 }, make);
    const before = objects.filter(fast).length;
    for (let i = 0; i < 200000; i++) {
      const o = objects[i % 256];
      const k = propertyNames[Math.floor(i / 256) % count];
      o[k] = i % 1024;
      o[k] = 0;
    }
    const makePreDelete = new Function(
      `return {sentinel:0,${propertyNames.map((k) => `${k}:0`).join(",")}}`,
    );
    const preDeleted = Array.from({ length: 256 }, makePreDelete);
    for (const object of preDeleted) delete object.sentinel;
    cardinality.push({
      keys: count,
      fastBefore: before,
      fastAfter: objects.filter(fast).length,
      fastAfterPreDelete: preDeleted.filter(fast).length,
    });
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        v8: process.versions.v8,
        deno: globalThis.Deno?.version,
        observations,
        shapeCounts,
        cardinality,
      },
      null,
      2,
    ),
  );
}
