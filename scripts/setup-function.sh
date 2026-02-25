#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_cmd az
require_azure_identity

AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-}"
AZURE_LOCATION="${AZURE_LOCATION:-eastus}"
STORAGE_ACCOUNT_NAME="${STORAGE_ACCOUNT_NAME:-}"
LOG_CONTAINER_NAME="${LOG_CONTAINER_NAME:-cdn-logs}"
FUNCTION_APP_NAME="${FUNCTION_APP_NAME:-siteline-azure-cdn-processor}"
FUNCTION_RUNTIME="${FUNCTION_RUNTIME:-node}"
FUNCTION_RUNTIME_VERSION="${FUNCTION_RUNTIME_VERSION:-20}"
FUNCTIONS_EXTENSION_VERSION="${FUNCTIONS_EXTENSION_VERSION:-4}"
FUNCTION_ZIP_PATH="${FUNCTION_ZIP_PATH:-${ROOT_DIR}/dist/function-app.zip}"
FUNCTION_NAME="${FUNCTION_NAME:-blob-log-processor}"
APP_NAME="${APP_NAME:-siteline-azure-cdn-processor}"
SITELINE_WEBSITE_KEY="${SITELINE_WEBSITE_KEY:-}"
SITELINE_ENDPOINT="${SITELINE_ENDPOINT:-https://api.siteline.ai/v1/intake/pageview}"
SITELINE_DEBUG="${SITELINE_DEBUG:-false}"

if [[ -z "${AZURE_RESOURCE_GROUP}" ]]; then
  die "AZURE_RESOURCE_GROUP is required. Set it in .env or export it before running this script."
fi

if [[ -z "${STORAGE_ACCOUNT_NAME}" ]]; then
  die "STORAGE_ACCOUNT_NAME is required. Set it in .env or export it before running this script."
fi

if [[ ! -f "${FUNCTION_ZIP_PATH}" ]]; then
  log_warn "Package not found at ${FUNCTION_ZIP_PATH}."
  if confirm "Run npm run package now?"; then
    (cd "${ROOT_DIR}" && npm run package)
  else
    die "Function package is required. Run npm run package and re-run this script."
  fi
fi

log_info "Ensuring resource group ${AZURE_RESOURCE_GROUP} exists..."
"${AZ_CMD[@]}" group create \
  --name "${AZURE_RESOURCE_GROUP}" \
  --location "${AZURE_LOCATION}" \
  --output none

if "${AZ_CMD[@]}" functionapp show --resource-group "${AZURE_RESOURCE_GROUP}" --name "${FUNCTION_APP_NAME}" >/dev/null 2>&1; then
  log_warn "Function app ${FUNCTION_APP_NAME} already exists. Reusing it."
else
  log_info "Creating Function app ${FUNCTION_APP_NAME}..."
  "${AZ_CMD[@]}" functionapp create \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --consumption-plan-location "${AZURE_LOCATION}" \
    --name "${FUNCTION_APP_NAME}" \
    --storage-account "${STORAGE_ACCOUNT_NAME}" \
    --runtime "${FUNCTION_RUNTIME}" \
    --runtime-version "${FUNCTION_RUNTIME_VERSION}" \
    --functions-version "${FUNCTIONS_EXTENSION_VERSION}" \
    --os-type Linux \
    --output none
  log_success "Created Function app ${FUNCTION_APP_NAME}."
fi

log_info "Assigning system managed identity to ${FUNCTION_APP_NAME}..."
principal_id="$("${AZ_CMD[@]}" functionapp identity assign \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --name "${FUNCTION_APP_NAME}" \
  --query principalId \
  --output tsv)"

storage_id="$("${AZ_CMD[@]}" storage account show --resource-group "${AZURE_RESOURCE_GROUP}" --name "${STORAGE_ACCOUNT_NAME}" --query id --output tsv)"

if [[ -z "${principal_id}" ]]; then
  die "Could not resolve function app principal ID for ${FUNCTION_APP_NAME}."
fi

role_count="$("${AZ_CMD[@]}" role assignment list \
  --assignee "${principal_id}" \
  --scope "${storage_id}" \
  --query "[?roleDefinitionName=='Storage Blob Data Reader'] | length(@)" \
  --output tsv)"

if [[ "${role_count}" == "0" ]]; then
  "${AZ_CMD[@]}" role assignment create \
    --assignee "${principal_id}" \
    --role "Storage Blob Data Reader" \
    --scope "${storage_id}" \
    --output none
  log_success "Granted Storage Blob Data Reader role to the function identity."
else
  log_warn "Storage Blob Data Reader role already assigned. Skipping."
fi

settings=(
  "APP_NAME=${APP_NAME}"
  "SITELINE_ENDPOINT=${SITELINE_ENDPOINT}"
  "SITELINE_DEBUG=${SITELINE_DEBUG}"
  "STORAGE_ACCOUNT_NAME=${STORAGE_ACCOUNT_NAME}"
  "LOG_CONTAINER_NAME=${LOG_CONTAINER_NAME}"
  "WEBSITE_RUN_FROM_PACKAGE=1"
)
if [[ -n "${SITELINE_WEBSITE_KEY}" ]]; then
  settings+=("SITELINE_WEBSITE_KEY=${SITELINE_WEBSITE_KEY}")
fi

log_info "Applying Function app settings..."
"${AZ_CMD[@]}" functionapp config appsettings set \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --name "${FUNCTION_APP_NAME}" \
  --settings "${settings[@]}" \
  --output none

log_info "Deploying Function package ${FUNCTION_ZIP_PATH}..."
"${AZ_CMD[@]}" functionapp deployment source config-zip \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --name "${FUNCTION_APP_NAME}" \
  --src "${FUNCTION_ZIP_PATH}" \
  --output none

log_info "Waiting for function indexing..."
attempt=1
max_attempts=10
sleep_seconds=6
while true; do
  if "${AZ_CMD[@]}" functionapp function show \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --name "${FUNCTION_APP_NAME}" \
    --function-name "${FUNCTION_NAME}" >/dev/null 2>&1; then
    break
  fi

  if [[ "${attempt}" -ge "${max_attempts}" ]]; then
    die "Function ${FUNCTION_NAME} was not indexed in time after deployment."
  fi

  log_warn "Function not indexed yet. Retrying in ${sleep_seconds}s (${attempt}/${max_attempts})..."
  sleep "${sleep_seconds}"
  attempt=$((attempt + 1))
done

function_id="$("${AZ_CMD[@]}" functionapp function show \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --name "${FUNCTION_APP_NAME}" \
  --function-name "${FUNCTION_NAME}" \
  --query id --output tsv)"

log_success "Function setup complete: ${function_id}"
