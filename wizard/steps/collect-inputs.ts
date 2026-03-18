import { ok, fail, warn, info, blank, prompt, promptSelect } from '../cli.js';
import type { SelectChoice } from '../cli.js';
import {
  discoverCdnProfiles,
  extractResourceGroupFromId,
  resolveRegion,
  type CdnProfile
} from '../azure.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SetupInputs {
  sitelineWebsiteKey: string;
  cdnProfileResourceId: string;
  resourceGroup: string;
  location: string;
}

// ---------------------------------------------------------------------------
// Step: Collect all setup inputs interactively
// ---------------------------------------------------------------------------

export async function collectInputs(): Promise<SetupInputs> {
  blank();

  // 1. Siteline key
  const sitelineWebsiteKey = await prompt('Siteline website key');
  if (!sitelineWebsiteKey) fail('Siteline website key is required.');

  // 2. Discover and select CDN profile
  blank();
  info('Scanning your Azure subscription for CDN / Front Door profiles...');

  const profiles = discoverCdnProfiles();

  const selection = await (async (): Promise<{
    id: string;
    resourceGroup: string | null;
    location: string | null;
  }> => {
    if (profiles.length === 0) {
      blank();
      warn('No CDN or Front Door profiles found in this subscription.');
      info('You can enter the resource ID manually.');
      info('Find it in Azure Portal: CDN profile → Properties → Resource ID');
      blank();

      const manualId = await prompt('CDN / Front Door profile resource ID');
      if (!manualId) fail('CDN profile resource ID is required.');
      if (!manualId.includes('/Microsoft.Cdn/profiles/')) {
        fail('Invalid resource ID. Expected format: /subscriptions/.../Microsoft.Cdn/profiles/<name>');
      }

      const rg = extractResourceGroupFromId(manualId);
      return { id: manualId, resourceGroup: rg, location: resolveRegion({ resourceGroup: rg }) };
    }

    blank();
    ok(`Found ${String(profiles.length)} profile${profiles.length > 1 ? 's' : ''}`);

    const choices: SelectChoice<CdnProfile>[] = profiles.map((p) => ({
      label: p.name,
      detail: `${p.sku} · ${p.resourceGroup}`,
      value: p
    }));

    blank();
    const selected = await promptSelect('Select a CDN / Front Door profile:', choices);
    ok(`Selected: ${selected.name}`);

    return {
      id: selected.id,
      resourceGroup: selected.resourceGroup,
      location: resolveRegion({ location: selected.location, resourceGroup: selected.resourceGroup })
    };
  })();

  // 3. Region
  let location: string;
  if (selection.location) {
    ok(`Detected region: ${selection.location}`);
    location = selection.location;
  } else {
    blank();
    location = await prompt('Azure region', 'eastus');
  }

  // 4. Resource group
  blank();
  const defaultRg = selection.resourceGroup ?? 'siteline-azure-cdn-rg';
  const resourceGroup = await prompt('Azure resource group name', defaultRg);

  return {
    sitelineWebsiteKey,
    cdnProfileResourceId: selection.id,
    resourceGroup,
    location
  };
}
