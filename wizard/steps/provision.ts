import { resolve } from 'node:path';

import { ok, blank } from '../cli.js';
import { ROOT } from '../shell.js';
import { ensureResourceGroup, deployBicep } from '../azure.js';
import type { SetupInputs } from './collect-inputs.js';

export function provision(inputs: SetupInputs): void {
  blank();

  ensureResourceGroup(inputs.resourceGroup, inputs.location);
  ok('Resource group ready');

  const bicepFile = resolve(ROOT, 'infra', 'main.bicep');
  const paramsFile = resolve(ROOT, 'infra', 'main.bicepparam');

  deployBicep(inputs.resourceGroup, bicepFile, paramsFile);
  ok('Infrastructure deployed');
}
