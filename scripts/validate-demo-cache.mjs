import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const cacheDir = join(repoRoot, "data", "cache");
const generatedDir = join(repoRoot, "app", "public", "generated");

// Default top-three boards for every sample plus the Volt targeted-slider reveal.
const DEMO_SURFACE = {
  Volt: ["sf-101-vermont", "sf-mission-24th", "sf-soma-harrison", "sf-marina-chestnut"],
  "Fog City Coffee": ["sf-mission-24th", "sf-valencia-mission", "sf-dogpatch-3rd"],
  Ledgerly: ["sf-financial-montgomery", "sf-market-downtown", "sf-101-vermont"],
};

const failures = [];
let entries = 0;

for (const [productName, boardIds] of Object.entries(DEMO_SURFACE)) {
  const productSlug = productName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  for (const billboardId of boardIds) {
    for (const variant of [0, 1]) {
      const key = createHash("sha1")
        .update([billboardId, productSlug, variant, false].join("|"))
        .digest("hex")
        .slice(0, 16);
      const cachePath = join(cacheDir, `${key}.json`);
      if (!existsSync(cachePath)) {
        failures.push(`${productName}/${billboardId}/v${variant}: missing ${key}.json`);
        continue;
      }
      let cached;
      try {
        cached = JSON.parse(readFileSync(cachePath, "utf8"));
      } catch {
        failures.push(`${productName}/${billboardId}/v${variant}: invalid JSON`);
        continue;
      }
      if (!Array.isArray(cached.concepts) || cached.concepts.length !== 2) {
        failures.push(`${productName}/${billboardId}/v${variant}: expected exactly two concepts`);
        continue;
      }
      for (const concept of cached.concepts) {
        if (typeof concept.imageUrl !== "string" || !/^\/generated\/[A-Za-z0-9._-]+$/.test(concept.imageUrl)) {
          failures.push(`${productName}/${billboardId}/v${variant}: non-local image URL`);
        } else if (!existsSync(join(generatedDir, basename(concept.imageUrl)))) {
          failures.push(`${productName}/${billboardId}/v${variant}: missing ${concept.imageUrl}`);
        }
      }
      entries += 1;
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`✓ verified ${entries} demo cache entries with ${entries * 2} committed images`);
