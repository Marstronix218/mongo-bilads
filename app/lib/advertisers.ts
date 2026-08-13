/**
 * Orangeboard advertiser-fit engine (seller-side flip of Bilads).
 *
 * Given one GASP board (record_id), rank the businesses around it (from the
 * Fiber enrichment dataset, data/billboard-fiber-businesses.json) as candidate
 * ADVERTISERS for that board: deterministic categorization + proximity-decayed
 * fit scores, plus category clusters so the pitch can say "you're one of nine
 * food & beverage spots this board watches over".
 *
 * Failure chain (app never dead-ends):
 *   - analyzeAdvertisers is pure deterministic math — no LLM, no fallback
 *     needed. Unknown record_id → null (route 404s); a known board with no
 *     Fiber coverage → a valid empty analysis, never a crash.
 *   - enrichAdvertisers makes ONE chatJson() call to layer MODELED firmographic
 *     inferences (industry, headcount band, hedged growth signals) onto the
 *     top candidates; any failure returns the input unchanged.
 *
 * Real signals vs projections: fitScore/clusters/distances are computed from
 * the Places dataset; every enrichment is tagged source: "modeled" so the UI
 * can label it honestly.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getInventoryBoard, type InventoryBoard } from "./inventory";
import { chatJson } from "./parse";
import { dataDir } from "./paths";

export interface AdvertiserFit {
  name: string;
  category: string;
  /** 0–100, computed (category weight × proximity decay × web/rating bumps). */
  fitScore: number;
  rationale: string;
  distanceM: number;
  enrichment?: {
    industry: string;
    headcountBand: string;
    signals: string[];
    source: "modeled";
  };
}

export interface AdvertiserAnalysis {
  recordId: string;
  mode: "b2b" | "b2c";
  clusters: { category: string; count: number; sample: string[] }[];
  advertisers: AdvertiserFit[];
  totalNearby: number;
}

interface FiberBusiness {
  placeId: string;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  allTypes?: string[] | null;
  website?: string | null;
  rating?: number | null;
  numReviews?: number | null;
  phoneNumber?: string | null;
}

interface FiberRecord {
  address?: string;
  lat: number;
  lng: number;
  businesses?: FiberBusiness[];
}

let fiberCache: Record<string, FiberRecord> | null = null;

function loadFiber(): Record<string, FiberRecord> {
  if (fiberCache) return fiberCache;
  const raw = JSON.parse(
    readFileSync(join(dataDir(), "billboard-fiber-businesses.json"), "utf-8")
  ) as { billboards: Record<string, FiberRecord> };
  fiberCache = raw.billboards ?? {};
  return fiberCache;
}

// Each Fiber record stores only its own top-~3 nearest businesses (avg 1.7),
// which is too thin for a ranked advertiser list. Pool every business across
// all 462 records (deduped by placeId) and select by radius from the board.
let pooledCache: FiberBusiness[] | null = null;

function allBusinesses(): FiberBusiness[] {
  if (pooledCache) return pooledCache;
  const seen = new Set<string>();
  const pooled: FiberBusiness[] = [];
  for (const rec of Object.values(loadFiber())) {
    for (const b of rec?.businesses ?? []) {
      if (
        b?.placeId &&
        typeof b.latitude === "number" &&
        typeof b.longitude === "number" &&
        !seen.has(b.placeId)
      ) {
        seen.add(b.placeId);
        pooled.push(b);
      }
    }
  }
  pooledCache = pooled;
  return pooled;
}

/** Radius for pooling citywide businesses around a board (~0.4 mi). */
const POOL_RADIUS_M = 600;

/** Board street context for pitch/mockup copy; null when Fiber has no entry. */
export function boardContext(
  recordId: string
): { address: string; lat: number; lng: number } | null {
  const rec = loadFiber()[recordId];
  if (!rec || typeof rec.lat !== "number" || typeof rec.lng !== "number") return null;
  return { address: rec.address ?? "San Francisco", lat: rec.lat, lng: rec.lng };
}

function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * 111_320;
  const dLng = (bLng - aLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/* ---------------------------------------------------------------------------
 * Deterministic categorization: keyword map over name + allTypes.
 * Order matters — first match wins (Legal before Finance so "attorney" lands
 * in Legal; Real Estate before SaaS so "architect" isn't claimed by tech).
 * ------------------------------------------------------------------------- */

interface CategoryDef {
  category: string;
  keywords: string[];
  /** Base attractiveness as an advertiser, per board mode (0..1). */
  b2bWeight: number;
  b2cWeight: number;
  /** Counts toward the office-side vote in "auto" mode detection. */
  office: boolean;
}

const CATEGORIES: CategoryDef[] = [
  {
    category: "Legal",
    keywords: ["attorney", "law firm", "law office", "lawyer", "legal", "paralegal"],
    b2bWeight: 0.8,
    b2cWeight: 0.5,
    office: true,
  },
  {
    category: "Real Estate / Construction",
    keywords: [
      "real estate", "realtor", "realty", "property management", "construction",
      "contractor", "roofing", "plumb", "electrician", "architect", "remodel",
      "hvac", "landscap", "mortgage", "escrow", "title company",
    ],
    b2bWeight: 0.75,
    b2cWeight: 0.65,
    office: true,
  },
  {
    category: "SaaS / Tech",
    keywords: [
      "software", "technology", "tech ", "computer", "information services",
      "internet", "data", "cloud", "cyber", "it service", "saas", "app develop",
      "web develop", "artificial intelligence",
    ],
    b2bWeight: 0.95,
    b2cWeight: 0.4,
    office: true,
  },
  {
    category: "Marketing / Creative",
    keywords: [
      "marketing", "advertising", "branding", "public relations", "graphic",
      "design studio", "design agency", "media", "photo", "print", "studio",
      "video production", "creative",
    ],
    b2bWeight: 0.9,
    b2cWeight: 0.55,
    office: true,
  },
  {
    category: "Finance / Professional",
    keywords: [
      "account", "tax", "bookkeep", "financial", "finance", "bank", "insurance",
      "wealth", "invest", "consultant", "consulting", "notary", "payroll",
      "business services",
    ],
    b2bWeight: 0.85,
    b2cWeight: 0.5,
    office: true,
  },
  {
    category: "Food & Beverage",
    keywords: [
      "restaurant", "cafe", "coffee", "bakery", "bar ", "food", "catering",
      "deli", "pizza", "taqueria", "tea", "brewery", "juice", "ice cream",
      "sushi", "noodle", "grill", "kitchen",
    ],
    b2bWeight: 0.35,
    b2cWeight: 0.95,
    office: false,
  },
  {
    category: "Fitness / Wellness",
    keywords: [
      "gym", "fitness", "yoga", "pilates", "wellness", "spa", "massage",
      "chiroprac", "physical therapy", "acupuncture", "dental", "dentist",
      "clinic", "salon", "barber",
    ],
    b2bWeight: 0.3,
    b2cWeight: 0.9,
    office: false,
  },
  {
    category: "Retail",
    keywords: [
      "store", "shop", "boutique", "retail", "market", "grocery", "clothing",
      "furniture", "jewelry", "florist", "book", "hardware", "pharmacy",
      "liquor", "wine",
    ],
    b2bWeight: 0.35,
    b2cWeight: 0.9,
    office: false,
  },
];

const OTHER_CATEGORY = "Other Services";
const OTHER_WEIGHT = { b2b: 0.5, b2c: 0.5 };

function categorize(b: FiberBusiness): CategoryDef | null {
  const hay = `${b.name} ${(b.allTypes ?? []).join(" ")}`.toLowerCase();
  for (const def of CATEGORIES) {
    if (def.keywords.some((kw) => hay.includes(kw))) return def;
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Fit scoring — all COMPUTED signals.
 * ------------------------------------------------------------------------- */

function fitScore(
  weight: number,
  distanceM: number,
  b: FiberBusiness
): number {
  // Fiber search radius is ~0.15 mi (~240 m); decay gently past that.
  const decay = Math.max(0.3, 1 - distanceM / 600);
  let score = weight * decay;
  if (b.website) score *= 1.15; // has a web presence → reachable, likely marketing-active
  const reviews = b.numReviews ?? 0;
  if (typeof b.rating === "number" && b.rating >= 4 && reviews >= 10) score *= 1.1;
  return Math.round(Math.min(98, Math.max(5, score * 100)));
}

function rationaleFor(
  category: string,
  distanceM: number,
  clusterCount: number,
  mode: "b2b" | "b2c"
): string {
  const dist = `${Math.round(distanceM)}m from the board`;
  const cluster =
    clusterCount > 1 ? `one of ${clusterCount} ${category} businesses nearby` : `the lone ${category} presence nearby`;
  const exposure =
    mode === "b2b"
      ? "daily exposure to its own commute corridor"
      : "daily walk-by and drive-by exposure to its customer base";
  return `${dist}, ${cluster} — ${exposure}.`;
}

/**
 * Deterministic advertiser-fit analysis for one GASP board.
 * Returns null only when the record_id isn't a real board in inventory.
 */
export function analyzeAdvertisers(
  recordId: string,
  mode: "b2b" | "b2c" | "auto" = "auto"
): AdvertiserAnalysis | null {
  const board: InventoryBoard | null = getInventoryBoard(recordId) ?? null;
  if (!board) return null;

  const rec = loadFiber()[recordId];
  const own = new Set((rec?.businesses ?? []).map((b) => b?.placeId).filter(Boolean));

  // Candidates: the record's own Fiber businesses plus every pooled business
  // within POOL_RADIUS_M of the board (inventory always has coordinates).
  const scored: Array<{ b: FiberBusiness; def: CategoryDef | null; distanceM: number }> = [];
  for (const b of allBusinesses()) {
    const distanceM = metersBetween(board.lat, board.lng, b.latitude, b.longitude);
    if (distanceM > POOL_RADIUS_M && !own.has(b.placeId)) continue;
    scored.push({ b, def: categorize(b), distanceM });
  }

  // Clusters = category counts, sorted desc.
  const byCategory = new Map<string, { count: number; sample: string[] }>();
  for (const { b, def } of scored) {
    const cat = def?.category ?? OTHER_CATEGORY;
    const entry = byCategory.get(cat) ?? { count: 0, sample: [] };
    entry.count += 1;
    if (entry.sample.length < 3) entry.sample.push(b.name);
    byCategory.set(cat, entry);
  }
  const clusters = [...byCategory.entries()]
    .map(([category, { count, sample }]) => ({ category, count, sample }))
    .sort((a, b) => b.count - a.count);

  // Auto mode: b2b when office-side categories dominate the neighborhood mix.
  let resolvedMode: "b2b" | "b2c";
  if (mode === "auto") {
    let officeCount = 0;
    let consumerCount = 0;
    for (const { def } of scored) {
      if (!def) continue;
      if (def.office) officeCount += 1;
      else consumerCount += 1;
    }
    resolvedMode = officeCount >= consumerCount ? "b2b" : "b2c";
  } else {
    resolvedMode = mode;
  }

  const advertisers: AdvertiserFit[] = scored
    .map(({ b, def, distanceM }) => {
      const category = def?.category ?? OTHER_CATEGORY;
      const weight = def
        ? resolvedMode === "b2b"
          ? def.b2bWeight
          : def.b2cWeight
        : OTHER_WEIGHT[resolvedMode];
      const clusterCount = byCategory.get(category)?.count ?? 1;
      return {
        name: b.name,
        category,
        fitScore: fitScore(weight, distanceM, b),
        rationale: rationaleFor(category, distanceM, clusterCount, resolvedMode),
        distanceM: Math.round(distanceM),
      };
    })
    .sort((a, b) => b.fitScore - a.fitScore || a.distanceM - b.distanceM)
    .slice(0, 12);

  return {
    recordId,
    mode: resolvedMode,
    clusters,
    advertisers,
    totalNearby: scored.length,
  };
}

/* ---------------------------------------------------------------------------
 * LLM enrichment — one chatJson() call, tagged "modeled", silent fallback.
 * ------------------------------------------------------------------------- */

const ENRICH_LIMIT = 8;
const HEADCOUNT_BANDS = ["1-10", "11-50", "51-200", "201+"] as const;

const ENRICH_SYSTEM = `You enrich local-business advertiser leads with MODELED firmographic estimates.
Respond with ONLY a valid JSON object — no prose, no markdown, no code fences. Shape:
{
  "enrichments": [
    {
      "name": "exact business name as given",
      "industry": "short industry label",
      "headcountBand": "1-10" | "11-50" | "51-200" | "201+",
      "signals": ["1-2 short hedged inferences"]
    }
  ]
}
Rules:
- These are ESTIMATES inferred only from the business name and category. Phrase every signal with hedging ("likely", "appears to", "typical for") — e.g. "likely hiring front-of-house staff given multi-location naming".
- NEVER invent specific facts: no funding rounds, revenue figures, named clients, or dates.
- One entry per business given, matching names exactly.`;

/**
 * Enrich the top advertisers with modeled industry/headcount/signal estimates.
 * Any failure (no key, timeout, bad JSON) returns the input list unchanged.
 */
export async function enrichAdvertisers(
  advertisers: AdvertiserFit[],
  recordId: string
): Promise<AdvertiserFit[]> {
  const targets = advertisers.slice(0, ENRICH_LIMIT);
  if (targets.length === 0) return advertisers;
  try {
    const out = await chatJson<{
      enrichments?: Array<{
        name?: string;
        industry?: string;
        headcountBand?: string;
        signals?: unknown;
      }>;
    }>([
      { role: "system", content: ENRICH_SYSTEM },
      {
        role: "user",
        content:
          `Businesses near San Francisco billboard ${recordId}:\n` +
          targets.map((a) => `- ${a.name} (${a.category})`).join("\n"),
      },
    ]);

    const byName = new Map<string, { industry: string; headcountBand: string; signals: string[] }>();
    for (const e of out?.enrichments ?? []) {
      if (!e?.name || !e.industry) continue;
      const band = HEADCOUNT_BANDS.includes(e.headcountBand as (typeof HEADCOUNT_BANDS)[number])
        ? (e.headcountBand as string)
        : "1-10";
      const signals = Array.isArray(e.signals)
        ? e.signals.filter((s): s is string => typeof s === "string" && s.length > 0).slice(0, 2)
        : [];
      byName.set(e.name.toLowerCase(), { industry: e.industry, headcountBand: band, signals });
    }
    if (byName.size === 0) return advertisers;

    return advertisers.map((a) => {
      const hit = byName.get(a.name.toLowerCase());
      return hit ? { ...a, enrichment: { ...hit, source: "modeled" as const } } : a;
    });
  } catch {
    return advertisers; // silent fallback — computed analysis still stands
  }
}
