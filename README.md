# Siteline Azure CDN Blob Log Processor

This project tracks Azure CDN traffic with Siteline.
It processes Azure CDN diagnostic logs stored in Azure Blob Storage.
It forwards pageview events to the Siteline API.

## Architecture

```text
Existing Azure CDN endpoint
  -> Diagnostic settings export logs to Azure Blob Storage
  -> Event Grid (Blob Created)
  -> Azure Function log processor (this project)
  -> Siteline API
```

## Prerequisites

- Node.js 18+ and npm
- Azure CLI (`az`)
- `jq`
- `zip`
- Existing Azure CDN endpoint/profile
- IAM permissions for resource group, storage account, function app, event grid, and monitor diagnostic settings

## Azure CLI Login

```bash
az login
az account set --subscription <your-subscription-id>
az account show
```

You can also set `AZURE_SUBSCRIPTION_ID` in `.env`.

## Configuration

```bash
cp .env.example .env
```

Set at least:

- `SITELINE_WEBSITE_KEY`
- `AZURE_RESOURCE_GROUP`
- `AZURE_LOCATION`
- `STORAGE_ACCOUNT_NAME`
- `LOG_CONTAINER_NAME`
- `FUNCTION_APP_NAME`
- `CDN_ENDPOINT_RESOURCE_ID` (or CDN names to resolve it)

## Setup Scripts

The scripts are idempotent.
They reuse existing resources when safe.
They stop on errors.

- `scripts/setup-storage.sh`
Creates/configures Blob storage for CDN logs.

- `scripts/setup-function.sh`
Creates/updates Azure Function app and deploys the packaged handler.

- `scripts/setup-eventgrid.sh`
Creates/updates Event Grid subscription from blob-created events to the function.

- `scripts/setup-cdn-logging.sh`
Creates/updates CDN diagnostic settings to export logs to Blob storage.

- `scripts/setup-all.sh`
Runs all setup scripts in order.

Run via npm:

```bash
npm run setup:storage
npm run setup:function
npm run setup:eventgrid
npm run setup:cdn-logging
npm run setup:all
```

## Deployment Flow

1. Install dependencies.

```bash
npm install
```

2. Build and package Function app.

```bash
npm run package
```

3. Provision Azure resources and wiring.

```bash
npm run setup:all
```

For CI, disable prompts:

```bash
export AUTO_APPROVE=true
```

## Validation

Run local quality checks:

```bash
npm run ci
```

## Runtime Mapping

The processor accepts Azure CDN log payloads as JSON arrays, `{records:[...]}`, or JSON lines.
It maps:

- `url` from `requestUri`/`requestUri_s` (or host + uri)
- `method` from `httpMethod`/`requestMethod`
- `status` from `httpStatusCode`/`statusCode`
- `duration` from duration/time taken fields
- `userAgent` from user agent fields
- `ref` from referer/referrer fields
- `ip` from client IP fields

Invalid rows are skipped.
Rows with invalid status or missing URI are ignored.

## Operational Notes

- Azure CDN log delivery is asynchronous. Delays are expected.
- Costs come from Blob storage, Event Grid, and Function execution.
