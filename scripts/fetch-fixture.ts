import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

export async function startFetchFixture() {
  const child = fork(fileURLToPath(new URL("./fetch-fixture-server.ts", import.meta.url)), [], {
    execArgv: [],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const receive = (field: string) =>
    new Promise<number | boolean>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error("Fixture server timed out")), 10_000);
      const onExit = () => finish(new Error("Fixture server exited"));
      const onError = (error: Error) => finish(error);
      const onMessage = (message: any) => {
        if (message && field in message) finish(undefined, message[field]);
      };
      const finish = (error?: Error, value?: number | boolean) => {
        clearTimeout(timeout);
        child.off("exit", onExit);
        child.off("error", onError);
        child.off("message", onMessage);
        if (error) reject(error);
        else resolve(value!);
      };
      child.on("message", onMessage);
      child.once("exit", onExit);
      child.once("error", onError);
    });
  const stop = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });
  try {
    await receive("ready");
  } catch (error) {
    await stop();
    throw error;
  }
  return {
    stop,
    async requests() {
      const response = receive("requests");
      child.send("stats");
      return (await response) as number;
    },
  };
}
