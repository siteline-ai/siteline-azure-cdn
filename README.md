# Siteline Azure CDN

Track every request flowing through your Azure CDN or Front Door with [Siteline](https://siteline.ai) — zero code changes to your application.

## Quick Start

> **You need:** [Node.js 18+](https://nodejs.org), [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli), a Siteline website key, and an existing Azure CDN or Front Door profile.

```bash
az login
npm install
npm run setup
```

The setup wizard will walk you through everything. No files to edit, no env vars to export.

### Example with Azure Front Door

```
$ npm run setup

  Siteline Azure CDN — Setup

  ✓ Azure CLI installed
  ✓ Logged in to Azure (Azure subscription 1)

  ? Siteline website key: sk_live_abc123

  Scanning your Azure subscription for CDN / Front Door profiles...

  ✓ Found 1 profile

  ? Select a CDN / Front Door profile:

    1) frontdoor-demo-cdn  Standard_AzureFrontDoor · frontdoor-demo-app_group-8bd3

  ? Enter number (1-1): 1
  ✓ Selected: frontdoor-demo-cdn
  ✓ Detected region: eastus

  ? Azure resource group name [frontdoor-demo-app_group-8bd3]: ⏎

  ✓ Resource group ready
  ✓ Infrastructure deployed

  ✓ Built
  ✓ Packaged
  ✓ Deployed

  Done! CDN logs will start flowing to Siteline within the hour.
```

**One input from you** (the Siteline key), **two Enters** for auto-detected defaults. That's it.

## How It Works

```
Azure CDN / Front Door (yours, already exists)
  |
  |  Diagnostic Settings writes hourly log blobs
  v
Blob Storage (cdn-logs container)
  |
  |  BlobCreated event
  v
Event Grid ---- on failure ----> Dead-letter (dlq container)
  |
  v
Azure Function
  |  1. Downloads + decompresses the blob
  |  2. Parses each log record
  |  3. Maps to pageview (url, method, status, duration, user agent, referrer, ip)
  |  4. Sends to Siteline (10 concurrent, 3 retries with backoff)
  v
Siteline API
```

The processor handles all common log formats — JSON arrays, `{"records": [...]}` wrappers, and JSON-lines — and normalizes field names across CDN SKUs (Standard Microsoft, Standard Verizon, Premium Verizon, Front Door Standard/Premium).

## Configuration

All config is collected by the setup wizard and stored in `infra/main.bicepparam`. You can also edit it directly.

| Parameter | Required | Default | Description |
|-----------|:--------:|---------|-------------|
| `sitelineWebsiteKey` | **yes** | — | Your Siteline API key |
| `cdnProfileResourceId` | **yes** | — | Resource ID of your CDN / Front Door profile |
| `location` | | `eastus` | Azure region for all resources |
| `storageAccountName` | | `sitelineazurecdnlogs` | Storage account name (must be globally unique) |
| `functionAppName` | | `siteline-azure-cdn-processor` | Function app name |
| `logContainerName` | | `cdn-logs` | Container for CDN log blobs |
| `sitelineEndpoint` | | `https://api.siteline.ai/v1/intake/pageview` | Siteline intake URL |
| `sitelineDebug` | | `false` | Enable verbose SDK logging |

## Updating Code

After the initial setup, to redeploy just the Function code (no infra changes):

```bash
npm run deploy
```

This builds, packages, and deploys interactively — prompts for resource group and function app name with saved defaults.

## Known Limitations

| Limitation | Detail |
|---|---|
| **Not real-time** | Azure CDN diagnostic logs are delivered as hourly batches. Expect a **5-60 minute delay** between a CDN request and the pageview appearing in Siteline. This is a platform constraint — there is no edge-level request hook. |
| **CDN must already exist** | This project wires diagnostic settings to an existing profile. It does not create the CDN itself. |
| **Possible duplicates** | If the Function fails and Event Grid retries, the same blob may be reprocessed. Duplicates are rare under normal operation. |
| **Cold starts** | Consumption plan may add 5-10s latency after ~10 minutes idle. This delays processing, not tracking accuracy. |
| **Single region** | Storage uses `Standard_LRS` (no geo-replication). Acceptable for ephemeral log processing. |
| **CDN SKU variations** | The processor handles common field name variations, but exotic configurations may have unmapped fields. |
| **Shared storage** | Function runtime internals and CDN log blobs share one storage account to minimize cost. |

## Cost Estimate

| Resource | Pricing | Typical cost (1M req/day CDN) |
|---|---|---|
| Blob Storage (Standard_LRS) | ~$0.02/GB/month | < $1/month |
| Event Grid | $0.60/million events | < $1/month |
| Azure Functions (Consumption) | First 1M executions free | $0/month |
| **Total** | | **< $5/month** |

## Troubleshooting

| Problem | Fix |
|---|---|
| `az: command not found` | Install Azure CLI: https://aka.ms/install-azure-cli |
| `Not logged in to Azure` | Run `az login` and retry |
| `No CDN or Front Door profiles found` | Verify the profile exists in your subscription, or enter the resource ID manually |
| `LocationNotAvailableForResourceGroup` with `Global` | The wizard auto-resolves this. If it persists, specify a region like `eastus` when prompted |
| `Storage account name already taken` | Edit `infra/main.bicepparam` and set a unique `storageAccountName` |
| `Deployment fails with RBAC error` | Wait 1-2 minutes for identity propagation and re-run `npm run setup` (Bicep is idempotent) |
| Pageviews not appearing in Siteline | CDN logs are hourly batches — wait up to 60 minutes. Check the `dlq` container for failed events |
| Need to change configuration | Edit `infra/main.bicepparam` directly, then run `npm run setup` again |

Still stuck? Contact Siteline support at [team@siteline.ai](mailto:team@siteline.ai).

## License

MIT
