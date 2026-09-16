import { startFetchFixture } from "./fetch-fixture.ts";
import { execute, Interrupted } from "./process.ts";

const fixture = await startFetchFixture();
try {
  await execute(process.argv[2], process.argv.slice(3));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = error instanceof Interrupted ? error.exitCode : 1;
} finally {
  await fixture.stop();
}
