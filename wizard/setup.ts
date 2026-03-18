#!/usr/bin/env tsx

import { title, blank, color } from './cli.js';
import { authenticate } from './steps/authenticate.js';
import { collectInputs } from './steps/collect-inputs.js';
import { writeParams } from './steps/write-params.js';
import { provision } from './steps/provision.js';
import { buildAndDeploy } from './steps/build-and-deploy.js';

async function main(): Promise<void> {
  title('Siteline Azure CDN — Setup');

  // Step 1: Verify Azure CLI + auth
  authenticate();

  // Step 2: Collect configuration inputs
  const inputs = await collectInputs();

  // Step 3: Write Bicep parameters file
  writeParams(inputs);

  // Step 4: Provision infrastructure
  provision(inputs);

  // Step 5: Build, package, deploy
  const functionAppName = 'siteline-azure-cdn-processor';
  buildAndDeploy(inputs.resourceGroup, functionAppName);

  blank();
  console.log(`  ${color.green(color.bold('Done!'))} CDN logs will start flowing to Siteline within the hour.`);
  blank();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
