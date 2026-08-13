/**
 * Agent 1 — The Researcher 🔍 (PRD §5).
 * LLM path: strict-JSON prompt with brief (+ optional image) + Nimble signals.
 * Fallback path: deterministic keyword→tag profile so /api/research never
 * dead-ends, even with wifi off.
 */
import type { ProductBrief, ResearchResponse } from "@/lib/types";
import { chatJson } from "./parse";
import type { ChatMessage } from "./gmi";
import { nimblePromptBlock, nimbleFallbackFinding, NIMBLE_TAG } from "./nimble";

export type ResearcherBlock = ResearchResponse["researcher"];

const SYSTEM = `You are The Researcher, an audience-intelligence agent for out-of-home ad campaigns in San Francisco.
Respond with ONLY a valid JSON object — no prose, no markdown, no code fences. Shape:
{
  "audienceProfile": {
    "ageRange": "25-40",
    "income": "$60k-$120k",
    "interests": ["4-6 tags, lowercase, drawn ONLY from this vocabulary: commuters, tech, office workers, professionals, finance, startups, young professionals, fitness, outdoors, eco-conscious, affluent, creatives, foodies, coffee, nightlife, walkable, latino, families, students, suburban, value-seekers, tourists, shoppers"],
    "mindset": "one short sentence"
  },
  "buyingTriggers": ["exactly 3 short strings"],
  "adToneGuidance": "one paragraph",
  "findings": ["exactly 4 short punchy findings for a typewriter reveal"]
}
Do not use race or other protected traits for targeting decisions.`;

export async function runResearcher(brief: ProductBrief): Promise<ResearcherBlock> {
  const nimble = nimblePromptBlock();
  const userText = [
    `Product: ${brief.productName}`,
    `Description: ${brief.description}`,
    `Stated target audience: ${brief.audience}`,
    nimble,
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM }];
  if (brief.imageBase64) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: brief.imageBase64 } },
      ],
    });
  } else {
    messages.push({ role: "user", content: userText });
  }

  const out = await chatJson<ResearcherBlock>(messages);
  return sanitizeResearcher(out, brief);
}

/** Clamp LLM output to the contract: exactly 3 triggers, exactly 4 findings. */
function sanitizeResearcher(r: ResearcherBlock, brief: ProductBrief): ResearcherBlock {
  const fb = fallbackResearcher(brief);
  const interests = (r.audienceProfile?.interests ?? []).filter((s) => typeof s === "string");
  return {
    audienceProfile: {
      ageRange: r.audienceProfile?.ageRange || fb.audienceProfile.ageRange,
      income: r.audienceProfile?.income || fb.audienceProfile.income,
      interests: interests.length >= 2 ? interests.slice(0, 6) : fb.audienceProfile.interests,
      mindset: r.audienceProfile?.mindset || fb.audienceProfile.mindset,
    },
    buyingTriggers: pad(r.buyingTriggers, 3, fb.buyingTriggers),
    adToneGuidance: r.adToneGuidance || fb.adToneGuidance,
    findings: pad(r.findings, 4, fb.findings),
  };
}

function pad(arr: string[] | undefined, n: number, fill: string[]): string[] {
  const out = (arr ?? []).filter((s) => typeof s === "string" && s.trim()).slice(0, n);
  for (let i = 0; out.length < n; i++) out.push(fill[i % fill.length]);
  return out;
}

/* ---------------------------------------------------------------------------
 * Deterministic fallback — keyword→tag mapping over the shared tag vocabulary
 * (data/README.md) so Jaccard overlaps with board audienceTags still land.
 * ------------------------------------------------------------------------- */

const KEYWORD_TAGS: Array<[RegExp, string[]]> = [
  [/commut|transit|across the city|car-free|car-light/i, ["commuters"]],
  [/eco|planet|sustain|green|electric/i, ["eco-conscious"]],
  [/work out|gym|fitness|athlet|ride|riders/i, ["fitness"]],
  [/bike|outdoor|park|trail/i, ["outdoors"]],
  [/tech|app|software|saas|dashboard|startup|founder/i, ["tech", "startups"]],
  [/finance|accounting|books|runway|spreadsheet/i, ["finance", "professionals"]],
  [/office|operators|team/i, ["office workers"]],
  [/coffee|cafe|roast|espresso|brew/i, ["coffee", "foodies"]],
  [/creative|artist|freelanc|design/i, ["creatives"]],
  [/food|restaurant|dining|beans/i, ["foodies"]],
  [/walk|neighborhood/i, ["walkable"]],
  [/night|late-night|bar/i, ["nightlife"]],
  [/family|families|kids/i, ["families"]],
  [/student|university|campus/i, ["students"]],
  [/luxur|premium|affluent/i, ["affluent"]],
  [/25-40|25 to 40|young professional/i, ["young professionals"]],
  [/tourist|visitor/i, ["tourists"]],
  [/shop|retail/i, ["shoppers"]],
  [/value|budget|afford/i, ["value-seekers"]],
];

export function fallbackResearcher(brief: ProductBrief): ResearcherBlock {
  const text = `${brief.productName} ${brief.description} ${brief.audience}`;
  const interests: string[] = [];
  for (const [re, tags] of KEYWORD_TAGS) {
    if (re.test(text)) {
      for (const t of tags) if (!interests.includes(t)) interests.push(t);
    }
    if (interests.length >= 6) break;
  }
  if (interests.length === 0) interests.push("commuters", "professionals", "walkable");

  const age = text.match(/(\d{2})\s*[-–to]+\s*(\d{2})/);
  const nimbleFinding = nimbleFallbackFinding();
  const findings = [
    `Core audience mapped to ${interests.slice(0, 3).join(", ")}.`,
    `${brief.productName} buyers decide fast — visibility during daily routines wins.`,
    nimbleFinding ?? "High-dwell placements beat raw reach for this category.",
    "Recommending bold, low-word-count creative for drive-by legibility.",
  ];

  return {
    audienceProfile: {
      ageRange: age ? `${age[1]}-${age[2]}` : "25-45",
      income: "$60k-$120k",
      interests: interests.slice(0, 6),
      mindset: `Values ${interests[0] ?? "convenience"}-friendly choices that fit a busy city routine.`,
    },
    buyingTriggers: [
      "Seeing the product in their daily environment",
      "Social proof from people like them",
      "A clear, single-benefit message",
    ],
    adToneGuidance: `Confident, urban, and concise. Speak to ${
      brief.audience || "city dwellers"
    } in plain language, lead with the single strongest benefit of ${
      brief.productName
    }, and keep copy readable at a glance.`,
    findings,
  };
}

export { NIMBLE_TAG };
