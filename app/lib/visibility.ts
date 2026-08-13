/**
 * Physical visibility engine (Orangeboard, seller-side): score how visible a
 * GASP board actually is, from real data only — the SF traffic-exposure
 * heatmap (lib/traffic-heatmap.json), the Fiber business enrichment
 * (data/billboard-fiber-businesses.json), and the permit's address text.
 *
 * Pure deterministic geometry/data math — NO LLM calls, so no fallback chain
 * needed. Every output is split into `computed` (measured straight from the
 * datasets) vs `modeled` (heuristic projections), per the "real signals vs
 * projections" product principle, so the UI can label each number honestly.
 * Datasets load lazily from disk and are cached for the process lifetime
 * (same pattern as lib/blobs.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import heatmapData from "./traffic-heatmap.json";
import type { HeatmapData } from "./types";
import { dataDir } from "./paths";
import { getInventoryBoard } from "./inventory";

export interface VisibilityReport {
  recordId: string;
  address: string;
  /**
   * 0-100 blend. Formula (documented so the UI can explain it):
   *   score = clamp( 0.55 * trafficExposure
   *                + 0.30 * businessDensityScore   // min(100, nearbyBusinessCount * 4)
   *                + (intersectionHint ? 10 : 0)
   *                - 0.15 * occlusionRisk , 0, 100)
   * Traffic dominates (it is the only measured exposure signal); business
   * density is a foot-traffic proxy; corner placements earn a fixed bump;
   * the modeled occlusion risk claws back a little in dense canyons.
   */
  visibilityScore: number;
  computed: {
    /** 0-100 from heatmap points within ~350m, distance-weighted (see below). */
    trafficExposure: number;
    /** Raw count of heatmap points within the 350m radius. */
    nearbyHeatPoints: number;
    /**
     * Unique Fiber/Google Places businesses within ~400m of the board,
     * counted across the whole enrichment file. (Each record's own entry only
     * stores its top-3 nearest businesses, so the per-record list carries no
     * density signal — the citywide radius count does.)
     */
    nearbyBusinessCount: number;
    /** Address text contains a cross-street or numbered-street pattern. */
    intersectionHint: boolean;
  };
  modeled: {
    /**
     * 0-100. Heuristic: very high business density ≈ downtown "canyon" blocks
     * where buildings, signage clutter and street trees compete for the same
     * sightline. Risk = clamp((nearbyBusinessCount - 10) * 2.5, 5, 85) — a
     * floor of 5 (something can always block a board), ramping once density
     * passes ~10 businesses in the 400m radius, capped at 85 (it is a
     * projection, never a certainty).
     */
    occlusionRisk: number;
    /** Road-exposure tier: >=60 exposure → large, >=25 → medium, else small. */
    apparentSize: "large" | "medium" | "small";
    /**
     * Pedestrian-scale glance time. Base by exposure tier (busy corridors slow
     * foot traffic): large 12s, medium 8s, small 5s; +6s at intersections
     * (signal-wait dwell).
     */
    dwellSeconds: number;
    /**
     * 0-100 per daypart, derived from exposure + the Fiber business mix:
     * office-type neighbors push morning/midday (commute + lunch), food &
     * nightlife neighbors push evening/night. Each starts from a traffic
     * baseline (0.5 * trafficExposure + 25) and shifts with the mix shares.
     */
    timeOfDayFit: { morning: number; midday: number; evening: number; night: number };
  };
  /** 2-4 human-readable one-liners citing which signals drove the score. */
  notes: string[];
}

/* --- tunables -------------------------------------------------------------- */

const HEAT_RADIUS_M = 350; // heatmap capture radius around the board
// A single max-intensity heat point directly on the board contributes 40pts;
// two or three nearby corridor points saturate the 0-100 scale — matches the
// heatmap's density (304 points citywide, so >2 within 350m means a real
// artery, not noise).
const HEAT_SCALE = 40;
const BUSINESS_RADIUS_M = 400; // "businesses near this board" (~0.25 mi)

interface FiberBusiness {
  placeId?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  allTypes?: string[];
}

let fiberCache: FiberBusiness[] | null = null;

/** All unique Fiber businesses citywide (cached; [] if the file is unusable). */
function fiberBusinesses(): FiberBusiness[] {
  if (fiberCache) return fiberCache;
  const unique = new Map<string, FiberBusiness>();
  try {
    const raw = JSON.parse(
      readFileSync(join(dataDir(), "billboard-fiber-businesses.json"), "utf-8")
    ) as { billboards?: Record<string, { businesses?: FiberBusiness[] }> };
    for (const rec of Object.values(raw.billboards ?? {})) {
      for (const b of rec?.businesses ?? []) {
        if (b.placeId && typeof b.latitude === "number" && typeof b.longitude === "number") {
          if (!unique.has(b.placeId)) unique.set(b.placeId, b);
        }
      }
    }
  } catch {
    // Enrichment missing → business-driven signals read as zero, app moves on.
  }
  fiberCache = [...unique.values()];
  return fiberCache;
}

/** Equirectangular meters approximation (same approach as lib/blobs.ts). */
function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * 111_320;
  const dLng = (bLng - aLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Cross-street / corner detection from the permit address text: explicit
 * separators ("&", "/", "@", " AND ") or SF's numbered streets & avenues
 * ("09TH AVE", "3RD ST"), which overwhelmingly sit on gridded intersections.
 */
function detectIntersectionHint(address: string): boolean {
  const a = address.toUpperCase();
  if (/[&/@]/.test(a) || / AND /.test(a)) return true;
  return /\b\d{1,2}(?:ST|ND|RD|TH)\s+(?:ST|AVE|STREET|AVENUE)\b/.test(a);
}

const OFFICE_KEYWORDS = [
  "office",
  "consultant",
  "attorney",
  "legal",
  "account",
  "financial",
  "insurance",
  "software",
  "marketing",
  "engineer",
  "architect",
  "real estate",
];
const EVENING_KEYWORDS = [
  "restaurant",
  "bar",
  "cafe",
  "coffee",
  "bakery",
  "night_club",
  "food",
  "brewery",
  "gym",
  "fitness",
];

function shareMatching(businesses: FiberBusiness[], keywords: string[]): number {
  if (businesses.length === 0) return 0;
  const hits = businesses.filter((b) => {
    const hay = `${b.name ?? ""} ${(b.allTypes ?? []).join(" ")}`.toLowerCase();
    return keywords.some((kw) => hay.includes(kw));
  }).length;
  return hits / businesses.length;
}

/** Full visibility report for one GASP board; null if the recordId is unknown. */
export function computeVisibility(recordId: string): VisibilityReport | null {
  const board = getInventoryBoard(recordId);
  if (!board) return null;

  /* --- computed: measured straight from the datasets ----------------------- */
  const heat = heatmapData as HeatmapData;
  let heatSum = 0;
  let nearbyHeatPoints = 0;
  for (const [lat, lng, intensity] of heat) {
    const d = metersBetween(board.lat, board.lng, lat, lng);
    if (d <= HEAT_RADIUS_M) {
      nearbyHeatPoints++;
      heatSum += intensity * (1 - d / HEAT_RADIUS_M); // linear distance decay
    }
  }
  const trafficExposure = Math.round(clamp(heatSum * HEAT_SCALE, 0, 100));

  const businesses = fiberBusinesses().filter(
    (b) => metersBetween(board.lat, board.lng, b.latitude!, b.longitude!) <= BUSINESS_RADIUS_M
  );
  const nearbyBusinessCount = businesses.length;
  const intersectionHint = detectIntersectionHint(board.address);

  /* --- modeled: heuristic projections (formulas documented on the type) ---- */
  const occlusionRisk = Math.round(clamp((nearbyBusinessCount - 10) * 2.5, 5, 85));
  const apparentSize: VisibilityReport["modeled"]["apparentSize"] =
    trafficExposure >= 60 ? "large" : trafficExposure >= 25 ? "medium" : "small";
  const dwellSeconds =
    (apparentSize === "large" ? 12 : apparentSize === "medium" ? 8 : 5) +
    (intersectionHint ? 6 : 0);

  const officeShare = shareMatching(businesses, OFFICE_KEYWORDS);
  const eveningShare = shareMatching(businesses, EVENING_KEYWORDS);
  const baseline = 0.5 * trafficExposure + 25;
  const timeOfDayFit = {
    morning: Math.round(clamp(baseline + officeShare * 30, 0, 100)),
    midday: Math.round(clamp(baseline + officeShare * 20 + eveningShare * 15, 0, 100)),
    evening: Math.round(clamp(baseline + eveningShare * 30, 0, 100)),
    night: Math.round(clamp(baseline - 15 + eveningShare * 35, 0, 100)),
  };

  /* --- blended headline score (formula documented on the interface) -------- */
  const businessDensityScore = Math.min(100, nearbyBusinessCount * 4);
  const visibilityScore = Math.round(
    clamp(
      0.55 * trafficExposure +
        0.3 * businessDensityScore +
        (intersectionHint ? 10 : 0) -
        0.15 * occlusionRisk,
      0,
      100
    )
  );

  /* --- notes: cite the signals that actually drove the number -------------- */
  const notes: string[] = [];
  notes.push(
    nearbyHeatPoints > 0
      ? `${nearbyHeatPoints} traffic heat point${nearbyHeatPoints === 1 ? "" : "s"} within ${HEAT_RADIUS_M}m → measured exposure ${trafficExposure}/100.`
      : `No traffic heat points within ${HEAT_RADIUS_M}m — this board sits off the measured high-traffic corridors.`
  );
  notes.push(
    nearbyBusinessCount > 0
      ? `${nearbyBusinessCount} verified businesses within ${BUSINESS_RADIUS_M}m (Fiber/Google Places) — steady foot-traffic base.`
      : `No verified businesses within ${BUSINESS_RADIUS_M}m — foot-traffic signals read as zero here.`
  );
  if (intersectionHint) {
    notes.push(`Address "${board.address}" reads as an intersection — corner boards earn +10 and longer signal-wait dwell.`);
  }
  if (occlusionRisk >= 50) {
    notes.push(`High building/signage density (modeled occlusion ${occlusionRisk}/100) trims the blended score.`);
  }

  return {
    recordId: board.recordId,
    address: board.address,
    visibilityScore,
    computed: { trafficExposure, nearbyHeatPoints, nearbyBusinessCount, intersectionHint },
    modeled: { occlusionRisk, apparentSize, dwellSeconds, timeOfDayFit },
    notes: notes.slice(0, 4),
  };
}
