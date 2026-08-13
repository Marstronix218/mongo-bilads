/**
 * Location signals — per-board market intelligence.
 *
 * Reads the committed per-board signal files (data/signals/<boardId>.json,
 * typed as LocationSignal in types.ts §G — derived from real Google Places
 * nearby-business data).
 *
 * The Researcher consumes these so market intelligence demonstrably influences
 * `audienceProfile.interests` and `findings`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { LocationSignal } from "@/lib/types";
import { dataDir } from "./paths";

let cached: Map<string, LocationSignal> | null = null;

function signalsDir(): string {
  return join(dataDir(), "signals");
}

export function loadLocationSignals(): Map<string, LocationSignal> {
  if (cached) return cached;
  cached = new Map();
  try {
    for (const file of readdirSync(signalsDir())) {
      if (!file.endsWith(".json") || file === "index.json") continue;
      try {
        const sig = JSON.parse(readFileSync(join(signalsDir(), file), "utf8")) as LocationSignal;
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

export function signalForBoard(boardId: string): LocationSignal | null {
  return loadLocationSignals().get(boardId) ?? null;
}

/** Compact block injected into the Researcher prompt. */
export function signalsPromptBlock(): string {
  const signals = loadLocationSignals();
  if (signals.size === 0) return "";
  const lines: string[] = [
    "LOCATION SIGNALS (nearby businesses, retail density, transit, events, competitors):",
  ];
  for (const sig of signals.values()) {
    lines.push(`- ${sig.boardId} (${sig.location}): ${sig.signals.join("; ")}`);
  }
  lines.push("Let these signals influence audienceProfile.interests and findings.");
  return lines.join("\n");
}

/** One deterministic location finding for the fallback Researcher path. */
export function signalsFallbackFinding(): string | null {
  const signals = [...loadLocationSignals().values()];
  if (signals.length === 0) return null;
  // Highest-confidence board's lead signal — real Places-derived intelligence.
  const best = signals.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  // Prefer a live web-search signal when present — fresher and more demo-worthy.
  const live = best.signals
    .find((s) => s.startsWith("Live web"))
    ?.replace(/^Live web[^:]*:\s*/, "");
  const text = live ?? best.signals[0];
  return `${best.location}: ${text.length > 140 ? text.slice(0, 139).trimEnd() + "…" : text}`;
}
