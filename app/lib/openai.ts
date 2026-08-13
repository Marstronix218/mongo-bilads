/**
 * OpenAI client for text, vision, and image generation.
 *
 * Calls use the native Responses and Image APIs. They fail fast when the API
 * key is missing or a request exceeds its budget so every caller can preserve
 * the app's deterministic fallback behavior.
 */
import OpenAI from "openai";
import type {
  ResponseInput,
  ResponseInputContent,
} from "openai/resources/responses/responses";

export const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-5.6-luna";
export const VISION_MODEL = process.env.OPENAI_VISION_MODEL ?? CHAT_MODEL;
export const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";

export const OPENAI_TIMEOUT_MS = 20_000;
export const OPENAI_IMAGE_TIMEOUT_MS = 55_000;

export class OpenAIUnavailableError extends Error {}

let client: OpenAI | null = null;

export function openai(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new OpenAIUnavailableError("OPENAI_API_KEY not set");
  if (!client) client = new OpenAI({ apiKey, maxRetries: 0 });
  return client;
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  ms = OPENAI_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new OpenAIUnavailableError(`OpenAI call timed out after ${ms}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string | ChatContentPart[];
}

function responseInput(messages: ChatMessage[]): ResponseInput {
  return messages.map((message) => ({
    role: message.role,
    content:
      typeof message.content === "string"
        ? message.content
        : message.content.map<ResponseInputContent>((part) =>
            part.type === "text"
              ? { type: "input_text", text: part.text }
              : {
                  type: "input_image",
                  detail: "auto",
                  image_url: part.image_url.url,
                }
          ),
  }));
}

/** One Responses API call; returns the model's combined text output. */
export async function chat(messages: ChatMessage[], model: string = CHAT_MODEL): Promise<string> {
  const response = await withTimeout((signal) =>
    openai().responses.create(
      {
        model,
        input: responseInput(messages),
        reasoning: { effort: "low" },
        store: false,
      },
      { signal }
    )
  );
  const text = response.output_text?.trim();
  if (!text) throw new Error("OpenAI response contained no text");
  return text;
}

/** Generate one wide billboard image and return raw PNG bytes. */
export async function image(prompt: string, model: string = IMAGE_MODEL): Promise<Buffer> {
  const response = await withTimeout(
    (signal) =>
      openai().images.generate(
        {
          model,
          prompt,
          size: "1536x768",
          quality: "medium",
          output_format: "png",
        },
        { signal }
      ),
    OPENAI_IMAGE_TIMEOUT_MS
  );
  const base64 = response.data?.[0]?.b64_json;
  if (!base64) throw new Error("OpenAI image response contained no image data");
  return Buffer.from(base64, "base64");
}
