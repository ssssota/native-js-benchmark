import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareBunCanary } from "./host-bun-canary.ts";
await prepareBunCanary(resolve(process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url))));
