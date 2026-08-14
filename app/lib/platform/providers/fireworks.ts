import "server-only";

import {
  InferenceError,
  type ChatRequest,
  type ChatResult,
  type EmbeddingResult,
  type ImageRequest,
  type ImageResult,
  type RerankResult,
} from "../inference/contracts";
import { jsonBody, providerFetch, requiredSecret } from "../inference/http";

const PROVIDER = "fireworks" as const;
const BASE_URL = "https://api.fireworks.ai/inference/v1";
const DEFAULT_CHAT_MODEL = "accounts/fireworks/models/qwen3p7-plus";
const DEFAULT_IMAGE_MODEL = "accounts/fireworks/models/flux-1-schnell-fp8";
const DEFAULT_EMBEDDING_MODEL = "fireworks/qwen3-embedding-8b";
const DEFAULT_RERANK_MODEL = "fireworks/qwen3-reranker-8b";

interface FireworksConfig {
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  imageModel: string;
  embeddingModel: string;
  rerankModel: string;
}

function config(): FireworksConfig {
  return {
    apiKey: requiredSecret(PROVIDER, "FIREWORKS_API_KEY"),
    baseUrl: (process.env.FIREWORKS_BASE_URL?.trim() || BASE_URL).replace(/\/$/, ""),
    chatModel: process.env.FIREWORKS_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL,
    imageModel: process.env.FIREWORKS_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL,
    embeddingModel: process.env.FIREWORKS_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL,
    rerankModel: process.env.FIREWORKS_RERANK_MODEL?.trim() || DEFAULT_RERANK_MODEL,
  };
}

function headers(apiKey: string): HeadersInit {
  return { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
}

interface ChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/** Fireworks chat/vision call. Image URL parts in messages are passed through unchanged. */
export async function fireworksChat(request: ChatRequest): Promise<ChatResult> {
  const cfg = config();
  const model = request.model || cfg.chatModel;
  const response = await providerFetch({
    provider: PROVIDER,
    url: `${cfg.baseUrl}/chat/completions`,
    timeoutMs: 25_000,
    maxRetries: 1,
    signal: request.signal,
    init: {
      method: "POST",
      headers: headers(cfg.apiKey),
      body: JSON.stringify({
        model,
        messages: request.messages,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        ...(request.jsonSchema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: request.jsonSchema.name,
                  description: request.jsonSchema.description,
                  schema: request.jsonSchema.schema,
                  strict: request.jsonSchema.strict ?? true,
                },
              },
            }
          : {}),
      }),
    },
  });
  const data = await jsonBody<ChatResponse>(PROVIDER, response);
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new InferenceError({
      provider: PROVIDER,
      code: "invalid_response",
      message: "Fireworks response contained no text",
    });
  }
  return {
    text,
    model: data.model || model,
    provider: PROVIDER,
    requestId: data.id || response.headers.get("x-request-id") || undefined,
    usage: data.usage
      ? {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
  };
}

/** Semantic alias for callers performing multimodal review. */
export const fireworksVision = fireworksChat;

export async function fireworksStructuredChat<T>(request: ChatRequest & {
  jsonSchema: NonNullable<ChatRequest["jsonSchema"]>;
}): Promise<ChatResult & { value: T }> {
  const result = await fireworksChat(request);
  try {
    return { ...result, value: JSON.parse(result.text) as T };
  } catch (error) {
    throw new InferenceError({
      provider: PROVIDER,
      code: "invalid_response",
      message: "Fireworks structured response was not valid JSON",
      cause: error,
    });
  }
}

interface FireworksImageResponse {
  image?: string;
  base64?: string | string[];
  seed?: number;
  data?: Array<{ b64_json?: string; url?: string; seed?: number }>;
}

async function imageBytes(data: FireworksImageResponse, signal?: AbortSignal): Promise<{
  bytes: Buffer;
  contentType: string;
  seed?: number;
}> {
  const item = data.data?.[0];
  const encoded = item?.b64_json || (Array.isArray(data.base64) ? data.base64[0] : data.base64) || data.image;
  if (encoded) {
    const match = encoded.match(/^data:([^;]+);base64,([\s\S]*)$/);
    return {
      bytes: Buffer.from(match?.[2] || encoded, "base64"),
      contentType: match?.[1] || "image/png",
      seed: item?.seed ?? data.seed,
    };
  }
  if (item?.url) {
    const response = await providerFetch({
      provider: PROVIDER,
      url: item.url,
      timeoutMs: 20_000,
      maxRetries: 1,
      signal,
      init: { method: "GET" },
    });
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") || "image/png",
      seed: item.seed ?? data.seed,
    };
  }
  throw new InferenceError({
    provider: PROVIDER,
    code: "invalid_response",
    message: "Fireworks response contained no image",
  });
}

/** Generate artwork bytes only; callers remain responsible for exact text overlays. */
export async function fireworksImage(request: ImageRequest): Promise<ImageResult> {
  const cfg = config();
  const model = request.model || cfg.imageModel;
  const endpointModel = model.replace(/^\/+/, "");
  const ratio = (request.width ?? 1536) / (request.height ?? 768);
  const aspectRatio = ratio >= 2.05 ? "21:9" : ratio >= 1.55 ? "16:9" : ratio >= 1.2 ? "4:3" : "1:1";
  const response = await providerFetch({
    provider: PROVIDER,
    url: `${cfg.baseUrl}/workflows/${endpointModel}/text_to_image`,
    timeoutMs: 60_000,
    maxRetries: 0,
    signal: request.signal,
    init: {
      method: "POST",
      headers: { ...headers(cfg.apiKey), accept: "image/png, application/json" },
      body: JSON.stringify({
        prompt: request.prompt,
        aspect_ratio: aspectRatio,
        ...(request.seed === undefined ? {} : { seed: request.seed }),
        ...(request.guidanceScale === undefined
          ? {}
          : { guidance_scale: request.guidanceScale }),
        ...(request.steps === undefined ? {} : { num_inference_steps: request.steps }),
      }),
    },
  });
  const contentType = response.headers.get("content-type") || "";
  if (contentType.toLowerCase().startsWith("image/")) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) {
      throw new InferenceError({
        provider: PROVIDER,
        code: "invalid_response",
        message: "Fireworks returned an empty image",
      });
    }
    return { bytes, contentType, model };
  }
  const data = await jsonBody<FireworksImageResponse>(PROVIDER, response);
  const result = await imageBytes(data, request.signal);
  return { ...result, model };
}

interface EmbeddingsResponse {
  model?: string;
  data?: Array<{ index: number; embedding: number[] }>;
  usage?: { total_tokens?: number };
}

export async function fireworksEmbed(
  input: string | string[],
  options: { model?: string; dimensions?: number; normalize?: boolean; signal?: AbortSignal } = {}
): Promise<EmbeddingResult> {
  const cfg = config();
  const model = options.model || cfg.embeddingModel;
  const response = await providerFetch({
    provider: PROVIDER,
    url: `${cfg.baseUrl}/embeddings`,
    timeoutMs: 25_000,
    maxRetries: 1,
    signal: options.signal,
    init: {
      method: "POST",
      headers: headers(cfg.apiKey),
      body: JSON.stringify({
        model,
        input,
        ...(options.dimensions === undefined ? {} : { dimensions: options.dimensions }),
        ...(options.normalize === undefined ? {} : { normalize: options.normalize }),
      }),
    },
  });
  const data = await jsonBody<EmbeddingsResponse>(PROVIDER, response);
  const vectors = data.data?.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  const expected = Array.isArray(input) ? input.length : 1;
  if (!vectors || vectors.length !== expected || vectors.some((vector) => !vector.length)) {
    throw new InferenceError({
      provider: PROVIDER,
      code: "invalid_response",
      message: "Fireworks returned incomplete embeddings",
    });
  }
  return { vectors, model: data.model || model, usage: { totalTokens: data.usage?.total_tokens } };
}

interface RerankResponse {
  model?: string;
  results?: Array<{ index: number; relevance_score: number; document?: string | { text?: string } }>;
  data?: Array<{ index: number; relevance_score: number; document?: string | { text?: string } }>;
}

export async function fireworksRerank(
  query: string,
  documents: string[],
  options: { model?: string; topN?: number; signal?: AbortSignal } = {}
): Promise<RerankResult> {
  if (!documents.length) return { results: [], model: options.model || DEFAULT_RERANK_MODEL };
  const cfg = config();
  const model = options.model || cfg.rerankModel;
  const response = await providerFetch({
    provider: PROVIDER,
    url: `${cfg.baseUrl}/rerank`,
    timeoutMs: 25_000,
    maxRetries: 1,
    signal: options.signal,
    init: {
      method: "POST",
      headers: headers(cfg.apiKey),
      body: JSON.stringify({ model, query, documents, top_n: options.topN ?? documents.length }),
    },
  });
  const data = await jsonBody<RerankResponse>(PROVIDER, response);
  const raw = data.results || data.data;
  if (!raw) {
    throw new InferenceError({
      provider: PROVIDER,
      code: "invalid_response",
      message: "Fireworks returned no reranking results",
    });
  }
  return {
    model: data.model || model,
    results: raw.map((item) => ({
      index: item.index,
      relevanceScore: item.relevance_score,
      document: typeof item.document === "string" ? item.document : item.document?.text,
    })),
  };
}

export function createFireworksProvider() {
  return {
    chat: fireworksChat,
    structuredChat: fireworksStructuredChat,
    vision: fireworksVision,
    image: fireworksImage,
    embed: fireworksEmbed,
    rerank: fireworksRerank,
  };
}
