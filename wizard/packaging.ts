import { existsSync, cpSync, rmSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

import { ok, fail } from './cli.js';
import { run, ROOT } from './shell.js';

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function build(): void {
  run('npm run build', { silent: true });
  ok('Built');
}

// ---------------------------------------------------------------------------
// Package — creates dist/function-app.zip
// ---------------------------------------------------------------------------

export function packageFunction(): string {
  const distDir = resolve(ROOT, 'dist');
  const indexPath = resolve(distDir, 'index.js');

  if (!existsSync(indexPath)) {
    fail('Build output not found at dist/index.js. Run npm run build first.');
  }

  const stageDir = mkdtempSync(join(tmpdir(), 'siteline-pkg-'));

  try {
    // Copy required files to staging
    cpSync(resolve(ROOT, 'host.json'), join(stageDir, 'host.json'));
    cpSync(resolve(ROOT, 'package.json'), join(stageDir, 'package.json'));
    cpSync(resolve(ROOT, 'package-lock.json'), join(stageDir, 'package-lock.json'));

    mkdirSync(join(stageDir, 'dist'), { recursive: true });
    cpSync(indexPath, join(stageDir, 'dist', 'index.js'));

    const mapPath = resolve(distDir, 'index.js.map');
    if (existsSync(mapPath)) {
      cpSync(mapPath, join(stageDir, 'dist', 'index.js.map'));
    }

    // Install production dependencies only
    run('npm ci --omit=dev --ignore-scripts --silent', { cwd: stageDir, silent: true });

    // Create zip
    const zipPath = resolve(distDir, 'function-app.zip');
    run(`cd "${stageDir}" && zip -q -r "${zipPath}" .`, { silent: true });

    ok('Packaged');
    return zipPath;
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}
