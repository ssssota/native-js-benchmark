import { spawn } from "node:child_process";

export class Interrupted extends Error {
  readonly exitCode: number;
  constructor(signal: NodeJS.Signals) {
    super(`Interrupted by ${signal}`);
    this.exitCode = signal === "SIGINT" ? 130 : 143;
  }
}

// Arguments are passed directly to spawn; user input never becomes host shell code.
export async function execute(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    let interrupted: NodeJS.Signals | undefined;
    const onInt = () => {
      interrupted = "SIGINT";
      child.kill("SIGINT");
    };
    const onTerm = () => {
      interrupted = "SIGTERM";
      child.kill("SIGTERM");
    };
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    const cleanup = () => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code, signal) => {
      cleanup();
      if (interrupted) reject(new Interrupted(interrupted));
      else if (code !== 0) reject(new Error(`${command} exited with ${signal ?? code}`));
      else resolve();
    });
  });
}
