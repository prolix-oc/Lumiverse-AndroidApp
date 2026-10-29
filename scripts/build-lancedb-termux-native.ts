#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { backendRoot } from "./backend-project";
import { patchAndroidObjectStore } from "./patch-android-object-store";

const root = resolve(import.meta.dir, "..");
const version = "0.41.0", sourceCommit = "3936a8b3bcce8f8e073f3ec6a47e4ca4d3381b92";
const target = "aarch64-unknown-linux-gnu", minimumGlibc = "2.27", rust = "1.97.0";
const zig = "0.16.0", cargoZigbuild = "0.22.3";
const stores = [
  { version: "0.14.2", sha256: "f1796bc93603f78c5760a69f2d58badc9618d22adade0a95385bb2adbae4eb94", key: "object_store" },
  { version: "0.13.2", sha256: "622acbc9100d3c10e2ee15804b0caa40e55c933d5aa53814cd520805b7958a49", key: "object_store_013" },
] as const;
const cache = join(root, ".tmp/termux-native"), source = join(cache, `lancedb-${version}-source`);
if (JSON.parse(readFileSync(join(backendRoot(), "package.json"), "utf8")).dependencies["@lancedb/lancedb"] !== version)
  throw new Error("Update the Termux LanceDB source pin to match the backend dependency.");
async function run(cmd: string[], cwd = root, env = process.env) {
  const child = Bun.spawn(cmd, { cwd, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`Termux build failed: ${cmd.join(" ")}`);
}
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const zigVersion = Bun.spawnSync(["zig", "version"]);
if (zigVersion.exitCode || zigVersion.stdout.toString().trim() !== zig) throw new Error(`Install Zig ${zig}.`);
const cargoTools = Bun.spawnSync(["cargo", `+${rust}`, "install", "--list"]);
if (cargoTools.exitCode || !cargoTools.stdout.toString().includes(`cargo-zigbuild v${cargoZigbuild}:`))
  throw new Error(`Install cargo-zigbuild ${cargoZigbuild} with cargo install --version ${cargoZigbuild} --locked cargo-zigbuild.`);
const sysroot = Bun.spawnSync(["rustc", `+${rust}`, "--print", "sysroot"]);
const rustInfo = Bun.spawnSync(["rustc", `+${rust}`, "-vV"]);
const host = rustInfo.stdout.toString().match(/^host: (.+)$/m)?.[1];
if (sysroot.exitCode || rustInfo.exitCode || !host) throw new Error(`Cannot locate Rust ${rust}.`);
const strip = join(sysroot.stdout.toString().trim(), "lib/rustlib", host, "bin/llvm-strip");
if (!existsSync(strip)) throw new Error(`Install rustup component add --toolchain ${rust} llvm-tools-preview.`);
mkdirSync(cache, { recursive: true });
if (!existsSync(source)) {
  const upstream = join(cache, `lancedb-${version}-upstream`);
  if (!existsSync(upstream)) await run(["git", "clone", "--depth", "1", "--branch", `v${version}`, "https://github.com/lancedb/lancedb.git", upstream]);
  const archive = Bun.spawnSync(["git", "archive", sourceCommit], { cwd: upstream });
  if (archive.exitCode) throw new Error(archive.stderr.toString());
  mkdirSync(source, { recursive: true });
  await new Bun.Archive(archive.stdout).extract(source);
  writeFileSync(join(source, ".source-commit"), sourceCommit);
}
if (readFileSync(join(source, ".source-commit"), "utf8") !== sourceCommit) throw new Error("Unexpected cached LanceDB source.");
// Always start from the pinned manifest, never accumulate stale patch sections.
const upstream = join(cache, `lancedb-${version}-upstream`);
const originalManifest = Bun.spawnSync(["git", "show", `${sourceCommit}:Cargo.toml`], { cwd: upstream });
if (originalManifest.exitCode) throw new Error(originalManifest.stderr.toString());
let manifest = originalManifest.stdout.toString();
const objectStorePatches: Record<string, string> = {};
for (const store of stores) {
  const archive = join(cache, `object_store-${store.version}.crate`);
  if (!existsSync(archive)) await run(["curl", "--fail", "--location", "--silent", "--show-error", "--output", archive,
    `https://static.crates.io/crates/object_store/object_store-${store.version}.crate`]);
  if (sha256(archive) !== store.sha256) throw new Error(`object_store ${store.version} checksum mismatch`);
  const original = join(cache, `object-store-${store.version}-original`), patched = join(cache, `object-store-${store.version}-termux`);
  mkdirSync(original, { recursive: true });
  await run(["tar", "-xf", archive, "--strip-components=1", "-C", original]);
  objectStorePatches[store.version] = patchAndroidObjectStore(original, patched, join(root, "android/native/object-store-android.rs"), "termux");
  manifest += `\n[patch.crates-io.${store.key}]\npackage = "object_store"\npath = ${JSON.stringify(patched)}\n`;
}
writeFileSync(join(source, "Cargo.toml"), manifest);
for (const store of stores) await run(["cargo", `+${rust}`, "update", "-p", `object_store@${store.version}`, "--precise", store.version], source);
await run(["cargo", `+${rust}`, "update", "--workspace"], source);
// Only the workspace's beta version labels and our two local patches may change.
// Reject accidental third-party dependency updates before compiling.
const originalLock = Bun.spawnSync(["git", "show", `${sourceCommit}:Cargo.lock`], { cwd: upstream });
if (originalLock.exitCode) throw new Error(originalLock.stderr.toString());
type LockedPackage = { name: string; version: string; source?: string; checksum?: string };
const lockedPackages = (text: string) => (Bun.TOML.parse(text) as { package: LockedPackage[] }).package
  .filter(pkg => pkg.source || (pkg.name === "object_store" && stores.some(store => store.version === pkg.version)))
  .map(pkg => ({ name: pkg.name, version: pkg.version, ...(pkg.name === "object_store" && stores.some(store => store.version === pkg.version)
    ? {} : { source: pkg.source, checksum: pkg.checksum }) }))
  .sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
if (JSON.stringify(lockedPackages(originalLock.stdout.toString())) !== JSON.stringify(lockedPackages(readFileSync(join(source, "Cargo.lock"), "utf8"))))
  throw new Error("Termux build changed the pinned third-party Cargo dependencies.");
const env = { ...process.env, CARGO_TARGET_DIR: join(cache, "lancedb-target"),
  CARGO_PROFILE_RELEASE_LTO: "off", CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "16", CARGO_PROFILE_RELEASE_OPT_LEVEL: "2",
  CARGO_PROFILE_RELEASE_DEBUG: "0", CARGO_PROFILE_RELEASE_STRIP: "none", CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP: "none",
  CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_DEBUG: "1", CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || "4", CARGO_INCREMENTAL: "0" };
await run(["cargo", `+${rust}`, "zigbuild", "--manifest-path", join(source, "nodejs/Cargo.toml"), "--locked", "--release",
  "--target", `${target}.${minimumGlibc}`, "--no-default-features", "--features", "remote,lancedb/metrics-otel"], source, env);
const out = join(root, "dist/native/termux-arm64"); mkdirSync(out, { recursive: true });
const binary = join(out, "lancedb.termux-arm64.node");
copyFileSync(join(cache, "lancedb-target", target, "release/liblancedb_nodejs.so"), binary);
await run([strip, "--strip-unneeded", binary]);
copyFileSync(join(source, "LICENSE"), join(out, "LICENSE"));
copyFileSync(join(source, "Cargo.lock"), join(out, "Cargo.lock"));
for (const store of stores) copyFileSync(join(cache, `object-store-${store.version}-termux/LICENSE.txt`), join(out, `object_store-${store.version}.LICENSE`));
writeFileSync(join(out, "manifest.json"), JSON.stringify({ format: 1, version, sourceCommit, target, minimumGlibc, rustToolchain: rust, zigVersion: zig, cargoZigbuildVersion: cargoZigbuild,
  features: ["remote", "lancedb/metrics-otel"], objectStorePatches, sha256: sha256(binary) }, null, 2) + "\n");
console.log(`[termux-native] Built ${binary}`);
