/**
 * Agent 2 — The Media Buyer 📍 (PRD §5).
 * Deterministic scoring math FIRST (lib/scoring.ts) — the LLM's only job is
 * per-board `reason` strings (≤15 words) and 4 `findings`. If the LLM fails,
 * canned reason templates fill in and the rankings still ship.
 */
import type { Billboard, CampaignParams, ResearchResponse } from "@/lib/types";
import type { ResearcherBlock } from "./researcher";
import { scoreBoards, cannedReason } from "./scoring";
import { chatJson } from "./parse";

export type MediaBuyerBlock = ResearchResponse["mediaBuyer"];

interface ReasonsLlmOut {
  reasons: Record<string, string>;
  findings: string[];
}

const SYSTEM = `You are The Media Buyer, an out-of-home media planning agent.
Respond with ONLY a valid JSON object — no prose, no markdown, no code fences. Shape:
{
  "reasons": { "<board-id>": "why this board fits, max 15 words", ... one entry per board given },
  "findings": ["exactly 4 short punchy findings about the media plan"]
}
The rankings are already computed deterministically — do NOT re-rank. Your reasons must be
consistent with each board's demoMatch and rank as given.`;

export async function runMediaBuyer(
  boards: Billboard[],
  researcher: ResearcherBlock,
  campaign: CampaignParams
): Promise<MediaBuyerBlock> {
  // 1) Math decides the rank (never LLM-dependent).
  const { rankings, top3 } = scoreBoards(boards, researcher.audienceProfile.interests, campaign);
  const byId = new Map(boards.map((b) => [b.id, b]));

  // 2) LLM writes the explanation; fall back to canned templates on any failure.
  let reasons: Record<string, string> = {};
  let findings: string[] | null = null;
  try {
    const ranked = rankings.map((r, i) => {
      const b = byId.get(r.id)!;
      return `#${i + 1} ${r.id} — ${b.name} (${b.neighborhood}); demoMatch ${r.demoMatch}; $${b.weeklyCostUsd}/wk; ${b.dailyImpressions} daily impressions; tags: ${b.audienceTags.join(", ")}; ${r.inBudget ? "in budget" : "over budget"}`;
    });
    const out = await chatJson<ReasonsLlmOut>([
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          `Audience interests: ${researcher.audienceProfile.interests.join(", ")}\n` +
          `Mindset: ${researcher.audienceProfile.mindset}\n` +
          `Weekly budget: $${campaign.weeklyBudgetUsd}; awarenessWeight: ${campaign.awarenessWeight}\n\n` +
          `Ranked boards:\n${ranked.join("\n")}`,
      },
    ]);
    if (out && typeof out.reasons === "object") reasons = out.reasons;
    if (Array.isArray(out?.findings)) findings = out.findings;
  } catch {
    // deterministic fallback below
  }

  const interests = researcher.audienceProfile.interests;
  for (const r of rankings) {
    const llmReason = reasons[r.id];
    r.reason =
      typeof llmReason === "string" && llmReason.trim()
        ? clampWords(llmReason.trim(), 15)
        : cannedReason(byId.get(r.id)!, interests);
  }

  return {
    rankings,
    top3,
    findings: normalizeFindings(findings, rankings, byId, campaign),
  };
}

function clampWords(s: string, n: number): string {
  const words = s.split(/\s+/);
  return words.length <= n ? s : words.slice(0, n).join(" ");
}

function normalizeFindings(
  findings: string[] | null,
  rankings: MediaBuyerBlock["rankings"],
  byId: Map<string, Billboard>,
  campaign: CampaignParams
): string[] {
  const good = (findings ?? []).filter((s) => typeof s === "string" && s.trim()).slice(0, 4);
  if (good.length === 4) return good;
  const inBudget = rankings.filter((r) => r.inBudget);
  const top = inBudget[0] ? byId.get(inBudget[0].id) : undefined;
  const canned = [
    `Scored all ${rankings.length} boards on audience match and impressions per dollar.`,
    top
      ? `${top.name} leads: ${inBudget[0].demoMatch >= 0.2 ? "strong" : "broad"} audience fit at $${top.weeklyCostUsd}/week.`
      : `No boards fit the $${campaign.weeklyBudgetUsd} weekly budget — raise it to unlock options.`,
    `${inBudget.length} of ${rankings.length} boards fit the $${campaign.weeklyBudgetUsd} weekly budget.`,
    campaign.awarenessWeight >= 0.5
      ? "Awareness-weighted plan favors raw impressions per dollar."
      : "Targeted plan favors boards where your exact audience concentrates.",
  ];
  for (const c of canned) {
    if (good.length < 4) good.push(c);
  }
  return good.slice(0, 4);
}
