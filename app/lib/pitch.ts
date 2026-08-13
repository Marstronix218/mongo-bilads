/**
 * Orangeboard outbound pitch writer — seller → advertiser email draft.
 *
 * The billboard OWNER pitches a nearby business on renting this board: where
 * the board is, why THIS advertiser fits (cluster context from the advertiser
 * engine), one visibility proof point, and a CTA to see the creative mockup.
 *
 * Failure chain (app never dead-ends):
 *   1. one chatJson() call → { subjectLine, pitch } (source: "llm")
 *   2. any failure (no key, timeout, bad JSON) → deterministic template
 *      built from the same inputs (source: "fallback")
 *
 * Honesty rule: visibility/cluster claims come in as pre-computed summaries;
 * the model is told to hedge anything modeled and never invent numbers.
 */
import { boardContext } from "./advertisers";
import { chatJson } from "./parse";

export interface PitchResult {
  subjectLine: string;
  pitch: string;
  source: "llm" | "fallback";
}

export interface PitchInput {
  recordId: string;
  advertiserName: string;
  category: string;
  visibilitySummary?: string;
  clusterSummary?: string;
}

const SYSTEM = `You write outbound emails FROM a billboard owner TO a local business, pitching them on advertising on the owner's billboard.
Respond with ONLY a valid JSON object — no prose, no markdown, no code fences. Shape:
{ "subjectLine": "short, specific, no clickbait", "pitch": "email body, max 150 words" }
Rules:
- Body must cover: where the board is, why THIS business specifically fits (use the nearby-business cluster context), one visibility proof point, and a CTA to view the creative mockup we made for them.
- Honest tone: cite only the numbers provided. If a figure is an estimate/model, hedge it ("our modeled estimate", "roughly"). Never invent statistics, prices, or guarantees.
- Warm, direct, zero marketing fluff. No placeholder brackets — write it ready to send.`;

const MAX_PITCH_WORDS = 170; // model is asked for <=150; clamp defensively

export async function draftPitch(input: PitchInput): Promise<PitchResult> {
  const ctx = boardContext(input.recordId);
  const location = ctx?.address ?? "a high-visibility San Francisco corner";

  try {
    const out = await chatJson<{ subjectLine?: string; pitch?: string }>([
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          `Board: permit ${input.recordId}, located at ${location}.`,
          `Target advertiser: ${input.advertiserName} (${input.category}).`,
          input.clusterSummary ? `Nearby cluster context: ${input.clusterSummary}` : "",
          input.visibilitySummary
            ? `Visibility proof point: ${input.visibilitySummary}`
            : "Visibility proof point: the board sits on a mapped high-exposure SF traffic corridor (modeled from city traffic data).",
          "Sign off as 'The Voyagent team'.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ]);

    const subjectLine = String(out?.subjectLine ?? "").trim();
    const pitch = clampWords(String(out?.pitch ?? "").trim(), MAX_PITCH_WORDS);
    if (!subjectLine || !pitch) throw new Error("pitch LLM returned empty fields");
    return { subjectLine, pitch, source: "llm" };
  } catch {
    return fallbackPitch(input, location);
  }
}

function fallbackPitch(input: PitchInput, location: string): PitchResult {
  const cluster = input.clusterSummary
    ? ` The block around it: ${input.clusterSummary.replace(/\.\s*$/, "")}.`
    : "";
  const visibility =
    input.visibilitySummary ??
    "it sits on a high-exposure corridor in our modeled SF traffic data";
  return {
    subjectLine: `A billboard around the corner from ${input.advertiserName}`,
    pitch:
      `Hi ${input.advertiserName} team,\n\n` +
      `We own the billboard at ${location} — a short walk from your door.${cluster} ` +
      `As a ${input.category.toLowerCase()} business, your customers already pass this board every day: ${visibility}. ` +
      `We put together a creative mockup showing your name on the board so you can see exactly how it would look. ` +
      `Want a link? Reply and we'll send it over, along with straightforward pricing.\n\n` +
      `— The Voyagent team`,
    source: "fallback",
  };
}

function clampWords(s: string, n: number): string {
  const words = s.split(/\s+/).filter(Boolean);
  return words.length <= n ? s : words.slice(0, n).join(" ") + "…";
}
