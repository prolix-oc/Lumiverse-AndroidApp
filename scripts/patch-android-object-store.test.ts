import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchAndroidObjectStore } from "./patch-android-object-store";

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture(version: string) {
  const root = mkdtempSync(join(tmpdir(), "android-object-store-patch-")); temporary.push(root);
  mkdirSync(join(root, "upstream/src"), { recursive: true });
  writeFileSync(join(root, "upstream/Cargo.toml"), `[package]\nversion = "${version}"\n`);
  const deletion = version === "0.14.2"
    ? "Self::delete_location(config, automatic_cleanup, &from, fsync).await?;"
    : "self.delete(from).await?;";
  const fallback = `\n                self.copy_opts(from, to, options).await?;\n                ${deletion}\n                Ok(())\n            `;
  const source = `std::fs::hard_link(&from, &staged);\nstd::fs::hard_link(original, link);\n`
    + (version === "0.13.2" ? "std::fs::hard_link(&from, &to);\n" : "")
    + `            // fall-back to copy & delete\n            RenameTargetMode::Create => {${fallback}}\n`;
  writeFileSync(join(root, "upstream/src/local.rs"), source);
  return { upstream: join(root, "upstream"), destination: join(root, "patched"), source, fallback };
}
const helper = join(import.meta.dir, "../android/native/object-store-android.rs");

for (const version of ["0.13.2", "0.14.2"]) for (const platform of ["android", "termux"] as const) {
  test(`patches object_store ${version} for ${platform} without changing its upstream source or other platforms`, () => {
    const f = fixture(version);
    const digest = patchAndroidObjectStore(f.upstream, f.destination, helper, platform);
    const targetOs = platform === "termux" ? "linux" : "android";
    const output = readFileSync(join(f.destination, "src/local.rs"), "utf8");
    expect(readFileSync(join(f.upstream, "src/local.rs"), "utf8")).toBe(f.source);
    expect(output).toContain(`#[cfg(not(target_os = "${targetOs}"))]\n                {${f.fallback}`);
    expect(output).toContain(`#[cfg(target_os = "${targetOs}")]\nfn android_rename_noreplace`);
    expect(output).toContain("match android_rename_noreplace(&from, &to)");
    expect(output).toContain("ErrorKind::AlreadyExists => return Err(Error::AlreadyExists");
    expect(output).not.toContain("std::fs::hard_link(original, link)");
    expect(output).not.toContain("std::fs::hard_link(&from, &staged)");
    if (version === "0.14.2") {
      expect(output).toContain("create_parent_dirs(&to, source, fsync)?");
      expect(output).toContain("fsync_parent_dir(&to)");
      expect(output).toContain("fsync_parent_dir(&from)");
    } else {
      expect(output).toContain("create_parent_dirs(&to, source)?");
      expect(output).not.toContain("fsync_parent_dir(");
    }
    const modifiedAt = statSync(join(f.destination, "src/local.rs")).mtimeMs;
    expect(patchAndroidObjectStore(f.upstream, f.destination, helper, platform)).toBe(digest);
    expect(statSync(join(f.destination, "src/local.rs")).mtimeMs).toBe(modifiedAt);
  });
}

test("refuses an unreviewed version or changed storage implementation", () => {
  const unsupported = fixture("0.14.3");
  expect(() => patchAndroidObjectStore(unsupported.upstream, unsupported.destination, helper)).toThrow("Unsupported object_store version");
  const changed = fixture("0.14.2");
  writeFileSync(join(changed.upstream, "src/local.rs"), changed.source.replace("std::fs::hard_link(original, link);", ""));
  expect(() => patchAndroidObjectStore(changed.upstream, changed.destination, helper)).toThrow("Unexpected object_store hard-link implementation");
  writeFileSync(join(changed.upstream, "src/local.rs"), changed.source.replace("Self::delete_location", "Self::different_delete"));
  expect(() => patchAndroidObjectStore(changed.upstream, changed.destination, helper)).toThrow("Unexpected object_store rename implementation");
});
