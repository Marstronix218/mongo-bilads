/**
 * Nimble — live market & location intelligence (SPONSORS.md §1).
 *
 * Reads Godson's per-board signal files (data/nimble-signals/<boardId>.json,
 * typed as NimbleSignal in types.ts §G — derived from real Google Places
 * nearby-business data; the live Nimble pipeline augments them).
 *
 * The Researcher consumes these so market intelligence demonstrably influences
 * `audienceProfile.interests` and `findings`. Nimble-sourced findings carry
 * the "[Nimble] " prefix — the frontend strips it and shows a "Source: Nimble"
 * badge.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { NimbleSignal } from "@/lib/types";
import { dataDir } from "./paths";

export const NIMBLE_TAG = "[Nimble] ";

let cached: Map<string, NimbleSignal> | null = null;

function signalsDir(): string {
  return join(dataDir(), "nimble-signals");
}

export function loadNimbleSignals(): Map<string, NimbleSignal> {
  if (cached) return cached;
  cached = new Map();
  try {
    for (const file of readdirSync(signalsDir())) {
      if (!file.endsWith(".json") || file === "index.json") continue;
      try {
        const sig = JSON.parse(readFileSync(join(signalsDir(), file), "utf8")) as NimbleSignal;
        if (sig.boardId && Array.isArray(sig.signals)) cached.set(sig.boardId, sig);
      } catch {
        // one bad file never blocks the rest
      }
    }
  } catch {
    // signals are enrichment, never a hard dependency
  }
  return cached;
}

export function nimbleForBoard(boardId: string): NimbleSignal | null {
  return loadNimbleSignals().get(boardId) ?? null;
}

/** Compact block injected into the Researcher prompt. */
export function nimblePromptBlock(): string {
  const signals = loadNimbleSignals();
  if (signals.size === 0) return "";
  const lines: string[] = [
    "LIVE MARKET INTELLIGENCE (Nimble — nearby businesses, retail density, transit, events, competitors):",
  ];
  for (const sig of signals.values()) {
    lines.push(`- ${sig.boardId} (${sig.location}): ${sig.signals.join("; ")}`);
  }
  lines.push(
    "Let these signals influence audienceProfile.interests and findings. " +
      `Prefix any finding derived from this intelligence with "${NIMBLE_TAG.trim()} ".`
  );
  return lines.join("\n");
}

/** One deterministic Nimble finding for the fallback Researcher path. */
export function nimbleFallbackFinding(): string | null {
  const signals = [...loadNimbleSignals().values()];
  if (signals.length === 0) return null;
  // Highest-confidence board's lead signal — real Places-derived intelligence.
  const best = signals.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  // Prefer a live web-search signal when the enrichment pipeline has run
  // (scripts/nimble-live-enrich.mjs) — fresher and more demo-worthy. The
  // "Live web (…):" prefix is dropped; the [Nimble] tag already marks source.
  const live = best.signals
    .find((s) => s.startsWith("Live web"))
    ?.replace(/^Live web[^:]*:\s*/, "");
  const text = live ?? best.signals[0];
  return `${NIMBLE_TAG}${best.location}: ${text.length > 140 ? text.slice(0, 139).trimEnd() + "…" : text}`;
}
