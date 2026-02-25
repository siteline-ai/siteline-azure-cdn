#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

log_info "Starting full infrastructure setup..."

bash "${SCRIPT_DIR}/setup-storage.sh"
bash "${SCRIPT_DIR}/setup-function.sh"
bash "${SCRIPT_DIR}/setup-eventgrid.sh"
bash "${SCRIPT_DIR}/setup-cdn-logging.sh"

log_success "Infrastructure setup flow completed."
