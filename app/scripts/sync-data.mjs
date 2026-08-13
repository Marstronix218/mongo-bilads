// Runs scripts/sync-frontend-data.mjs when the canonical sources exist (local
// dev, where app/ lives inside the monorepo). In deployed builds only app/ is
// uploaded, so the sync is skipped and the committed app/lib copies are used.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "scripts",
  "sync-frontend-data.mjs",
);

if (existsSync(script)) {
  const r = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  process.exit(r.status ?? 0);
}
console.log("✓ sync skipped (monorepo sources absent — using committed app/lib copies)");
