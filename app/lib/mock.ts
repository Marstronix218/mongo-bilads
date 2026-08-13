/**
 * Phase-1 mock for /api/research (?mock=1) — contract-exact ResearchResponse.
 * Built from the deterministic pipeline with the Volt sample pinned, so board
 * ids, scores, and shapes always agree with data/billboards.json and types.ts
 * while staying 100% LLM-free and stable across calls.
 */
import type { CampaignParams, ProductBrief, ResearchResponse } from "@/lib/types";
import { loadBoards } from "./boards";
import { fallbackResearcher } from "./researcher";
import { scoreBoards, cannedReason } from "./scoring";

const MOCK_BRIEF: ProductBrief = {
  productName: "Volt",
  description:
    "A premium electric commuter bike for getting across the city without a car. Long range, app-unlock, and a lightweight frame built for daily riders who care about the planet and hate parking.",
  audience:
    "Car-free and car-light San Franciscans, 25-40, who commute, work out, and want an eco-friendly way to move around the city.",
};

const MOCK_CAMPAIGN: CampaignParams = {
  weeklyBudgetUsd: 3000,
  campaignWeeks: 4,
  awarenessWeight: 0.7,
};

export function buildMockResearchResponse(): ResearchResponse {
  const boards = loadBoards();
  const researcher = fallbackResearcher(MOCK_BRIEF);
  const { rankings, top3 } = scoreBoards(
    boards,
    researcher.audienceProfile.interests,
    MOCK_CAMPAIGN
  );
  const byId = new Map(boards.map((b) => [b.id, b]));
  for (const r of rankings) r.reason = cannedReason(byId.get(r.id)!, researcher.audienceProfile.interests);

  return {
    researcher,
    mediaBuyer: {
      rankings,
      top3,
      findings: [
        `Scored all ${rankings.length} boards on audience match and impressions per dollar.`,
        "US-101 @ Vermont leads on commuter impressions per dollar.",
        `${rankings.filter((r) => r.inBudget).length} of ${rankings.length} boards fit the $${MOCK_CAMPAIGN.weeklyBudgetUsd} weekly budget.`,
        "Awareness-weighted plan favors raw impressions per dollar.",
      ],
    },
  };
}
