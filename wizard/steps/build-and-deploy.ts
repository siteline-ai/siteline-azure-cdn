import { ok, blank } from '../cli.js';
import { deployFunctionZip } from '../azure.js';
import { build, packageFunction } from '../packaging.js';

export function buildAndDeploy(resourceGroup: string, functionAppName: string): void {
  blank();

  build();
  const zipPath = packageFunction();

  deployFunctionZip(resourceGroup, functionAppName, zipPath);
  ok('Deployed');
}
