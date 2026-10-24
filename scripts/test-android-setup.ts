import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { backendRoot } from "./backend-project";

// Match the APK's layout without checking server source into this project.
const root = resolve(import.meta.dir, "..");
mkdirSync(join(root, ".tmp"), { recursive: true });
const staging = mkdtempSync(join(root, ".tmp/android-setup-test-"));
try {
  mkdirSync(join(staging, "android"));
  cpSync(join(root, "android/setup.ts"), join(staging, "android/setup.ts"));
  cpSync(join(root, "tests/fixtures/android-setup.ts"), join(staging, "android/setup.test.ts"));
  symlinkSync(join(backendRoot(), "src"), join(staging, "src"), "dir");
  const child = Bun.spawn([process.execPath, "test", "--isolate", "android/setup.test.ts"], { cwd: staging, stdout: "inherit", stderr: "inherit" });
  process.exitCode = await child.exited;
} finally { rmSync(staging, { recursive: true, force: true }); }
