#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { patchAndroidObjectStore } from "./patch-android-object-store";
import { androidNdkLlvm } from "./android-native";

import { backendRoot } from "./backend-project";

const root = resolve(import.meta.dir, "..");
const version = "0.41.0";
const commit = "3936a8b3bcce8f8e073f3ec6a47e4ca4d3381b92";
// Lance uses 0.14.2; DataFusion still uses 0.13.2. Both can access local files.
const objectStores = [
  { version: "0.14.2", sha256: "f1796bc93603f78c5760a69f2d58badc9618d22adade0a95385bb2adbae4eb94", patchKey: "object_store" },
  { version: "0.13.2", sha256: "622acbc9100d3c10e2ee15804b0caa40e55c933d5aa53814cd520805b7958a49", patchKey: "object_store_013" },
] as const;
const target = "aarch64-linux-android";
const cache = join(root, ".tmp/android-native");
const ndk = process.env.ANDROID_NDK_HOME || join(cache, "android-ndk-r28c");
const llvm = androidNdkLlvm(ndk);
if (JSON.parse(readFileSync(join(backendRoot(), "package.json"), "utf8")).dependencies["@lancedb/lancedb"] !== version)
  throw new Error("Update the Android LanceDB source pin to match package.json.");
async function run(cmd: string[], cwd: string, env = process.env) {
  const child = Bun.spawn(cmd, { cwd, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`Build failed: ${cmd.join(" ")}`);
}
const source = join(cache, `lancedb-${version}-source`);
if (!existsSync(source)) {
  const upstream = join(cache, `lancedb-${version}-upstream`);
  mkdirSync(cache, { recursive: true });
  if (!existsSync(upstream)) await run(["git", "clone", "--depth", "1", "--branch", `v${version}`, "https://github.com/lancedb/lancedb.git", upstream], root);
  const archive = Bun.spawnSync(["git", "archive", commit], { cwd: upstream, stdout: "pipe", stderr: "pipe" });
  if (archive.exitCode) throw new Error(archive.stderr.toString());
  mkdirSync(source, { recursive: true });
  await new Bun.Archive(archive.stdout).extract(source);
  writeFileSync(join(source, ".source-commit"), commit);
}
if (readFileSync(join(source, ".source-commit"), "utf8") !== commit) throw new Error("Unexpected cached LanceDB source.");
// Vendor only this build's object_store crates. Never modify the global Cargo cache.
const objectStorePatches: Record<string, string> = {};
const workspaceManifest = join(source, "Cargo.toml");
let workspaceSource = readFileSync(workspaceManifest, "utf8");
for (const store of objectStores) {
  const archive = join(cache, `object_store-${store.version}.crate`);
  if (!existsSync(archive)) await run(["curl", "--fail", "--location", "--silent", "--show-error", "--output", archive,
    `https://static.crates.io/crates/object_store/object_store-${store.version}.crate`], root);
  if (createHash("sha256").update(readFileSync(archive)).digest("hex") !== store.sha256)
    throw new Error(`object_store ${store.version} source checksum mismatch`);
  const original = join(cache, `object-store-${store.version}-original`); mkdirSync(original, { recursive: true });
  await run(["tar", "-xf", archive, "--strip-components=1", "-C", original], root);
  const patched = join(cache, `object-store-${store.version}`);
  objectStorePatches[store.version] = patchAndroidObjectStore(original, patched, join(root, "android/native/object-store-android.rs"));
  const section = `[patch.crates-io.${store.patchKey}]`;
  const override = `${section}\npackage = "object_store"\npath = ${JSON.stringify(patched)}\n`;
  const start = workspaceSource.indexOf(section);
  if (start < 0) workspaceSource += "\n" + override;
  else {
    const next = workspaceSource.indexOf("\n[", start + section.length);
    workspaceSource = workspaceSource.slice(0, start) + override + (next < 0 ? "" : workspaceSource.slice(next));
  }
}
writeFileSync(workspaceManifest, workspaceSource);
// A new CI runner has no Cargo registry yet. CARGO_NET_OFFLINE still supports
// explicitly offline builds once the dependency cache has been populated.
for (const store of objectStores)
  await run(["cargo", "+1.97.0", "update", "-p", `object_store@${store.version}`, "--precise", store.version], source);
const env = {
  ...process.env,
  CARGO_TARGET_DIR: join(cache, "lancedb-target"),
  CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER: join(llvm, "aarch64-linux-android29-clang"),
  CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS: "-C link-arg=-Wl,-z,max-page-size=16384 -C link-arg=-Wl,-z,common-page-size=16384",
  CC_aarch64_linux_android: join(llvm, "aarch64-linux-android29-clang"),
  CXX_aarch64_linux_android: join(llvm, "aarch64-linux-android29-clang++"),
  AR_aarch64_linux_android: join(llvm, "llvm-ar"),
  CARGO_PROFILE_RELEASE_LTO: "off",
  CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "16",
  CARGO_PROFILE_RELEASE_OPT_LEVEL: "2",
  CARGO_PROFILE_RELEASE_DEBUG: "0",
  CARGO_PROFILE_RELEASE_STRIP: "none",
  CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP: "none",
  CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_DEBUG: "1",
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || "4",
  CARGO_INCREMENTAL: "0",
};
await run(["cargo", "+1.97.0", "build", "--manifest-path", join(source, "nodejs/Cargo.toml"), "--locked", "--release", "--target", target,
  "--no-default-features", "--features", "remote,lancedb/metrics-otel"], source, env);
const out = join(root, "dist/native/android-arm64"); mkdirSync(out, { recursive: true });
const binary = join(out, "liblancedb.so");
copyFileSync(join(cache, "lancedb-target", target, "release/liblancedb_nodejs.so"), binary);
await run([join(llvm, "llvm-strip"), "--strip-unneeded", binary], root);
copyFileSync(join(source, "LICENSE"), join(out, "LanceDB.LICENSE"));
const notices = join(out, "notices"); mkdirSync(notices, { recursive: true });
copyFileSync(join(cache, `object-store-${objectStores[0].version}`, "LICENSE.txt"), join(notices, "object_store.LICENSE"));
copyFileSync(join(source, "Cargo.lock"), join(out, "lancedb.Cargo.lock"));
await Bun.write(join(out, "lancedb.json"), JSON.stringify({ format: 1, version, sourceCommit: commit, target, api: 29, rustToolchain: "1.97.0",
  features: ["remote", "lancedb/metrics-otel"], objectStore: objectStores[0].version, objectStorePatches,
  sha256: createHash("sha256").update(readFileSync(binary)).digest("hex") }, null, 2) + "\n");
console.log(`[android-native] Built ${binary}`);
