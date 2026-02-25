#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
ZIP_PATH="${FUNCTION_ZIP_PATH:-${DIST_DIR}/function-app.zip}"
ZIP_DIR="$(dirname "${ZIP_PATH}")"
INCLUDE_ENV_FILE="${INCLUDE_ENV_FILE:-false}"
ENV_FILE_PATH="${ENV_FILE_PATH:-${ROOT_DIR}/.env}"

if [[ ! -f "${DIST_DIR}/index.js" ]]; then
  echo "Build output not found at ${DIST_DIR}/index.js. Run npm run build first." >&2
  exit 1
fi

mkdir -p "${ZIP_DIR}"
rm -f "${ZIP_PATH}"

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGE_DIR}"' EXIT

cp "${ROOT_DIR}/host.json" "${STAGE_DIR}/host.json"
cp "${ROOT_DIR}/package.json" "${STAGE_DIR}/package.json"
cp "${ROOT_DIR}/package-lock.json" "${STAGE_DIR}/package-lock.json"
mkdir -p "${STAGE_DIR}/dist"
cp "${DIST_DIR}/index.js" "${STAGE_DIR}/dist/index.js"

if [[ -f "${DIST_DIR}/index.js.map" ]]; then
  cp "${DIST_DIR}/index.js.map" "${STAGE_DIR}/dist/index.js.map"
fi

if [[ "${INCLUDE_ENV_FILE}" == "true" && -f "${ENV_FILE_PATH}" ]]; then
  cp "${ENV_FILE_PATH}" "${STAGE_DIR}/.env"
elif [[ "${INCLUDE_ENV_FILE}" == "true" ]]; then
  echo "No .env file found at ${ENV_FILE_PATH}; runtime will use defaults." >&2
fi

(
  cd "${STAGE_DIR}"
  npm ci --omit=dev --ignore-scripts --silent
)

(
  cd "${STAGE_DIR}"
  zip -q -r "${ZIP_PATH}" .
)

echo "Azure Function package created: ${ZIP_PATH}"
