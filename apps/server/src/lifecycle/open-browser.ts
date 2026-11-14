import { spawn } from 'node:child_process';

/** Opens a URL in the default browser. Failures are reported, never fatal. */
export function openBrowser(url: string, onError: (err: Error) => void): void {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', onError);
    child.unref();
  } catch (e) {
    onError(e as Error);
  }
}
