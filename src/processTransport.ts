import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import type { LineTransport } from "./protocol";
import { JsonLineBuffer } from "./protocol";

export interface ProcessCallbacks {
  onLine(line: string): void;
  onStderr(line: string): void;
  onExit(code: number | null, signal: NodeJS.Signals | null): void;
  onError(error: Error): void;
}

export class ProcessLineTransport implements LineTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdoutBuffer = new JsonLineBuffer();
  private readonly stderrBuffer = new JsonLineBuffer();

  constructor(
    command: string,
    args: string[],
    cwd: string,
    callbacks: ProcessCallbacks,
    env: NodeJS.ProcessEnv = {},
  ) {
    this.child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
        PYTHONIOENCODING: process.env.PYTHONIOENCODING ?? "utf-8",
        PYTHONUTF8: process.env.PYTHONUTF8 ?? "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      for (const line of this.stdoutBuffer.push(chunk)) {
        callbacks.onLine(line);
      }
    });
    this.child.stderr.on("data", (chunk: string) => {
      for (const line of this.stderrBuffer.push(chunk)) {
        callbacks.onStderr(line);
      }
    });
    this.child.on("exit", (code, signal) => callbacks.onExit(code, signal));
    this.child.on("error", (error) => callbacks.onError(error));
  }

  writeLine(line: string): void {
    if (!this.child.stdin.destroyed) {
      this.child.stdin.write(`${line}\n`);
    }
  }

  dispose(): void {
    if (!this.child.killed) {
      this.child.kill();
    }
  }
}
