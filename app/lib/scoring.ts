/**
 * Media Buyer deterministic scoring (PRD §5, corrected per data/README.md).
 * Rankings are math, not vibes — stable, explainable, resilient to LLM failure.
 *
 * ⚠️ Formula orientation (§7.8 decision): PRD §5's literal formula contradicts
 * the documented meaning of `awarenessWeight` (1 = pure awareness). We adopt
 * the corrected form the data was tuned for (data/README.md):
 *
 *   valueScore = (w·dailyImpressions + (1−w)·targetReach·3) / weeklyCostUsd
 *
 * where w = awarenessWeight, so w=1 → raw impressions per dollar. The frontend
 * passes `awarenessWeight` through unchanged. Flagged in team chat.
 */
import type { Billboard, BoardRanking, CampaignParams } from "@/lib/types";

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a.map((s) => s.toLowerCase().trim()));
  const B = new Set(b.map((s) => s.toLowerCase().trim()));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

export function valueScore(board: Billboard, demoMatch: number, w: number): number {
  const targetReach = board.dailyImpressions * demoMatch;
  return (w * board.dailyImpressions + (1 - w) * targetReach * 3) / board.weeklyCostUsd;
}

export interface ScoredBoards {
  /** ALL boards, sorted by valueScore desc, `reason` left empty for the LLM. */
  rankings: BoardRanking[];
  /** First 3 board ids where inBudget === true. */
  top3: string[];
}

export function scoreBoards(
  boards: Billboard[],
  interests: string[],
  campaign: CampaignParams
): ScoredBoards {
  const w = Math.min(1, Math.max(0, campaign.awarenessWeight));
  const rankings: BoardRanking[] = boards
    .map((b) => {
      const demoMatch = jaccard(interests, b.audienceTags);
      return {
        id: b.id,
        score: +valueScore(b, demoMatch, w).toFixed(2),
        demoMatch: +demoMatch.toFixed(2),
        reason: "",
        inBudget: b.weeklyCostUsd <= campaign.weeklyBudgetUsd,
      };
    })
    .sort((a, b) => b.score - a.score);
  const top3 = rankings.filter((r) => r.inBudget).slice(0, 3).map((r) => r.id);
  return { rankings, top3 };
}

/**
 * Canned reason template for the deterministic fallback path:
 * "Strong match on {top-3 overlapping tags}."
 */
export function cannedReason(board: Billboard, interests: string[]): string {
  const set = new Set(interests.map((s) => s.toLowerCase().trim()));
  const overlap = board.audienceTags.filter((t) => set.has(t.toLowerCase())).slice(0, 3);
  if (overlap.length === 0) {
    return `High-visibility ${board.trafficType} location in ${board.neighborhood}.`;
  }
  return `Strong match on ${overlap.join(", ")}.`;
}
