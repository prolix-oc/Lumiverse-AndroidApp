import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectBundleFiles } from "./collect-payload-files";

test("Android payload preserves native bytes and executable permissions", () => {
  const directory = mkdtempSync(join(tmpdir(), "android-payload-"));
  try {
    const binary = join(directory, "runtime");
    writeFileSync(binary, new Uint8Array([0, 1, 2, 255]));
    chmodSync(binary, 0o755);
    const { files, executableFiles } = collectBundleFiles(directory);
    expect(files.runtime).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(executableFiles).toEqual(["runtime"]);
    symlinkSync(directory, join(directory, "cycle"));
    expect(() => collectBundleFiles(directory)).toThrow("Cyclic directory");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Android payload rejects links to files outside its staging directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "android-payload-"));
  const external = mkdtempSync(join(tmpdir(), "android-external-"));
  try {
    writeFileSync(join(external, "secret"), "must not ship");
    symlinkSync(join(external, "secret"), join(directory, "external"));
    expect(() => collectBundleFiles(directory)).toThrow("outside its staging directory");
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
