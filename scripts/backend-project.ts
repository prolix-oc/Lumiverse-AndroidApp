import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Shared sources are build inputs from a separate checkout, never vendored. */
export function backendRoot(): string {
  const root = resolve(process.env.LUMIVERSE_BACKEND_DIR || resolve(import.meta.dir, "../../Lumiverse"));
  const manifest = join(root, "package.json");
  if (!existsSync(manifest) || JSON.parse(readFileSync(manifest, "utf8")).name !== "lumiverse")
    throw new Error(`Missing Lumiverse checkout at ${root}. Set LUMIVERSE_BACKEND_DIR to its absolute path.`);
  return root;
}

export function backendModule(path: string): string {
  return pathToFileURL(join(backendRoot(), path)).href;
}
