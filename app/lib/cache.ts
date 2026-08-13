/**
 * Disk cache for /api/generate (PRD §10) — critical for demo reliability.
 * Key: hash(billboardId, sampleId, variant, consistentBrand). We use the
 * slugged productName as the sampleId stand-in (GenerateRequest carries no
 * sampleId; sample briefs have stable productNames, so keys stay stable).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GenerateResponse } from "@/lib/types";
import { dataDir } from "./paths";

function cacheDir(): string {
  return join(dataDir(), "cache");
}

export function generateCacheKey(args: {
  billboardId: string;
  productName: string;
  variant: number;
  consistentBrand: boolean;
}): string {
  const sampleId = args.productName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
  const raw = [args.billboardId, sampleId, args.variant, args.consistentBrand].join("|");
  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

export function readGenerateCache(key: string): GenerateResponse | null {
  try {
    return JSON.parse(readFileSync(join(cacheDir(), `${key}.json`), "utf8")) as GenerateResponse;
  } catch {
    return null;
  }
}

export function writeGenerateCache(key: string, value: GenerateResponse): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(join(cacheDir(), `${key}.json`), JSON.stringify(value, null, 2));
  } catch {
    // cache write failure must never fail the request
  }
}
