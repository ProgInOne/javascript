import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

// Codex child processes (docs/design/ai-system.md#프로세스-수명주기). packages/ai does no other
// process or file-system work.

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the Codex executable: an explicit path (config `codexPath`) or a bare name searched
 * on `PATH`. Returns null when it is not installed.
 */
export function findExecutable(command: string, envPath: string | undefined): string | null {
  if (command.includes('/') || command.includes('\\') || isAbsolute(command)) {
    const full = resolve(command);
    return isExecutable(full) ? full : null;
  }
  const exts =
    process.platform === 'win32'
      ? ['', ...(process.env['PATHEXT'] ?? '.EXE;.CMD').split(';')]
      : [''];
  for (const dir of (envPath ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, command + ext);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/** Runs a short Codex CLI command (`--version`, `features list`). */
export function execCodex(
  executable: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number },
): Promise<ExecResult> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      executable,
      args,
      {
        env: opts.env,
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 15_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(error.message, { cause: error }));
        else resolvePromise({ stdout, stderr });
      },
    );
  });
}

export interface AppServerProcess {
  readonly pid: number | undefined;
  send(line: string): void;
  /** Resolves once with the exit code/signal (also on spawn failure). */
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>;
  closeStdin(): void;
  kill(signal: NodeJS.Signals): void;
}

/** Starts `codex app-server` (stdio JSONL) and wires line callbacks. */
export function spawnAppServer(opts: {
  executable: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  onLine: (line: string) => void;
  onStderr: (line: string) => void;
}): AppServerProcess {
  const child: ChildProcessWithoutNullStreams = spawn(opts.executable, ['app-server'], {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  createInterface({ input: child.stdout }).on('line', opts.onLine);
  createInterface({ input: child.stderr }).on('line', opts.onStderr);
  child.stdin.on('error', () => {
    // EPIPE after the process died; the exit handler reports it.
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>(
    (resolveExit) => {
      let done = false;
      child.once('exit', (code, signal) => {
        if (done) return;
        done = true;
        resolveExit({ code, signal });
      });
      child.once('error', (error) => {
        if (done) return;
        done = true;
        resolveExit({ code: null, signal: null, error });
      });
    },
  );
  return {
    pid: child.pid,
    exited,
    send: (line) => {
      if (child.stdin.writable) child.stdin.write(line);
    },
    closeStdin: () => {
      child.stdin.end();
    },
    kill: (signal) => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    },
  };
}
