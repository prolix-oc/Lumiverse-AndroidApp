import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { backendRoot } from "./backend-project";

export interface BackendSource { repository: string; ref: string }

export function parseBackendSource(value: unknown): BackendSource {
  const source = value as Partial<BackendSource> | null;
  if (!source || typeof source.repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository)
    || typeof source.ref !== "string" || !/^[a-f0-9]{40}$/.test(source.ref))
    throw new Error("backend-source.json must specify an owner/repository and a full 40-character commit SHA.");
  return { repository: source.repository, ref: source.ref };
}

export function assertBackendRevision(expected: string, actual: string): void {
  if (actual !== expected) throw new Error(`Backend revision mismatch: expected ${expected}, received ${actual}. Check out the commit in backend-source.json.`);
}

export function readBackendSource(): BackendSource {
  return parseBackendSource(JSON.parse(readFileSync(resolve(import.meta.dir, "../backend-source.json"), "utf8")));
}

if (import.meta.main) {
  const source = readBackendSource();
  if (process.argv.slice(2).length === 0) {
    console.log(`repository=${source.repository}\nref=${source.ref}`);
  } else if (process.argv.length === 3 && process.argv[2] === "--verify") {
    const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: backendRoot(), stdout: "pipe", stderr: "pipe" });
    if (revision.exitCode !== 0) throw new Error("The backend must be a Git checkout for CI revision verification.");
    assertBackendRevision(source.ref, revision.stdout.toString().trim());
    console.log(`Verified backend ${source.repository}@${source.ref}`);
  } else throw new Error("Usage: bun scripts/backend-source.ts [--verify]");
}
