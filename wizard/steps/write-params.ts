import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../shell.js';
import type { SetupInputs } from './collect-inputs.js';

export function writeParams(inputs: SetupInputs): void {
  const escape = (s: string): string => s.replace(/'/g, "''");

  const content = `using './main.bicep'

param sitelineWebsiteKey = '${escape(inputs.sitelineWebsiteKey)}'

param cdnProfileResourceId = '${escape(inputs.cdnProfileResourceId)}'

param location = '${escape(inputs.location)}'
`;

  const paramPath = resolve(ROOT, 'infra', 'main.bicepparam');
  writeFileSync(paramPath, content, 'utf8');
}
