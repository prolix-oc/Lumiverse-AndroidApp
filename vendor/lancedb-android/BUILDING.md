# LanceDB Android Patched Binary

This directory contains the build system needed to produce a patched LanceDB
Node.js native binary for Android/Termux arm64. The upstream `lance` crate uses
`hard_link()` for local filesystem commits, which Android's Bionic/SELinux
blocks with `EACCES`. The patched binary switches the commit handler to
`UnsafeCommitHandler` on Android so that LanceDB tables can be created on-device.

## Why is this needed?

See upstream issue: [lance-format/lance#6576](https://github.com/lance-format/lance/pull/6576)

On Android/Termux, LanceDB fails during table commit with a stack trace ending
in `lance-table/src/io/commit.rs` because the default commit handler relies on
`std::fs::hard_link`, which is blocked. The patch contained here applies the
same Android commit-handler fix that is being upstreamed, adapted to the exact
`lancedb v0.29.0` and `lance v6.0.0` versions pinned by Lumiverse.

## Files

```
upstream/     # Cloned lancedb and lance sources (create with git clone)
patches/      # lance patch for Android commit handler
out/          # Final .node binary (gitignored; copy here after build)
BUILDING.md   # This file
```

## Quick build (host cross-compile)

Install prerequisites on a **PC (Linux or macOS)** — not on the phone.

- [Android NDK r25+](https://developer.android.com/ndk/downloads)
- [Rust](https://rustup.rs/) with rustup
- [Bun](https://bun.sh/)

```bash
# 1. Clone upstream sources (one time)
git clone --depth 1 --branch v0.29.0 \
  https://github.com/lancedb/lancedb.git \
  vendor/lancedb-android/upstream/lancedb

git clone --depth 1 --branch v6.0.0 \
  https://github.com/lance-format/lance.git \
  vendor/lancedb-android/upstream/lance

# 2. Set NDK
export ANDROID_NDK_HOME="$HOME/android-ndk-r26c"

# 3. Build
bash scripts/build-lancedb-android.sh
```

The script will:
1. Detect the NDK and configure the cargo linker for `aarch64-linux-android`
2. Remove `rust-toolchain.toml` from the copied lancedb source (upstream pins
   `channel = "1.91.0"`, which switches rustup to a toolchain that likely
   doesn't have the Android target installed)
3. Apply the Android commit-handler patch to the `lance` source
4. Inject `[patch.crates-io]` into `lancedb` so the build uses the patched `lance`
5. Cross-compile the Rust cdylib using `cargo build` (we skip `napi build`
   because it tries to run the compiled binary on the host to extract JS/TS
   bindings, which fails when cross-compiling for Android)
6. Copy the final `.node` file into `vendor/lancedb-android/out/lancedb.android-arm64.node`

## Transfer to device

### ADB
```bash
adb push vendor/lancedb-android/out/lancedb.android-arm64.node \
  /sdcard/Download/
```

### On Termux
```bash
mkdir -p ~/Lumiverse/vendor/lancedb-android/out
cp /sdcard/Download/lancedb.android-arm64.node \
   ~/Lumiverse/vendor/lancedb-android/out/
cd ~/Lumiverse
bun run start
```

### Startup log
You should see:
```
[startup] LanceDB native override: /data/data/com.termux/files/home/Lumiverse/vendor/lancedb-android/out/lancedb.android-arm64.node
```

If the binary is not found, Lumiverse falls back to the default npm binary and
the old Termux table-commit failure may still occur.

## Do NOT build on-device

LanceDB's Rust dependency tree includes Apache Arrow, DataFusion, AWS SDK,
lzma, and many more crates. Building this on an Android phone inside Termux
will:

- Require several GB of temporary storage
- Take hours
- Often crash during linking from running out of RAM

Always build on a PC and transfer the single `.node` file to the phone.

## Environmental overrides

You can force any native binary path in startup without the auto-detection:

```bash
export LUMIVERSE_LANCEDB_NATIVE_PATH=/sdcard/lancedb.android-arm64.node
bun run src/index.ts
```

This env var takes priority even off Termux.

## Updating

When Lumiverse bumps `@lancedb/lancedb`, you must:
1. Pull or clone the matching `lancedb` tag
2. Pull or clone the matching `lance` version (see `lancedb/Cargo.toml`)
3. Re-run this build script
4. Replace the `.node` on-device

Because the JNI/NAPI binary ABI is tied to the JS package version, the patched
native binary must be rebuilt on every `@lancedb/lancedb` upgrade.
