#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PDFIUM_DIR="${ROOT_DIR}/third_party/pdfium"
DEPOT_TOOLS_DIR="${ROOT_DIR}/third_party/depot_tools"

mkdir -p "${ROOT_DIR}/third_party"

if ! command -v gclient >/dev/null 2>&1; then
  if [[ ! -d "${DEPOT_TOOLS_DIR}" ]]; then
    git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git "${DEPOT_TOOLS_DIR}"
  fi
  export PATH="${DEPOT_TOOLS_DIR}:${PATH}"
fi

if [[ ! -d "${PDFIUM_DIR}" ]]; then
  mkdir -p "${PDFIUM_DIR}"
  pushd "${PDFIUM_DIR}" >/dev/null
  gclient config --unmanaged https://pdfium.googlesource.com/pdfium.git
  gclient sync
  popd >/dev/null
else
  pushd "${PDFIUM_DIR}" >/dev/null
  export PATH="${DEPOT_TOOLS_DIR}:${PATH}"
  gclient sync
  popd >/dev/null
fi

echo "PDFium source ready at ${PDFIUM_DIR}"
