#!/usr/bin/env bash
set -euo pipefail

XMLTV_URL="https://xmltvfr.fr/xmltv/xmltv_tnt.zip"
XMLTV_PATH="${XMLTV_PATH:-logs}"
TMP_ZIP=$(mktemp /tmp/xmltv_tnt_XXXXXX.zip)

cleanup() {
  rm -f "${TMP_ZIP}"
}
trap cleanup EXIT

echo "Downloading XMLTV data..."
mkdir -p "${XMLTV_PATH}"
curl -fsSL "${XMLTV_URL}" -o "${TMP_ZIP}"
unzip -o "${TMP_ZIP}" -d "${XMLTV_PATH}"
echo "Done. Files extracted to ${XMLTV_PATH}"
