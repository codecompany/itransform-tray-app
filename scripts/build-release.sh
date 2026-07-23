#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: scripts/build-release.sh --platform mac|win [--arch x64|arm64] [--dir] [--skip-build] [--version x.y.z]"
}

fail() {
  echo "error: $*" >&2
  exit 1
}

PLATFORM=""
ARCH=""
VERSION=""
DIR_MODE=0
SKIP_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="${2:-}"; shift 2 ;;
    --arch) ARCH="${2:-}"; shift 2 ;;
    --version) VERSION="${2#v}"; shift 2 ;;
    --dir) DIR_MODE=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown option: $1" ;;
  esac
done

[[ "${PLATFORM}" == "mac" || "${PLATFORM}" == "win" ]] || fail "--platform must be mac or win"
[[ -z "${ARCH}" || "${ARCH}" == "x64" || "${ARCH}" == "arm64" ]] || fail "unsupported architecture"
[[ -z "${VERSION}" || "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || fail "invalid version"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
export CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}"
PULSETRAY_BUILD_CACHE="${XDG_CACHE_HOME:-${TMPDIR:-/tmp}/pulsetray-build-cache}"
export ELECTRON_BUILDER_CACHE="${ELECTRON_BUILDER_CACHE:-${PULSETRAY_BUILD_CACHE}/electron-builder}"
export ELECTRON_CACHE="${ELECTRON_CACHE:-${PULSETRAY_BUILD_CACHE}/electron}"
export npm_config_cache="${npm_config_cache:-${REPO_ROOT}/.cache/npm}"

# GitHub Actions expands missing secrets to empty strings. electron-builder
# interprets an empty CSC_LINK as the current directory instead of "unset".
for signing_variable in CSC_LINK CSC_KEY_PASSWORD CSC_NAME; do
  if [[ -z "${!signing_variable:-}" ]]; then
    unset "${signing_variable}"
  fi
done

mkdir -p "${ELECTRON_BUILDER_CACHE}" "${ELECTRON_CACHE}" "${npm_config_cache}"
cd "${REPO_ROOT}"

if [[ "${SKIP_BUILD}" -eq 0 ]]; then
  npm run build
fi

ARGS=("--${PLATFORM}" "--publish" "never")
[[ -n "${ARCH}" ]] && ARGS+=("--${ARCH}")
[[ "${DIR_MODE}" -eq 1 ]] && ARGS+=("--dir")
[[ -n "${VERSION}" ]] && ARGS+=("--config.extraMetadata.version=${VERSION}")
npx electron-builder "${ARGS[@]}"
