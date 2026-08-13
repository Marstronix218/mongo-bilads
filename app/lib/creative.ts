/**
 * Agent 3 — The Creative Director 🎨 (PRD §5).
 * One LLM call → 2 concepts; language rule from board.spanishFriendly.
 * Deterministic fallback order: hand-written seed copy from
 * data/creative-seed/<billboardId>.<sampleId>.json (Godson's pre-written
 * EN/ES pairs, e.g. the Mission bilingual demo moment), then canned templates.
 *
 * Content safety: image prompts never contain text/logos/claims — copy is an
 * HTML overlay added by the frontend, and only approved claims from the brief
 * are ever used.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AdConcept, Billboard, GenerateRequest } from "@/lib/types";
import { SAMPLES } from "@/lib/samples";
import { chatJson } from "./parse";
import { dataDir } from "./paths";

/** Concept before the image is generated. */
export type ConceptDraft = Omit<AdConcept, "imageUrl"> & { imagePrompt: string };

const SYSTEM = `You are The Creative Director, a billboard creative agent.
Respond with ONLY a valid JSON object — no prose, no markdown, no code fences. Shape:
{
  "concepts": [
    {
      "id": "concept-0",
      "language": "en" | "es",
      "headline": "max 7 words",
      "subline": "max 10 words",
      "imagePrompt": "visual scene description for an image model",
      "rationale": "max 15 words — why this concept for this board"
    },
    { ...concept-1 }
  ]
}
Rules:
- Exactly 2 concepts.
- imagePrompt describes ONLY the visual scene: no text overlay, no words, no logos, no prices, no claims. Copy is overlaid separately as HTML.
- Never invent product claims — use only what the brief states.`;

export async function runCreativeDirector(
  body: GenerateRequest,
  board: Billboard
): Promise<ConceptDraft[]> {
  const variant = body.variant ?? 0;
  const langRule = board.spanishFriendly
    ? "This board is in a Spanish-friendly neighborhood: concept-0 in English, concept-1 in Spanish (a native-quality Spanish angle, not a translation)."
    : "Both concepts in English, with two distinct creative angles.";
  const brandRule = body.consistentBrand
    ? "Keep visual identity consistent across neighborhoods: fixed tone, similar palette."
    : "Tailor the visual identity to this neighborhood.";
  const variantRule =
    variant > 0
      ? `This is concept set #${variant + 1} — use a different visual metaphor and color palette than previous sets.`
      : "";

  const out = await chatJson<{ concepts: ConceptDraft[] }>([
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: [
        `Product: ${body.brief.productName} — ${body.brief.description}`,
        `Audience profile: ${body.audienceProfile.ageRange}, ${body.audienceProfile.income}; interests: ${body.audienceProfile.interests.join(", ")}; mindset: ${body.audienceProfile.mindset}`,
        `Board: ${board.name} in ${board.neighborhood}; traffic: ${board.trafficType}; avg dwell ${board.avgDwellSeconds}s; local tags: ${board.audienceTags.join(", ")}`,
        langRule,
        brandRule,
        variantRule,
        `Design for a ${board.trafficType === "vehicle" ? "3-second drive-by read" : "walk-by read"} — bold, minimal, high contrast.`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ]);

  const concepts = (out?.concepts ?? []).slice(0, 2);
  if (concepts.length !== 2) throw new Error("Creative Director did not return 2 concepts");
  return concepts.map((c, i) => sanitizeConcept(c, i, board));
}

function sanitizeConcept(c: ConceptDraft, i: number, board: Billboard): ConceptDraft {
  const wantEs = board.spanishFriendly && i === 1;
  return {
    id: `concept-${i}`,
    language: c.language === "es" || wantEs ? "es" : "en",
    headline: clampWords(String(c.headline ?? ""), 7) || `Made for ${board.neighborhood}.`,
    subline: clampWords(String(c.subline ?? ""), 10),
    imagePrompt: String(c.imagePrompt ?? "").trim(),
    rationale: clampWords(String(c.rationale ?? ""), 15),
  };
}

function clampWords(s: string, n: number): string {
  const words = s.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, n).join(" ");
}

/** Safety suffix appended to every image prompt before generation. */
export function safeImagePrompt(imagePrompt: string, board: Billboard): string {
  return (
    `${imagePrompt} Wide billboard composition set in ${board.neighborhood}, San Francisco. ` +
    `Photorealistic advertising style, bold, minimal, high contrast, readable in 3 seconds. ` +
    `No text overlay, no words, no lettering, no logos, no prices, no claims.`
  );
}

/* ---------------------------------------------------------------------------
 * Deterministic fallbacks (PRD §5): seed copy first, canned templates second.
 * ------------------------------------------------------------------------- */

interface CreativeSeedFile {
  billboardId: string;
  sampleId: string;
  concepts: Array<ConceptDraft & { imageUrl?: string }>;
}

/** Map a brief's productName back to its sample id ("Volt" -> "volt"). */
function sampleIdForProduct(productName: string): string | null {
  const hit = SAMPLES.find(
    (s) => s.brief.productName.toLowerCase() === productName.toLowerCase().trim()
  );
  return hit?.id ?? null;
}

/** Godson's pre-written EN/ES copy, e.g. data/creative-seed/sf-mission-24th.volt.json. */
export function loadCreativeSeed(billboardId: string, productName: string): ConceptDraft[] | null {
  const sampleId = sampleIdForProduct(productName);
  if (!sampleId) return null;
  try {
    const file = join(dataDir(), "creative-seed", `${billboardId}.${sampleId}.json`);
    const seed = JSON.parse(readFileSync(file, "utf8")) as CreativeSeedFile;
    if (!Array.isArray(seed.concepts) || seed.concepts.length < 2) return null;
    return seed.concepts.slice(0, 2).map(({ imageUrl: _drop, ...draft }) => draft);
  } catch {
    return null;
  }
}

export function fallbackConcepts(args: {
  productName: string;
  board: Billboard;
}): ConceptDraft[] {
  const { productName, board } = args;
  const seeded = loadCreativeSeed(board.id, productName);
  if (seeded) return seeded;

  const en: ConceptDraft = {
    id: "concept-0",
    language: "en",
    headline: `${productName}. Made for ${board.neighborhood}.`,
    subline: "Your city. Your move.",
    imagePrompt: `Hero product shot of ${productName} against a stylized ${board.neighborhood} San Francisco backdrop at golden hour.`,
    rationale: `Direct neighborhood callout builds instant local relevance on ${board.trafficType} traffic.`,
  };
  const second: ConceptDraft = board.spanishFriendly
    ? {
        id: "concept-1",
        language: "es",
        headline: `${productName}. Hecho para tu ciudad.`,
        subline: "Tu barrio. Tu momento.",
        imagePrompt: `Vibrant lifestyle scene featuring ${productName} on a lively ${board.neighborhood} street, warm colors, community feel.`,
        rationale: "Spanish-first creative matches the neighborhood's bilingual daily life.",
      }
    : {
        id: "concept-1",
        language: "en",
        headline: `Meet ${productName}.`,
        subline: "The smarter way to choose.",
        imagePrompt: `Minimal studio composition of ${productName} with bold geometric shapes and generous negative space.`,
        rationale: "Minimal second angle contrasts the lifestyle concept for A/B comparison.",
      };
  return [en, second];
}
