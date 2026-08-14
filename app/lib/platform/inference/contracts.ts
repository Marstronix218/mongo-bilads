import "server-only";

export type TextRole = "system" | "developer" | "user" | "assistant";

export type MessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
    >;

export interface InferenceMessage {
  role: TextRole;
  content: MessageContent;
}

export interface JsonSchema {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface ChatRequest {
  messages: InferenceMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonSchema?: JsonSchema;
  signal?: AbortSignal;
}

export interface ChatResult {
  text: string;
  model: string;
  provider: "fireworks" | "openrouter";
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  requestId?: string;
}

export interface ImageRequest {
  prompt: string;
  model?: string;
  width?: number;
  height?: number;
  seed?: number;
  guidanceScale?: number;
  steps?: number;
  signal?: AbortSignal;
}

export interface ImageResult {
  bytes: Buffer;
  contentType: string;
  model: string;
  seed?: number;
}

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  usage?: { totalTokens?: number };
}

export interface RerankResult {
  results: Array<{ index: number; relevanceScore: number; document?: string }>;
  model: string;
}

export type InferenceProvider = ChatResult["provider"] | "elevenlabs";

export type InferenceErrorCode =
  | "not_configured"
  | "timeout"
  | "aborted"
  | "rate_limited"
  | "provider_error"
  | "invalid_response";

export class InferenceError extends Error {
  readonly provider: InferenceProvider;
  readonly code: InferenceErrorCode;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(options: {
    provider: InferenceProvider;
    code: InferenceErrorCode;
    message: string;
    status?: number;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "InferenceError";
    this.provider = options.provider;
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}
