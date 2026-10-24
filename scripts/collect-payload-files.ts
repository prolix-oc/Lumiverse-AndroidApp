import { readdirSync, realpathSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export function collectBundleFiles(root: string): { files: Record<string, Uint8Array>; executableFiles: string[] } {
  root = realpathSync(root);
  const files: Record<string, Uint8Array> = Object.create(null);
  const executableFiles: string[] = [];
  const visit = (directory: string, ancestors: Set<string>) => {
    const canonical = realpathSync(directory);
    if (ancestors.has(canonical)) throw new Error(`Cyclic directory in server payload: ${directory}`);
    const next = new Set(ancestors).add(canonical);
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      const actual = realpathSync(path);
      if (actual !== root && !actual.startsWith(root + sep)) throw new Error(`Server payload links outside its staging directory: ${path}`);
      const stat = statSync(path);
      if (stat.isDirectory()) visit(path, next);
      else if (stat.isFile()) {
        const name = relative(root, path).split(sep).join("/");
        // Bun 1.4.2 archives file-backed Blob entries as empty files. Materialize
        // bytes before creating the archive; native binaries must survive exactly.
        files[name] = readFileSync(path);
        if (stat.mode & 0o111) executableFiles.push(name);
      } else throw new Error(`Unsupported file in server payload: ${path}`);
    }
  };
  visit(root, new Set());
  return { files, executableFiles };
}

