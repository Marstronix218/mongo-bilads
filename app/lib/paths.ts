/**
 * Repo-layout resolver. The Next.js app lives in app/ but shared demo data
 * (data/nimble-signals, data/creative-seed, data/cache) lives at the repo
 * root. Resolve against cwd first so this works whether the dev server was
 * started from app/ or the repo root.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

let resolved: string | null = null;

/** Absolute path to the repo-root data/ directory. */
export function dataDir(): string {
  if (!resolved) {
    const candidates = [join(process.cwd(), "data"), join(process.cwd(), "..", "data")];
    resolved = candidates.find((p) => existsSync(join(p, "billboards.json"))) ?? candidates[0];
  }
  return resolved;
}
