import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import type { CliExecutionResult, CliInvocation, ICliExecutor, IExecutionContext } from "kushibot";

const BWRAP = "/usr/bin/bwrap";

/**
 * Isolated Linux execution with Bubblewrap: separate namespaces, no network, no capabilities,
 * read-only system files and only the mounts the host grants. There is no fallback to an
 * unconfined shell; if isolation cannot be established the command does not run.
 */
export class SandboxedCli implements ICliExecutor {
  private readonly defaultTimeoutMs = 45_000;
  private readonly defaultOutputBytes = 16_384;
  private readonly maxLogBytes = 1_048_576;

  async run(invocation: CliInvocation, context: IExecutionContext): Promise<CliExecutionResult> {
    if (process.platform !== "linux")
      throw new Error(
        "The coding CLI requires Linux with Bubblewrap; use the Cognition Panel backend container.",
      );
    await access(BWRAP);
    context.signal.throwIfAborted();
    const timeout = invocation.timeoutMs ?? this.defaultTimeoutMs;
    const remaining =
      context.deadlineEpochMs === null
        ? timeout
        : Math.min(timeout, context.deadlineEpochMs - Date.now());
    if (remaining <= 0) throw new Error("CLI deadline exceeded.");
    return this.execute(this.arguments(invocation), remaining, invocation, context);
  }

  private arguments(invocation: CliInvocation): string[] {
    const environment: Record<string, string> = {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: "/home/sandbox",
      TMPDIR: "/tmp",
      LANG: "C.UTF-8",
      CI: "true",
    };
    return [
      "--unshare-all",
      "--unshare-user",
      "--die-with-parent",
      "--new-session",
      "--cap-drop",
      "ALL",
      "--clearenv",
      "--ro-bind",
      "/usr",
      "/usr",
      "--symlink",
      "usr/bin",
      "/bin",
      "--symlink",
      "usr/sbin",
      "/sbin",
      "--symlink",
      "usr/lib",
      "/lib",
      "--symlink",
      "usr/lib64",
      "/lib64",
      "--dir",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--dir",
      "/home/sandbox",
      // Nothing of the project is visible unless a mount below exposes it.
      "--tmpfs",
      "/workspace",
      ...invocation.mounts.flatMap((mount) => [
        mount.writable ? "--bind" : "--ro-bind",
        mount.source,
        mount.target,
      ]),
      ...Object.entries(environment).flatMap(([name, value]) => ["--setenv", name, value]),
      "--chdir",
      invocation.workingDirectory,
      "--",
      ...invocation.command,
    ];
  }

  private execute(
    args: readonly string[],
    timeoutMs: number,
    invocation: CliInvocation,
    context: IExecutionContext,
  ): Promise<CliExecutionResult> {
    const maxOutput = invocation.maxOutputBytes ?? this.defaultOutputBytes;
    return new Promise((resolve, reject) => {
      const child = spawn(BWRAP, args, {
        env: {},
        // Its own process group, so background descendants die with it.
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let log = Buffer.alloc(0);
      let lost = false;
      let timedOut = false;
      const stop = () => {
        if (!child.pid) return;
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill("SIGKILL");
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, timeoutMs);
      context.signal.addEventListener("abort", stop, { once: true });
      if (context.signal.aborted) stop();
      const collect = (data: Buffer) => {
        const room = Math.max(0, this.maxLogBytes - log.length);
        if (data.length > room) lost = true;
        // Keep draining past the limit so a full pipe cannot block the process.
        log = Buffer.concat([log, data.subarray(0, room)]);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      const cleanup = () => {
        clearTimeout(timer);
        context.signal.removeEventListener("abort", stop);
        stop();
      };
      child.on("error", (error) => {
        cleanup();
        reject(error);
      });
      child.on("close", (code) => {
        cleanup();
        // Bubblewrap reports its own failures with exit 1, which must not read as a test result.
        const setup = code === 1 && log.toString("utf8", 0, 7) === "bwrap: ";
        if (setup && !log.includes("execvp")) {
          reject(new Error(`Isolation could not be established: ${log.toString("utf8", 0, 500)}`));
          return;
        }
        const exitCode = setup ? 127 : code;
        resolve({
          exitCode,
          output: log.subarray(0, maxOutput).toString("utf8"),
          truncated: lost || log.length > maxOutput,
          timedOut,
          log: log.toString("utf8"),
        });
      });
    });
  }
}
