/**
 * GMI Cloud client (OpenAI-compatible API — one integration for LLM + image).
 *
 * Every call is wrapped in a 20s timeout (PRD §10 fallback spec). When
 * GMI_API_KEY is missing or the network is down, calls reject fast and the
 * endpoints fall back deterministically — the app never dead-ends.
 */
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const GMI_BASE_URL = process.env.GMI_BASE_URL ?? "https://api.gmi-serving.com/v1";
// Media (image gen) lives on a separate async request-queue API, not the
// OpenAI-compatible serving cluster — confirmed by Godson against live GMI.
const GMI_MEDIA_URL =
  process.env.GMI_MEDIA_URL ??
  "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests";
// Model IDs confirmed by Godson against the live API (2026-07-13):
//   chat  google/gemini-3.5-flash — ~2.6s, strict JSON clean, vision-capable
//   image gemini-3.1-flash-image  — ~17s, PNG via request queue, 16:9 only
export const CHAT_MODEL = process.env.GMI_CHAT_MODEL ?? "google/gemini-3.5-flash";
export const IMAGE_MODEL = process.env.GMI_IMAGE_MODEL ?? "gemini-3.1-flash-image";

export const GMI_TIMEOUT_MS = 20_000;
// Image gen runs ~17s on GMI's queue — 20s leaves no headroom, so images get
// their own budget. /api/generate still falls back to placeholders on expiry.
export const GMI_IMAGE_TIMEOUT_MS = 45_000;

export class GmiUnavailableError extends Error {}

let client: OpenAI | null = null;

export function gmi(): OpenAI {
  const apiKey = process.env.GMI_API_KEY;
  if (!apiKey) throw new GmiUnavailableError("GMI_API_KEY not set");
  if (!client) {
    client = new OpenAI({ apiKey, baseURL: GMI_BASE_URL, maxRetries: 0 });
  }
  return client;
}

export function withTimeout<T>(p: Promise<T>, ms = GMI_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new GmiUnavailableError(`GMI call timed out after ${ms}ms`)), ms);
    }),
  ]);
}

export type ChatMessage = ChatCompletionMessageParam;

/** One chat completion; returns the assistant text. Times out after 20s. */
export async function chat(messages: ChatMessage[], model: string = CHAT_MODEL): Promise<string> {
  const res = await withTimeout(
    gmi().chat.completions.create({ model, messages, temperature: 0.7 })
  );
  const text = res.choices[0]?.message?.content;
  if (!text) throw new Error("GMI chat returned empty content");
  return text;
}

/** Gemini-style media response from GMI's request queue. */
interface MediaQueueResponse {
  status?: string;
  error?: string;
  outcome?: {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          inlineData?: { mimeType?: string; data?: string };
          inline_data?: { mime_type?: string; data?: string };
        }>;
      };
    }>;
  };
}

/**
 * One image generation; returns raw PNG bytes. Times out after 45s.
 *
 * NOTE: GMI serves image models on the console request-queue API, NOT the
 * OpenAI-compatible cluster (/images/generations 404s: "No matching target
 * server"). The queue responds synchronously (~17s) with a Gemini-style
 * candidates/parts payload. Aspect ratio must be one of Gemini's supported
 * set — "2:1" is rejected, so we use 16:9 (closest to the PRD's 1024x512
 * wide-billboard ratio; the composite warp absorbs the difference).
 */
export async function image(
  prompt: string,
  model: string = IMAGE_MODEL,
  aspectRatio: string = "16:9"
): Promise<Buffer> {
  const apiKey = process.env.GMI_API_KEY;
  if (!apiKey) throw new GmiUnavailableError("GMI_API_KEY not set");
  const res = await withTimeout(
    fetch(GMI_MEDIA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        payload: { prompt, aspect_ratio: aspectRatio },
      }),
    }),
    GMI_IMAGE_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`GMI media queue HTTP ${res.status}`);
  const body = (await res.json()) as MediaQueueResponse;
  if (body.error) throw new Error(`GMI media queue: ${body.error}`);
  const parts = body.outcome?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data;
    if (inline?.data) return Buffer.from(inline.data, "base64");
  }
  throw new Error(`GMI image returned no inline image data (status: ${body.status})`);
}
