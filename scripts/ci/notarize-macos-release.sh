#!/usr/bin/env bash
set -euo pipefail

[[ $# -ge 1 ]] || { echo "usage: $0 <artifact>..." >&2; exit 1; }
[[ -n "${APPLE_API_KEY_BASE64:-}" ]] || { echo "APPLE_API_KEY_BASE64 is required" >&2; exit 1; }
[[ -n "${APPLE_API_KEY_ID:-}" ]] || { echo "APPLE_API_KEY_ID is required" >&2; exit 1; }
[[ -n "${APPLE_API_ISSUER:-}" ]] || { echo "APPLE_API_ISSUER is required" >&2; exit 1; }

TEMPORARY="$(mktemp -d)"
trap 'rm -rf "${TEMPORARY}"' EXIT
KEY_FILE="${TEMPORARY}/AuthKey_${APPLE_API_KEY_ID}.p8"
if base64 --help 2>&1 | grep -q -- "--decode"; then
  printf "%s" "${APPLE_API_KEY_BASE64}" | base64 --decode > "${KEY_FILE}"
else
  printf "%s" "${APPLE_API_KEY_BASE64}" | base64 -D > "${KEY_FILE}"
fi
chmod 600 "${KEY_FILE}"

for artifact in "$@"; do
  [[ -f "${artifact}" ]] || { echo "artifact not found: ${artifact}" >&2; exit 1; }
  xcrun notarytool submit "${artifact}" \
    --key "${KEY_FILE}" \
    --key-id "${APPLE_API_KEY_ID}" \
    --issuer "${APPLE_API_ISSUER}" \
    --wait
  case "${artifact}" in
    *.dmg|*.pkg) xcrun stapler staple "${artifact}" ;;
  esac
done
