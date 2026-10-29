# LanceDB for Termux

The Termux addon targets `aarch64-unknown-linux-gnu` with a minimum glibc of
2.27. Lumiverse runs GNU Bun through Termux's glibc runner or PRoot. The APK
has a separate Bionic addon built by `build:lancedb:android-native`.

## Build on a host

Install Bun 1.4.4, Rust 1.97.0 with LLVM tools and the `aarch64-unknown-linux-gnu` target,
Zig 0.16.0, cargo-zigbuild 0.22.3, Git, curl, and tar. Keep the backend
checkout beside this repository or set `LUMIVERSE_BACKEND_DIR` to its absolute
path. Its `@lancedb/lancedb` dependency must match the builder's version pin.

```sh
rustup toolchain install 1.97.0
rustup target add --toolchain 1.97.0 aarch64-unknown-linux-gnu
rustup component add --toolchain 1.97.0 llvm-tools-preview
cargo install cargo-zigbuild --version 0.22.3 --locked
bun run build:lancedb:termux
```

`bun run build:lancedb:android` remains an alias for this GNU build.
`scripts/build-lancedb-termux-native.ts` pins LanceDB 0.41.0 to upstream commit
`3936a8b3bcce8f8e073f3ec6a47e4ca4d3381b92`. It verifies and patches both
object_store 0.14.2 (Lance) and 0.13.2 (DataFusion), then builds with the pinned
Cargo lockfile. Source and compilation caches stay in `.tmp/termux-native`.

Outputs in `dist/native/termux-arm64` include `lancedb.termux-arm64.node`,
`manifest.json`, `Cargo.lock`, and licenses. The manifest records the source,
target, glibc floor, patch hashes, and binary checksum.

## Filesystem commits

Android can deny hard links used for local commits. Both patched object_store
versions copy into an exclusive staging file, sync it, and publish with
`renameat2(RENAME_NOREPLACE)`. Existing destinations retain their conflict
error so concurrent writers can retry. Unsupported filesystem operations fail
instead of overwriting another writer's commit. The 0.14.2 patch also retains
directory syncing when enabled. Lance's normal commit handler remains active.

The shared patch generator is `scripts/patch-android-object-store.ts`; the
Termux build applies its Linux variant. The APK build applies its Android
variant. Neither modifies the global Cargo registry.

## Install manually

Normal backend startup downloads its versioned addon and checks its SHA-256.
For a locally built addon, transfer it into the backend checkout:

```sh
mkdir -p vendor/lancedb-android/out
cp /path/to/lancedb.termux-arm64.node vendor/lancedb-android/out/
LUMIVERSE_LANCEDB_NATIVE_PATH="$PWD/vendor/lancedb-android/out/lancedb.termux-arm64.node" bun run src/index.ts
```

Run that command inside the usual GNU Bun/glibc environment. The explicit
override takes priority over automatic downloads. Rebuild this addon whenever
the backend's LanceDB JS package changes.
