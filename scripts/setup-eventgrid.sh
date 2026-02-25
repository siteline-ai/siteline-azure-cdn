#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_cmd az
require_azure_identity

AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-}"
STORAGE_ACCOUNT_NAME="${STORAGE_ACCOUNT_NAME:-}"
LOG_CONTAINER_NAME="${LOG_CONTAINER_NAME:-cdn-logs}"
FUNCTION_APP_NAME="${FUNCTION_APP_NAME:-siteline-azure-cdn-processor}"
FUNCTION_NAME="${FUNCTION_NAME:-blob-log-processor}"
EVENT_SUBSCRIPTION_NAME="${EVENT_SUBSCRIPTION_NAME:-siteline-blob-log-created}"

if [[ -z "${AZURE_RESOURCE_GROUP}" ]]; then
  die "AZURE_RESOURCE_GROUP is required. Set it in .env or export it before running this script."
fi

if [[ -z "${STORAGE_ACCOUNT_NAME}" ]]; then
  die "STORAGE_ACCOUNT_NAME is required. Set it in .env or export it before running this script."
fi

if ! function_id="$("${AZ_CMD[@]}" functionapp function show \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --name "${FUNCTION_APP_NAME}" \
  --function-name "${FUNCTION_NAME}" \
  --query id --output tsv 2>/dev/null)"; then
  die "Function ${FUNCTION_NAME} not found. Run scripts/setup-function.sh first."
fi

storage_id="$("${AZ_CMD[@]}" storage account show \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --name "${STORAGE_ACCOUNT_NAME}" \
  --query id --output tsv)"

subject_prefix="/blobServices/default/containers/${LOG_CONTAINER_NAME}/blobs/"

if "${AZ_CMD[@]}" eventgrid event-subscription show \
  --name "${EVENT_SUBSCRIPTION_NAME}" \
  --source-resource-id "${storage_id}" >/dev/null 2>&1; then
  log_warn "Event Grid subscription ${EVENT_SUBSCRIPTION_NAME} already exists. Updating it."
  "${AZ_CMD[@]}" eventgrid event-subscription update \
    --name "${EVENT_SUBSCRIPTION_NAME}" \
    --source-resource-id "${storage_id}" \
    --endpoint-type azurefunction \
    --endpoint "${function_id}" \
    --included-event-types Microsoft.Storage.BlobCreated \
    --subject-begins-with "${subject_prefix}" \
    --output none
else
  log_info "Creating Event Grid subscription ${EVENT_SUBSCRIPTION_NAME}..."
  "${AZ_CMD[@]}" eventgrid event-subscription create \
    --name "${EVENT_SUBSCRIPTION_NAME}" \
    --source-resource-id "${storage_id}" \
    --endpoint-type azurefunction \
    --endpoint "${function_id}" \
    --included-event-types Microsoft.Storage.BlobCreated \
    --subject-begins-with "${subject_prefix}" \
    --event-delivery-schema eventgridschema \
    --output none
fi

log_success "Event Grid setup complete."
