/**
 * Seller-side inventory access (Orangeboard): load the real SF GASP permit
 * dataset (data/sf-billboards.geojson — 559 General Advertising Sign records
 * scraped from SF Planning) and expose it as a flat, typed board list for the
 * owner-facing flow.
 *
 * Pure disk reads — no LLM calls, so no fallback chain needed. Both datasets
 * load lazily via readFileSync and are cached for the process lifetime (same
 * pattern as lib/blobs.ts). Malformed features (missing record_id or point
 * geometry) are skipped rather than throwing, so one bad row never dead-ends
 * the app.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./paths";

export interface InventoryBoard {
  recordId: string;
  address: string;
  status: string;
  statusDate?: string;
  dateOpened?: string;
  dateClosed?: string;
  acalink?: string;
  plannerName?: string;
  plannerEmail?: string;
  lat: number;
  lng: number;
  /** true when the record has a Fiber business-enrichment entry (462/559 do). */
  hasBusinessData: boolean;
}

interface GaspFeature {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: {
    record_id?: string;
    address?: string;
    record_status?: string;
    record_status_date?: string | null;
    date_opened?: string | null;
    date_closed?: string | null;
    acalink?: string | null;
    planner_name?: string | null;
    planner_email?: string | null;
  };
}

let boardsCache: InventoryBoard[] | null = null;
let byIdCache: Map<string, InventoryBoard> | null = null;
let fiberKeysCache: Set<string> | null = null;

/** record_ids present in the Fiber enrichment file (loaded once, keys only). */
function fiberKeys(): Set<string> {
  if (fiberKeysCache) return fiberKeysCache;
  let keys: string[] = [];
  try {
    const raw = JSON.parse(
      readFileSync(join(dataDir(), "billboard-fiber-businesses.json"), "utf-8")
    ) as { billboards?: Record<string, unknown> };
    keys = Object.keys(raw.billboards ?? {});
  } catch {
    // Enrichment file missing/corrupt → every board just reads as un-enriched.
  }
  fiberKeysCache = new Set(keys);
  return fiberKeysCache;
}

function loadBoards(): InventoryBoard[] {
  if (boardsCache) return boardsCache;
  const raw = JSON.parse(
    readFileSync(join(dataDir(), "sf-billboards.geojson"), "utf-8")
  ) as { features?: GaspFeature[] };
  const enriched = fiberKeys();

  const boards: InventoryBoard[] = [];
  for (const f of raw.features ?? []) {
    const p = f.properties ?? {};
    const coords = f.geometry?.coordinates;
    if (
      !p.record_id ||
      !Array.isArray(coords) ||
      typeof coords[0] !== "number" ||
      typeof coords[1] !== "number"
    ) {
      continue;
    }
    boards.push({
      recordId: p.record_id,
      address: p.address ?? "San Francisco, CA",
      status: p.record_status ?? "Unknown",
      statusDate: p.record_status_date ?? undefined,
      dateOpened: p.date_opened ?? undefined,
      dateClosed: p.date_closed ?? undefined,
      acalink: p.acalink ?? undefined,
      plannerName: p.planner_name ?? undefined,
      plannerEmail: p.planner_email ?? undefined,
      lng: coords[0],
      lat: coords[1],
      hasBusinessData: enriched.has(p.record_id),
    });
  }
  boardsCache = boards;
  byIdCache = new Map(boards.map((b) => [b.recordId, b]));
  return boardsCache;
}

/** All 559 GASP permit boards (well-formed features only). */
export function listInventory(): InventoryBoard[] {
  return loadBoards();
}

/** Single board lookup by GASP record_id; null when unknown. */
export function getInventoryBoard(recordId: string): InventoryBoard | null {
  loadBoards();
  return byIdCache?.get(recordId) ?? null;
}
