// Diagnostic sampling only: launch our binary, sample for 2 s, stop that child.
// node scripts/experiments/profile-object-shapes.ts <binary> <profile.txt>
import { spawn, execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { writeFileSync } from "node:fs";

let binary = resolve(process.argv[2]);
const profile = resolve(process.argv[3]);
// Optional fourth argument: rebuild this Perry input retaining symbols only.
// The timed binary is untouched; do not use the sampled run as a timing result.
if (process.argv[4]) {
  const source = resolve(process.argv[4]);
  binary += "-symbols";
  const compiler = resolve(import.meta.dirname, "../../node_modules/.bin/perry");
  const log = execFileSync(
    compiler,
    ["compile", source, "--no-cache", "--keep-intermediates", "-o", binary],
    {
      cwd: dirname(source),
      env: { ...process.env, PERRY_KEEP_SYMBOLS: "1" },
      encoding: "utf8",
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  writeFileSync(profile + ".build.log", log);
}
const child = spawn(binary, [], { stdio: "ignore" });
let finished = false;
const completion = new Promise<void>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", () => {
    finished = true;
    resolve();
  });
});
try {
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (finished || !child.pid) throw new Error("Binary finished before sampling");
  execFileSync("/usr/bin/sample", [String(child.pid), "2", "1", "-file", profile], {
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log(`Profile saved: ${profile}`);
} finally {
  if (!finished) child.kill("SIGTERM");
  await completion;
}
