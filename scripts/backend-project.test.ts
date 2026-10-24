import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { backendModule, backendRoot } from "./backend-project";

let checkout: string;
let originalOverride: string | undefined;

beforeEach(() => {
  originalOverride = process.env.LUMIVERSE_BACKEND_DIR;
  checkout = mkdtempSync(join(tmpdir(), "lumiverse-backend-checkout-"));
  process.env.LUMIVERSE_BACKEND_DIR = checkout;
});

afterEach(() => {
  if (originalOverride === undefined) delete process.env.LUMIVERSE_BACKEND_DIR;
  else process.env.LUMIVERSE_BACKEND_DIR = originalOverride;
  rmSync(checkout, { recursive: true, force: true });
});

test.each(["Lumiverse", "Lumiverse-Backend"])("resolves the backend package from a folder named %s", (folder) => {
  const root = join(checkout, folder);
  mkdirSync(root);
  process.env.LUMIVERSE_BACKEND_DIR = root;
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "lumiverse-backend" }));
  expect(backendRoot()).toBe(root);
  expect(backendModule("src/services/apns-encryption.ts"))
    .toBe(pathToFileURL(join(root, "src/services/apns-encryption.ts")).href);
});

test("reports a missing backend manifest", () => {
  expect(() => backendRoot()).toThrow(`Missing Lumiverse checkout at ${checkout}`);
});

test("rejects an unrelated package with a distinct diagnostic", () => {
  writeFileSync(join(checkout, "package.json"), JSON.stringify({ name: "lumiverse" }));
  expect(() => backendRoot()).toThrow('package.json name is "lumiverse"; expected "lumiverse-backend"');
});
