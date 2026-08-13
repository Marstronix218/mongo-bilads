/**
 * Orangeboard /map — local type contracts.
 *
 * The API shapes below (visibility / advertisers / pitch / mockup) are
 * DELIBERATELY duplicated here instead of imported from @/lib/* — those lib
 * files are being written concurrently by other agents, and a type-only copy
 * decouples this route from their landing order. If a server contract drifts,
 * the fetch helpers in Dossier.tsx degrade to inline error text instead of
 * crashing the panel — the app never dead-ends.
 */
import type { CSSProperties } from "react";

/** A billboard selected on the map, parsed from sf-billboards.geojson props. */
export interface BoardSel {
  recordId: string;
  address: string;
  lat: number;
  lng: number;
  recordStatus: string;
  recordStatusDate: string | null;
  dateOpened: string | null;
  dateClosed: string | null;
  plannerName: string | null;
  plannerEmail: string | null;
  acalink: string | null;
}

// ─── /api/visibility ────────────────────────────────────────────────────────

export interface VisibilityResponse {
  recordId: string;
  address: string;
  visibilityScore: number;
  /** Real signals derived from data on disk — labeled COMPUTED in the UI. */
  computed: {
    trafficExposure: number;
    nearbyHeatPoints: number;
    nearbyBusinessCount: number;
    intersectionHint: string;
  };
  /** Estimates/projections — labeled MODELED in the UI. */
  modeled: {
    occlusionRisk: number;
    apparentSize: number;
    dwellSeconds: number;
    timeOfDayFit: {
      morning: number;
      midday: number;
      evening: number;
      night: number;
    };
  };
  notes: string[];
}

// ─── /api/advertisers ───────────────────────────────────────────────────────

export interface AdvertiserEnrichment {
  industry: string;
  headcountBand: string;
  signals: string[];
  source: string;
}

export interface AdvertiserRow {
  name: string;
  category: string;
  fitScore: number;
  rationale: string;
  distanceM: number;
  enrichment?: AdvertiserEnrichment;
}

export interface AdvertisersResponse {
  recordId: string;
  mode: string;
  clusters: { category: string; count: number; sample: string }[];
  advertisers: AdvertiserRow[];
  totalNearby: number;
}

// ─── /api/pitch ─────────────────────────────────────────────────────────────

export interface PitchResponse {
  subjectLine: string;
  pitch: string;
  source: string;
}

// ─── /api/mockup ────────────────────────────────────────────────────────────

export interface MockupResponse {
  headline: string;
  subline: string;
  imageUrl: string;
  source: string;
}

// ─── Cockpit / queue ────────────────────────────────────────────────────────

export type CockpitMode = "INVENTORY" | "VISIBILITY" | "ADVERTISERS" | "QUEUE";

/** One row of the Orange Slice outbound queue (persisted in localStorage). */
export interface QueueItem {
  recordId: string;
  address: string;
  advertiserName: string;
  category: string;
  fitScore: number;
  visibilityScore?: number;
  pitchSubject?: string;
}

/** Tiny async-state wrapper so every panel fetch renders spinner/error/data. */
export type Async<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "done"; data: T };

/** Normalize a score that may arrive as 0..1 or 0..100 into a 0..100 int. */
export function pct(v: number | undefined | null): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.round(Math.max(0, Math.min(100, n <= 1 ? n * 100 : n)));
}

/** POST JSON, throw on non-2xx — callers catch and render inline errors. */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Shared monospace micro-label style for the Voyagent console voice. */
export const MONO_LABEL: CSSProperties = {
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", monospace',
  fontSize: "8.5px",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
};

export const ORANGE = "#F5D400";
export const INACTIVE = "#737373";
