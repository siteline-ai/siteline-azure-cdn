import { run, runSilent } from './shell.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AzureAccount {
  name: string;
  id: string;
}

export interface CdnProfile {
  name: string;
  id: string;
  resourceGroup: string;
  sku: string;
  location: string;
  type: 'Front Door' | 'CDN';
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export function getAzureAccount(): AzureAccount {
  const raw = runSilent('az account show --query "{name:name, id:id}" -o json');
  return JSON.parse(raw) as AzureAccount;
}

export function isAzureCliInstalled(): boolean {
  try {
    runSilent('az --version');
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// CDN / Front Door discovery
// ---------------------------------------------------------------------------

export function discoverCdnProfiles(): CdnProfile[] {
  const profiles: CdnProfile[] = [];

  // Front Door Standard/Premium
  try {
    const raw = runSilent(
      'az afd profile list --query "[].{name:name, id:id, resourceGroup:resourceGroup, sku:sku.name, location:location}" -o json'
    );

    if (raw) {
      const parsed = JSON.parse(raw) as Array<{
        name: string;
        id: string;
        resourceGroup: string;
        sku?: string;
        location?: string;
      }>;

      for (const p of parsed) {
        profiles.push({
          name: p.name,
          id: p.id,
          resourceGroup: p.resourceGroup,
          sku: p.sku ?? 'Front Door',
          location: p.location ?? 'global',
          type: 'Front Door'
        });
      }
    }
  } catch {
    // No Front Door profiles or no access — continue.
  }

  // Classic CDN profiles
  try {
    const raw = runSilent(
      'az cdn profile list --query "[].{name:name, id:id, resourceGroup:resourceGroup, sku:sku.name, location:location}" -o json'
    );

    if (raw) {
      const parsed = JSON.parse(raw) as Array<{
        name: string;
        id: string;
        resourceGroup: string;
        sku?: string;
        location?: string;
      }>;

      for (const p of parsed) {
        if (profiles.some((existing) => existing.id.toLowerCase() === p.id.toLowerCase())) {
          continue;
        }

        profiles.push({
          name: p.name,
          id: p.id,
          resourceGroup: p.resourceGroup,
          sku: p.sku ?? 'CDN',
          location: p.location ?? 'global',
          type: 'CDN'
        });
      }
    }
  } catch {
    // No CDN profiles or no access — continue.
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// Region detection
// ---------------------------------------------------------------------------

export function detectRegionFromResourceGroup(resourceGroupName: string): string | null {
  try {
    const location = runSilent(
      `az group show --name "${resourceGroupName}" --query location -o tsv`
    );
    return location || null;
  } catch {
    return null;
  }
}

export function extractResourceGroupFromId(resourceId: string): string | null {
  const parts = resourceId.split('/');
  const rgIndex = parts.findIndex((p) => p.toLowerCase() === 'resourcegroups');

  if (rgIndex < 0 || rgIndex + 1 >= parts.length) return null;
  return parts[rgIndex + 1] ?? null;
}

export function resolveRegion(profile: {
  location?: string;
  resourceGroup?: string | null;
}): string | null {
  if (profile.location && profile.location.toLowerCase() !== 'global') {
    return profile.location;
  }

  if (profile.resourceGroup) {
    const rgLocation = detectRegionFromResourceGroup(profile.resourceGroup);
    if (rgLocation && rgLocation.toLowerCase() !== 'global') {
      return rgLocation;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

export function ensureResourceGroup(name: string, location: string): void {
  runSilent(
    `az group create --name "${name}" --location "${location}" --output none`
  );
}

export function deployBicep(resourceGroup: string, bicepFile: string, paramsFile: string): void {
  run(
    `az deployment group create --resource-group "${resourceGroup}" --template-file "${bicepFile}" --parameters "${paramsFile}" --output none`
  );
}

export function deployFunctionZip(
  resourceGroup: string,
  functionAppName: string,
  zipPath: string
): void {
  run(
    `az functionapp deployment source config-zip --resource-group "${resourceGroup}" --name "${functionAppName}" --src "${zipPath}" --output none`
  );
}
