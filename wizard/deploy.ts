#!/usr/bin/env tsx

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { title, ok, fail, blank, prompt } from './cli.js';
import { ROOT } from './shell.js';
import { buildAndDeploy } from './steps/build-and-deploy.js';

// ---------------------------------------------------------------------------
// Read saved defaults from bicepparam
// ---------------------------------------------------------------------------

interface SavedDefaults {
  resourceGroup: string;
  functionAppName: string;
}

function readSavedDefaults(): SavedDefaults {
  const defaults: SavedDefaults = {
    resourceGroup: 'siteline-azure-cdn-rg',
    functionAppName: 'siteline-azure-cdn-processor'
  };

  const paramPath = resolve(ROOT, 'infra', 'main.bicepparam');
  if (!existsSync(paramPath)) return defaults;

  try {
    const content = readFileSync(paramPath, 'utf8');

    const fnMatch = content.match(/param\s+functionAppName\s*=\s*'([^']+)'/);
    if (fnMatch?.[1]) defaults.functionAppName = fnMatch[1];
  } catch {
    // Use defaults
  }

  return defaults;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  title('Siteline Azure CDN — Deploy');

  // Verify Azure CLI auth
  try {
    const { execSync } = await import('node:child_process');
    execSync('az account show', { stdio: 'pipe' });
    ok('Azure CLI authenticated');
  } catch {
    fail('Not logged in to Azure. Run: az login');
  }

  const defaults = readSavedDefaults();

  blank();
  const resourceGroup = await prompt('Resource group', defaults.resourceGroup);
  const functionAppName = await prompt('Function app name', defaults.functionAppName);

  buildAndDeploy(resourceGroup, functionAppName);

  blank();
  ok('Done!');
  blank();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
