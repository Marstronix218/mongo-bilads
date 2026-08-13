// Copies the canonical data/contract files into app/lib/ so the Next.js frontend
// (which can only import via "@/lib/*", rooted at app/) always sees the single
// source of truth. Runs automatically on `next dev` / `next build` (predev /
// prebuild in app/package.json). Prevents the two copies from drifting.
//
//   node scripts/sync-frontend-data.mjs          # write app/lib copies
//   node scripts/sync-frontend-data.mjs --check   # exit 1 if any copy is stale
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const banner = (src) =>
  `// AUTO-GENERATED from ${src} by scripts/sync-frontend-data.mjs — do not edit here.\n` +
  `// Edit the source, then \`npm run sync\` (runs automatically on predev/prebuild).\n\n`;

// Canonical source -> app/lib target. `transform` adjusts import paths; `.ts`
// files get a "generated" banner, JSON files are copied byte-for-byte.
const FILES = [
  { src: "data/billboards.json", dest: "app/lib/billboards.json" },
  { src: "data/traffic-heatmap.json", dest: "app/lib/traffic-heatmap.json" },
  { src: "types.ts", dest: "app/lib/types.ts", ts: true },
  {
    src: "data/samples.ts",
    dest: "app/lib/samples.ts",
    ts: true,
    // samples.ts imports the contract; path differs once it lives beside types.ts
    transform: (s) => s.replace('from "../types"', 'from "./types"'),
  },
];

const expected = (f) => {
  let out = readFileSync(join(ROOT, f.src), "utf8");
  if (f.transform) out = f.transform(out);
  if (f.ts) out = banner(f.src) + out;
  return out;
};

const check = process.argv.includes("--check");
const drifted = [];
for (const f of FILES) {
  const want = expected(f);
  if (check) {
    let have = "";
    try { have = readFileSync(join(ROOT, f.dest), "utf8"); } catch { /* missing */ }
    if (have !== want) drifted.push(f.dest);
  } else {
    writeFileSync(join(ROOT, f.dest), want);
  }
}

if (check) {
  if (drifted.length) {
    console.error("✗ app/lib is stale vs canonical sources:\n  " + drifted.join("\n  "));
    console.error("  fix: node scripts/sync-frontend-data.mjs");
    process.exit(1);
  }
  console.log("✓ app/lib is in sync with canonical sources");
} else {
  console.log(`✓ synced ${FILES.length} files to app/lib/`);
}
