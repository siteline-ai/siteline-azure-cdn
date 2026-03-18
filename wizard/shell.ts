import { execSync } from 'node:child_process';
import { fail } from './cli.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// Scripts are always invoked via `npm run` from the project root.
export const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Shell execution
// ---------------------------------------------------------------------------

export interface RunOptions {
  cwd?: string;
  silent?: boolean;
  allowFailure?: boolean;
}

export function run(cmd: string, opts: RunOptions = {}): string {
  try {
    const result = execSync(cmd, {
      stdio: opts.silent ? 'pipe' : 'inherit',
      cwd: opts.cwd ?? ROOT,
      encoding: 'utf8'
    });

    return typeof result === 'string' ? result : '';
  } catch (err: unknown) {
    if (opts.allowFailure) return '';

    const error = err as { stderr?: Buffer | string; message: string };
    const msg = error.stderr?.toString().trim() || error.message;
    return fail(`Command failed: ${cmd}\n    ${msg}`);
  }
}

export function runSilent(cmd: string): string {
  return run(cmd, { silent: true }).trim();
}
