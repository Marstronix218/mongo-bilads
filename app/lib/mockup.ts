/**
 * Orangeboard creative mockup — "here's your name on our board" for an
 * arbitrary GASP permit board + nearby advertiser.
 *
 * Failure chain (app never dead-ends):
 *   1. one chatJson() call → headline (≤7 words) + subline + a text-free
 *      imagePrompt, then image() via generateAdImage (which writes the PNG to
 *      public/generated/ under a deterministic hash filename and reuses it on
 *      disk if it already exists; on image failure it returns placeholderUrl).
 *   2. any copy-LLM failure → canned copy + placeholderUrl (source: "fallback").
 *
 * Content safety, same as lib/creative.ts: the image prompt describes only the
 * visual scene — copy is an HTML overlay, so no text/logos/claims in the art.
 */
import { createHash } from "node:crypto";
import { generateAdImage, placeholderUrl } from "./images";
import { chatJson } from "./parse";

export interface MockupInput {
  recordId: string;
  advertiserName: string;
  category: string;
  address: string;
}

export interface MockupResult {
  headline: string;
  subline: string;
  imageUrl: string;
  source: "llm" | "fallback";
}

const SYSTEM = `You are a billboard creative director writing ONE concept for a local business's first billboard.
Respond with ONLY a valid JSON object — no prose, no markdown, no code fences. Shape:
{
  "headline": "max 7 words",
  "subline": "max 10 words",
  "imagePrompt": "visual scene description for an image model"
}
Rules:
- imagePrompt describes ONLY the visual scene: no text overlay, no words, no lettering, no logos, no prices, no claims. Copy is overlaid separately as HTML.
- Never invent product claims or offers — celebrate the business and its neighborhood instead.
- Design for a 3-second drive-by read: bold, minimal, high contrast.`;

export async function generateMockup(input: MockupInput): Promise<MockupResult> {
  // Deterministic filename: same board + advertiser always reuses one PNG.
  const hash = createHash("sha1")
    .update(`${input.recordId}::${input.advertiserName}`)
    .digest("hex")
    .slice(0, 12);
  const cacheKey = `orangeboard-${hash}`;

  try {
    const copy = await chatJson<{ headline?: string; subline?: string; imagePrompt?: string }>([
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          `Business: ${input.advertiserName} — a ${input.category} business in San Francisco.`,
          `Billboard location: ${input.address} (the business is just around the corner).`,
          `The concept should feel unmistakably local to that street and flattering to the business.`,
        ].join("\n"),
      },
    ]);

    const headline =
      clampWords(String(copy?.headline ?? "").trim(), 7) || cannedHeadline(input);
    const subline =
      clampWords(String(copy?.subline ?? "").trim(), 10) || CANNED_SUBLINE;
    const scene =
      String(copy?.imagePrompt ?? "").trim() ||
      `Vibrant storefront scene evoking a beloved local ${input.category} business on a San Francisco street.`;

    // generateAdImage reuses the on-disk PNG if it exists, and returns the
    // branded placeholder URL on any image-gen failure — never a broken image.
    const generated = await generateAdImage(
      safePrompt(scene, input),
      cacheKey,
      0,
      input.advertiserName
    );
    return { headline, subline, imageUrl: generated.imageUrl, source: "llm" };
  } catch {
    return {
      headline: cannedHeadline(input),
      subline: CANNED_SUBLINE,
      imageUrl: placeholderUrl(input.advertiserName),
      source: "fallback",
    };
  }
}

/** Safety suffix mirroring lib/creative.ts safeImagePrompt for GASP boards. */
function safePrompt(scene: string, input: MockupInput): string {
  return (
    `${scene} Wide billboard composition set near ${input.address}, San Francisco, ` +
    `styled for a local ${input.category} business. Photorealistic advertising style, ` +
    `bold, minimal, high contrast, readable in 3 seconds. ` +
    `No text overlay, no words, no lettering, no logos, no prices, no claims.`
  );
}

function cannedHeadline(input: MockupInput): string {
  return clampWords(`${input.advertiserName}. Right around the corner.`, 7);
}

const CANNED_SUBLINE = "Your neighborhood already knows the way.";

function clampWords(s: string, n: number): string {
  const words = s.split(/\s+/).filter(Boolean);
  return words.slice(0, n).join(" ");
}
