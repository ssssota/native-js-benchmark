// 200,000 updates across 256 objects and 8 non-index property names.
// Keep the workload and checksum identical across language variants.
const keys = ["a", "b", "c", "d", "e", "f", "g", "h"];
const objects = [];
for (let i = 0; i < 256; i++) {
  objects.push({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0 });
}
let checksum = 0;
for (let i = 0; i < 200000; i++) {
  const object = objects[i % 256];
  const key = keys[Math.floor(i / 256) % 8];
  const value = i % 1024;
  object[key] = value;
  checksum += object[key];
  object[key] = 0;
  // Observe removal/reset, so silently ignoring it produces a wrong checksum.
  // checksum += object[key] === undefined ? 1 : object[key] === 0 ? 1 : 0;
  const objectValue = object[key];
  if (objectValue === undefined) {
    checksum += 1;
  } else if (objectValue === 0) {
    checksum += 1;
  }
}
console.log(checksum);
