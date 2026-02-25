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

if [[ -z "${AZURE_RESOURCE_GROUP}" ]]; then
  die "AZURE_RESOURCE_GROUP is required. Set it in .env or export it before running this script."
fi

if [[ -z "${STORAGE_ACCOUNT_NAME}" ]]; then
  die "STORAGE_ACCOUNT_NAME is required. Set it in .env or export it before running this script."
fi

log_info "Ensuring resource group ${AZURE_RESOURCE_GROUP} exists in ${AZURE_LOCATION}..."
"${AZ_CMD[@]}" group create \
  --name "${AZURE_RESOURCE_GROUP}" \
  --location "${AZURE_LOCATION}" \
  --output none

if "${AZ_CMD[@]}" storage account show --resource-group "${AZURE_RESOURCE_GROUP}" --name "${STORAGE_ACCOUNT_NAME}" >/dev/null 2>&1; then
  log_warn "Storage account ${STORAGE_ACCOUNT_NAME} already exists. Reusing it."
else
  log_info "Creating storage account ${STORAGE_ACCOUNT_NAME}..."
  "${AZ_CMD[@]}" storage account create \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --name "${STORAGE_ACCOUNT_NAME}" \
    --location "${AZURE_LOCATION}" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --allow-blob-public-access false \
    --min-tls-version TLS1_2 \
    --output none
  log_success "Created storage account ${STORAGE_ACCOUNT_NAME}."
fi

log_info "Ensuring blob container ${LOG_CONTAINER_NAME} exists..."
"${AZ_CMD[@]}" storage container create \
  --account-name "${STORAGE_ACCOUNT_NAME}" \
  --name "${LOG_CONTAINER_NAME}" \
  --auth-mode login \
  --output none

storage_id="$("${AZ_CMD[@]}" storage account show --resource-group "${AZURE_RESOURCE_GROUP}" --name "${STORAGE_ACCOUNT_NAME}" --query id --output tsv)"
log_success "Storage setup complete: ${storage_id}"
