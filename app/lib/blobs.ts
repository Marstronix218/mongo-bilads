/**
 * Opportunity blobs (Peel-style ABM): cluster the businesses from the Fiber
 * enrichment dataset (data/billboard-fiber-businesses.json — Google Places
 * results around each SF GAS permit record) that match the campaign's ICP
 * into geographic blobs, and count target accounts near each of our boards.
 *
 * Pure deterministic math — no LLM calls, so no fallback chain needed. The
 * dataset loads lazily from disk and is cached for the process lifetime.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AudienceProfile, Billboard } from "./types";
import { dataDir } from "./paths";

export interface OpportunityBlob {
  lat: number;
  lng: number;
  /** Blob radius in meters (capped; visual affordance, not a hard boundary). */
  radiusM: number;
  count: number;
  label: string;
  sampleNames: string[];
}

export interface BlobsResult {
  blobs: OpportunityBlob[];
  /** boardId → matched businesses within NEARBY_RADIUS_M of the board. */
  nearbyByBoard: Record<string, number>;
  totalMatched: number;
  totalBusinesses: number;
}

interface FiberBusiness {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  allTypes?: string[];
}

const CLUSTER_RADIUS_M = 650; // greedy cluster capture radius
const NEARBY_RADIUS_M = 400; // "target accounts near this board" (~0.25 mi)
const MIN_BLOB_COUNT = 4;
const MAX_BLOBS = 6;

// ICP interest tags (GODSON.md vocabulary) → Google Places type/name keywords.
// The Fiber dataset skews B2B ("business" search query), so consumer tags map
// to the office-side businesses that serve those audiences.
const TAG_KEYWORDS: Record<string, string[]> = {
  tech: ["software", "computer", "information services", "internet", "technology", "data"],
  startups: ["software", "marketing agency", "coworking", "business development", "venture"],
  finance: ["account", "tax", "bookkeeping", "financial", "bank", "insurance", "attorney"],
  "office workers": ["corporate office", "business center", "consultant", "attorney", "legal"],
  professionals: ["consultant", "attorney", "corporate office", "engineer", "architect"],
  "young professionals": ["software", "marketing", "design", "corporate office", "coworking"],
  creatives: ["design", "graphic", "advertising", "photo", "print", "studio", "art"],
  marketing: ["marketing", "advertising", "public relations", "branding"],
  coffee: ["coffee", "cafe", "roaster"],
  foodies: ["restaurant", "cafe", "bakery", "food", "catering"],
  fitness: ["gym", "fitness", "yoga", "pilates", "sports"],
  shoppers: ["store", "shop", "retail", "boutique"],
  commuters: ["parking", "transit", "gas station", "auto"],
  families: ["school", "daycare", "pediatric", "family"],
  students: ["school", "tutoring", "university", "college"],
};

let cache: { businesses: FiberBusiness[] } | null = null;

function loadBusinesses(): FiberBusiness[] {
  if (cache) return cache.businesses;
  const raw = JSON.parse(
    readFileSync(join(dataDir(), "billboard-fiber-businesses.json"), "utf-8")
  ) as { billboards: Record<string, { businesses?: FiberBusiness[] }> };
  const unique = new Map<string, FiberBusiness>();
  for (const rec of Object.values(raw.billboards)) {
    if (!rec || typeof rec !== "object") continue;
    for (const b of rec.businesses ?? []) {
      if (b.placeId && b.latitude && b.longitude && !unique.has(b.placeId)) {
        unique.set(b.placeId, b);
      }
    }
  }
  cache = { businesses: [...unique.values()] };
  return cache.businesses;
}

function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * 111_320;
  const dLng = (bLng - aLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/** Keywords for this campaign: mapped interest tags + significant brief words. */
function icpKeywords(profile: AudienceProfile, briefText: string): string[] {
  const kws = new Set<string>();
  for (const tag of profile.interests) {
    for (const kw of TAG_KEYWORDS[tag.toLowerCase()] ?? []) kws.add(kw);
  }
  // Pull business-type words straight from the brief/audience text too, so
  // e.g. "accounting software for startups" matches accountants directly.
  const text = briefText.toLowerCase();
  for (const [tag, mapped] of Object.entries(TAG_KEYWORDS)) {
    if (text.includes(tag)) for (const kw of mapped) kws.add(kw);
  }
  return [...kws];
}

function matches(b: FiberBusiness, keywords: string[]): boolean {
  const hay = `${b.name} ${(b.allTypes ?? []).join(" ")}`.toLowerCase();
  return keywords.some((kw) => hay.includes(kw));
}

/** Greedy centroid clustering: biggest remaining neighborhood-of-points wins. */
function clusterBlobs(points: FiberBusiness[]): OpportunityBlob[] {
  const remaining = [...points];
  const blobs: OpportunityBlob[] = [];
  while (remaining.length >= MIN_BLOB_COUNT && blobs.length < MAX_BLOBS) {
    // Seed = the point with the most neighbors within the capture radius.
    let bestSeed = -1;
    let bestNeighbors: number[] = [];
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i];
      const neighbors: number[] = [];
      for (let j = 0; j < remaining.length; j++) {
        const p = remaining[j];
        if (metersBetween(s.latitude, s.longitude, p.latitude, p.longitude) <= CLUSTER_RADIUS_M) {
          neighbors.push(j);
        }
      }
      if (neighbors.length > bestNeighbors.length) {
        bestSeed = i;
        bestNeighbors = neighbors;
      }
    }
    if (bestSeed === -1 || bestNeighbors.length < MIN_BLOB_COUNT) break;

    const members = bestNeighbors.map((j) => remaining[j]);
    const lat = members.reduce((s, m) => s + m.latitude, 0) / members.length;
    const lng = members.reduce((s, m) => s + m.longitude, 0) / members.length;
    const spread = Math.max(
      ...members.map((m) => metersBetween(lat, lng, m.latitude, m.longitude))
    );
    blobs.push({
      lat,
      lng,
      radiusM: Math.min(Math.max(spread, 180), CLUSTER_RADIUS_M),
      count: members.length,
      label: dominantTypeLabel(members),
      sampleNames: members.slice(0, 4).map((m) => m.name),
    });
    // Remove clustered members (descending so indexes stay valid).
    for (const j of [...bestNeighbors].sort((a, b) => b - a)) remaining.splice(j, 1);
  }
  return blobs;
}

function dominantTypeLabel(members: FiberBusiness[]): string {
  const counts = new Map<string, number>();
  for (const m of members) {
    for (const t of m.allTypes ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? `${top[0]} cluster` : "Target account cluster";
}

export function computeBlobs(
  profile: AudienceProfile,
  briefText: string,
  boards: Billboard[]
): BlobsResult {
  const businesses = loadBusinesses();
  const keywords = icpKeywords(profile, briefText);
  const matched = businesses.filter((b) => matches(b, keywords));

  const nearbyByBoard: Record<string, number> = {};
  for (const board of boards) {
    nearbyByBoard[board.id] = matched.filter(
      (b) => metersBetween(board.lat, board.lng, b.latitude, b.longitude) <= NEARBY_RADIUS_M
    ).length;
  }

  return {
    blobs: clusterBlobs(matched),
    nearbyByBoard,
    totalMatched: matched.length,
    totalBusinesses: businesses.length,
  };
}
