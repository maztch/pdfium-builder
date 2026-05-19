#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PDFIUM_DIR="${ROOT_DIR}/third_party/pdfium/pdfium"
DEPOT_TOOLS_DIR="${ROOT_DIR}/third_party/depot_tools"
OUT_DIR="${PDFIUM_DIR}/out/wasm"

if [[ ! -d "${PDFIUM_DIR}" ]]; then
  echo "Missing PDFium source. Run scripts/bootstrap_pdfium.sh first."
  exit 1
fi

if [[ -d "${DEPOT_TOOLS_DIR}" ]]; then
  export PATH="${DEPOT_TOOLS_DIR}:${PATH}"
fi

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc not found in PATH. Make sure Emscripten is installed and activated."
  exit 1
fi

EMCC_PATH="$(command -v emcc)"
EMCC_REALPATH="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${EMCC_PATH}")"
EMSCRIPTEN_PATH="$(cd "$(dirname "${EMCC_REALPATH}")" && pwd)"
export EM_CACHE="${ROOT_DIR}/.emcache"
mkdir -p "${EM_CACHE}"

mkdir -p "${OUT_DIR}"

cat > "${OUT_DIR}/args.gn" <<'GN'
is_component_build = false
is_debug = false
pdf_is_standalone = true
pdf_is_complete_lib = true
target_os = "emscripten"
target_cpu = "wasm"
use_sysroot = false
clang_use_chrome_plugins = false
symbol_level = 0
treat_warnings_as_errors = false
use_custom_libcxx = false
use_partition_alloc = false
pdf_use_partition_alloc = false
v8_enable_i18n_support = false
pdf_enable_v8 = false
v8_enable_sandbox = false
pdf_use_skia = false
emscripten_path = "__EMSCRIPTEN_PATH__"
GN

python3 - <<PY
from pathlib import Path

args = Path("${OUT_DIR}/args.gn")
text = args.read_text()
text = text.replace("__EMSCRIPTEN_PATH__", "${EMSCRIPTEN_PATH}")
args.write_text(text)
PY

pushd "${PDFIUM_DIR}" >/dev/null

# Upstream marks emscripten as secondary-only. This adapts default toolchain selection
# so target_os="emscripten" maps directly to the wasm toolchain.
python3 - <<'PY'
from pathlib import Path

path = Path("build/config/BUILDCONFIG.gn")
src = path.read_text()
old = '''} else if (target_os == "emscripten") {
  # Because it's too hard to remove all targets from //BUILD.gn that do not work with it.
  assert(
      false,
      "emscripten is not a supported target_os. It is available only as secondary toolchain.")
} else {'''
new = '''} else if (target_os == "emscripten") {
  _default_toolchain = "//build/toolchain/wasm:wasm"
} else {'''
if old in src:
  path.write_text(src.replace(old, new))
PY

# Avoid non-wasm POSIX-only linker assumptions and skip skia GN-check dependencies for wasm.
python3 - <<'PY'
from pathlib import Path

compiler = Path("build/config/compiler/BUILD.gn")
src = compiler.read_text()
src = src.replace(
    "if ((is_posix && !is_apple) || is_fuchsia) {",
    "if (((is_posix && !is_apple) || is_fuchsia) && !is_wasm) {",
)
compiler.write_text(src)

root = Path("BUILD.gn")
src = root.read_text()
src = src.replace(
    "if (defined(checkout_skia) && checkout_skia && !is_android) {",
    "if (defined(checkout_skia) && checkout_skia && !is_android && !is_wasm) {",
)
root.write_text(src)

openjpeg = Path("third_party/libopenjpeg/opj_includes.h")
src = openjpeg.read_text()
src = src.replace(
    "#if defined(OPJ_HAVE_FSEEKO) && !defined(fseek)",
    "#if defined(OPJ_HAVE_FSEEKO) && !defined(fseek) && !defined(__EMSCRIPTEN__)",
)
openjpeg.write_text(src)
PY

gn gen out/wasm
ninja -C out/wasm pdfium

popd >/dev/null

echo "Built PDFium static library in ${OUT_DIR}"
