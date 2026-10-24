#!/usr/bin/env bash
# Build a patched LanceDB Node.js native binary for Termux/Android arm64.
#
# Since Bun on Termux runs via a glibc wrapper (grun) or PRoot, we CANNOT
# use an Android NDK binary (it will fail with libdl.so errors). We must
# build a standard linux-gnu binary that has the hardlink patch applied.
#
# PREREQUISITE: This script relies on cross-compiling for aarch64-unknown-linux-gnu
# using zig cc as the linker. Ensure you have 'zig' installed (brew install zig).

set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ASSET_DIR="$ROOT_DIR/vendor/lancedb-android"
UPSTREAM_DIR="$ASSET_DIR/upstream"
BUILD_DIR="$ASSET_DIR/build"
OUT_DIR="$ASSET_DIR/out"
PATCH_DIR="$ASSET_DIR/patches"

LANCEDB_SRC="$UPSTREAM_DIR/lancedb"
LANCE_SRC="$UPSTREAM_DIR/lance"
BUILD_LANCEDB="$BUILD_DIR/lancedb"
BUILD_LANCE="$BUILD_DIR/lance"

TARGET="aarch64-unknown-linux-gnu"
OUTPUT_NAME="lancedb.termux-arm64.node"
LANCEDB_VERSION="0.37.1"
LANCE_VERSION="10.0.0"

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required tool: %s\n' "$1" >&2
    exit 1
  fi
}

for tool in bun cargo cargo-zigbuild rustup git zig; do
  require_tool "$tool"
done

if [ ! -d "$LANCEDB_SRC/.git" ] || [ ! -d "$LANCE_SRC/.git" ]; then
  printf 'Missing vendored upstream sources under %s\n' "$UPSTREAM_DIR" >&2
  exit 1
fi

verify_source_tag() {
  local repo="$1"
  local expected_tag="$2"
  local actual_tag
  actual_tag="$(git -C "$repo" describe --tags --exact-match 2>/dev/null || true)"
  if [ "$actual_tag" != "$expected_tag" ]; then
    printf 'Expected %s at tag %s, found %s\n' "$repo" "$expected_tag" "${actual_tag:-an untagged commit}" >&2
    exit 1
  fi
}

verify_source_tag "$LANCEDB_SRC" "v$LANCEDB_VERSION"
verify_source_tag "$LANCE_SRC" "v$LANCE_VERSION"

mkdir -p "$BUILD_DIR" "$OUT_DIR"
rm -rf "$BUILD_LANCEDB" "$BUILD_LANCE"
cp -R "$LANCEDB_SRC" "$BUILD_LANCEDB"
cp -R "$LANCE_SRC" "$BUILD_LANCE"

rm -f "$BUILD_LANCEDB/rust-toolchain.toml"

printf 'Applying Android commit-handler patch to vendored lance...\n'
git -C "$BUILD_LANCE" apply "$PATCH_DIR/lance-6576-android-unsafe-commit-handler.patch"

printf 'Patching lancedb workspace to use local lance crates...\n'
cat >> "$BUILD_LANCEDB/Cargo.toml" <<PATCH_EOF

[patch.crates-io]
lance = { path = "../lance/rust/lance" }
lance-arrow = { path = "../lance/rust/lance-arrow" }
lance-core = { path = "../lance/rust/lance-core" }
lance-datafusion = { path = "../lance/rust/lance-datafusion" }
lance-datagen = { path = "../lance/rust/lance-datagen" }
lance-encoding = { path = "../lance/rust/lance-encoding" }
lance-file = { path = "../lance/rust/lance-file" }
lance-index = { path = "../lance/rust/lance-index" }
lance-io = { path = "../lance/rust/lance-io" }
lance-linalg = { path = "../lance/rust/lance-linalg" }
lance-namespace = { path = "../lance/rust/lance-namespace" }
lance-namespace-impls = { path = "../lance/rust/lance-namespace-impls" }
lance-table = { path = "../lance/rust/lance-table" }
lance-testing = { path = "../lance/rust/lance-testing" }
PATCH_EOF

rustup target add "$TARGET" 2>/dev/null || true

printf 'Building lancedb-nodejs for %s (this will take a while)...\n' "$TARGET"
(
  cd "$BUILD_LANCEDB/nodejs"
  bun install
  # cargo-zigbuild automatically handles cross-compiling and setting up the C/C++ toolchains
  # for native dependencies (like aws-lc-sys and lzma-sys).
  cargo zigbuild --release --target "$TARGET.2.27"
)

shopt -s nullglob
artifacts=("$BUILD_LANCEDB/target/${TARGET}/release/"liblancedb_nodejs[.-]*)
if [ "${#artifacts[@]}" -eq 0 ]; then
  artifacts=("$BUILD_LANCEDB/nodejs/target/${TARGET}/release/"liblancedb_nodejs[.-]*)
  if [ "${#artifacts[@]}" -eq 0 ]; then
    printf 'No cdylib artifact found in target/%s/release\n' "$TARGET" >&2
    exit 1
  fi
fi

selected="${artifacts[0]}"
for candidate in "${artifacts[@]}"; do
  case "$candidate" in
    *.node|*.so|*.dylib) selected="$candidate"; break ;;
  esac
done

cp "$selected" "$OUT_DIR/$OUTPUT_NAME"
printf '%s\n' "$LANCEDB_VERSION" > "$OUT_DIR/.lancedb-native-version"

if command -v llvm-strip >/dev/null 2>&1; then
  printf 'Stripping debug symbols to save space...\n'
  llvm-strip "$OUT_DIR/$OUTPUT_NAME"
fi

printf 'Built: %s\n' "$OUT_DIR/$OUTPUT_NAME"
printf 'Source artifact: %s\n' "$selected"
