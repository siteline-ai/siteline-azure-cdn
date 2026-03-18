import { ok, fail } from '../cli.js';
import { isAzureCliInstalled, getAzureAccount } from '../azure.js';

export function authenticate(): string {
  if (!isAzureCliInstalled()) {
    return fail('Azure CLI not found. Install it: https://aka.ms/install-azure-cli');
  }
  ok('Azure CLI installed');

  try {
    const account = getAzureAccount();
    ok(`Logged in to Azure (${account.name})`);
    return account.id;
  } catch {
    return fail('Not logged in to Azure. Run: az login');
  }
}
