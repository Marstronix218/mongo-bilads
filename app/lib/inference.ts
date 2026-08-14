/** Stable Bilads inference facade, implemented by Fireworks. */
import {
  InferenceError,
  type InferenceMessage,
} from "./platform/inference/contracts";
import {
  fireworksChat,
  fireworksImage,
} from "./platform/providers/fireworks";

export const CHAT_MODEL =
  process.env.FIREWORKS_CHAT_MODEL ??
  "accounts/fireworks/models/qwen3p7-plus";
export const VISION_MODEL = process.env.FIREWORKS_VISION_MODEL ?? CHAT_MODEL;
export const IMAGE_MODEL =
  process.env.FIREWORKS_IMAGE_MODEL ??
  "accounts/fireworks/models/flux-1-schnell-fp8";

export class InferenceUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InferenceUnavailableError";
  }
}

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export interface ChatMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string | ChatContentPart[];
}

function unavailable(error: unknown): never {
  if (
    error instanceof InferenceError &&
    (error.code === "not_configured" || error.code === "timeout")
  ) {
    throw new InferenceUnavailableError(error.message, { cause: error });
  }
  throw error;
}

export async function chat(
  messages: ChatMessage[],
  model: string = CHAT_MODEL
): Promise<string> {
  try {
    return (
      await fireworksChat({
        messages: messages as InferenceMessage[],
        model,
        temperature: 0.2,
      })
    ).text;
  } catch (error) {
    return unavailable(error);
  }
}

export async function image(
  prompt: string,
  model: string = IMAGE_MODEL
): Promise<Buffer> {
  try {
    return (
      await fireworksImage({
        prompt,
        model,
        width: 1536,
        height: 768,
      })
    ).bytes;
  } catch (error) {
    return unavailable(error);
  }
}
