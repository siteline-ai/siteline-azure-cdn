#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_cmd az
require_cmd jq
require_azure_identity

AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-}"
STORAGE_ACCOUNT_NAME="${STORAGE_ACCOUNT_NAME:-}"
CDN_ENDPOINT_RESOURCE_ID="${CDN_ENDPOINT_RESOURCE_ID:-}"
CDN_RESOURCE_GROUP="${CDN_RESOURCE_GROUP:-${AZURE_RESOURCE_GROUP:-}}"
CDN_PROFILE_NAME="${CDN_PROFILE_NAME:-}"
CDN_ENDPOINT_NAME="${CDN_ENDPOINT_NAME:-}"
CDN_DIAGNOSTIC_SETTINGS_NAME="${CDN_DIAGNOSTIC_SETTINGS_NAME:-siteline-cdn-logs}"

if [[ -z "${AZURE_RESOURCE_GROUP}" ]]; then
  die "AZURE_RESOURCE_GROUP is required. Set it in .env or export it before running this script."
fi

if [[ -z "${STORAGE_ACCOUNT_NAME}" ]]; then
  die "STORAGE_ACCOUNT_NAME is required. Set it in .env or export it before running this script."
fi

if [[ -z "${CDN_ENDPOINT_RESOURCE_ID}" ]]; then
  if [[ -z "${CDN_RESOURCE_GROUP}" || -z "${CDN_PROFILE_NAME}" || -z "${CDN_ENDPOINT_NAME}" ]]; then
    die "Set CDN_ENDPOINT_RESOURCE_ID or provide CDN_RESOURCE_GROUP + CDN_PROFILE_NAME + CDN_ENDPOINT_NAME."
  fi

  CDN_ENDPOINT_RESOURCE_ID="$("${AZ_CMD[@]}" cdn endpoint show \
    --resource-group "${CDN_RESOURCE_GROUP}" \
    --profile-name "${CDN_PROFILE_NAME}" \
    --name "${CDN_ENDPOINT_NAME}" \
    --query id --output tsv)"
fi

storage_id="$("${AZ_CMD[@]}" storage account show \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --name "${STORAGE_ACCOUNT_NAME}" \
  --query id --output tsv)"

log_info "Discovering available diagnostic log categories..."
categories_json="$("${AZ_CMD[@]}" monitor diagnostic-settings categories list --resource "${CDN_ENDPOINT_RESOURCE_ID}" --output json)"
logs_payload="$(printf '%s\n' "${categories_json}" | jq -c '[.[] | select(.categoryType == "Logs") | {category: .name, enabled: true}]')"

if [[ "${logs_payload}" == "[]" ]]; then
  die "No log categories are available for CDN endpoint resource ${CDN_ENDPOINT_RESOURCE_ID}."
fi

if "${AZ_CMD[@]}" monitor diagnostic-settings show \
  --name "${CDN_DIAGNOSTIC_SETTINGS_NAME}" \
  --resource "${CDN_ENDPOINT_RESOURCE_ID}" >/dev/null 2>&1; then
  log_warn "Diagnostic setting ${CDN_DIAGNOSTIC_SETTINGS_NAME} already exists. Updating it."
  "${AZ_CMD[@]}" monitor diagnostic-settings update \
    --name "${CDN_DIAGNOSTIC_SETTINGS_NAME}" \
    --resource "${CDN_ENDPOINT_RESOURCE_ID}" \
    --storage-account "${storage_id}" \
    --logs "${logs_payload}" \
    --output none
else
  log_info "Creating diagnostic setting ${CDN_DIAGNOSTIC_SETTINGS_NAME}..."
  "${AZ_CMD[@]}" monitor diagnostic-settings create \
    --name "${CDN_DIAGNOSTIC_SETTINGS_NAME}" \
    --resource "${CDN_ENDPOINT_RESOURCE_ID}" \
    --storage-account "${storage_id}" \
    --logs "${logs_payload}" \
    --output none
fi

log_success "CDN diagnostic export to Blob storage is configured."
