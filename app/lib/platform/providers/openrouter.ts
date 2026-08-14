import "server-only";

import {
  InferenceError,
  type ChatRequest,
  type ChatResult,
} from "../inference/contracts";
import { jsonBody, providerFetch, requiredSecret } from "../inference/http";

const PROVIDER = "openrouter" as const;
const BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterEvaluationRequest extends ChatRequest {
  /** Required unless OPENROUTER_EVAL_MODEL is set. Never selected as a runtime fallback. */
  model?: string;
  /** Optional ordered provider allowlist, for example ["Fireworks"]. */
  providerOrder?: string[];
}

interface OpenRouterResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * Explicit evaluation-only inference through OpenRouter.
 * Automatic provider fallbacks and data collection are disabled by construction.
 */
export async function evaluateWithOpenRouter(
  request: OpenRouterEvaluationRequest
): Promise<ChatResult> {
  const apiKey = requiredSecret(PROVIDER, "OPENROUTER_API_KEY");
  const model = request.model || process.env.OPENROUTER_EVAL_MODEL?.trim();
  if (!model) {
    throw new InferenceError({
      provider: PROVIDER,
      code: "not_configured",
      message: "OpenRouter evaluation requires model or OPENROUTER_EVAL_MODEL",
    });
  }
  const baseUrl = (process.env.OPENROUTER_BASE_URL?.trim() || BASE_URL).replace(/\/$/, "");
  const providerOrder = request.providerOrder?.length
    ? request.providerOrder
    : process.env.OPENROUTER_PROVIDER_ORDER?.split(",").map((item) => item.trim()).filter(Boolean);
  const response = await providerFetch({
    provider: PROVIDER,
    url: `${baseUrl}/chat/completions`,
    timeoutMs: 30_000,
    maxRetries: 0,
    signal: request.signal,
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...(process.env.OPENROUTER_SITE_URL?.trim()
          ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL.trim() }
          : {}),
        ...(process.env.OPENROUTER_APP_NAME?.trim()
          ? { "X-Title": process.env.OPENROUTER_APP_NAME.trim() }
          : {}),
      },
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
        provider: {
          ...(providerOrder?.length ? { order: providerOrder } : {}),
          allow_fallbacks: false,
          require_parameters: true,
          data_collection: "deny",
          zdr: true,
        },
      }),
    },
  });
  const data = await jsonBody<OpenRouterResponse>(PROVIDER, response);
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new InferenceError({
      provider: PROVIDER,
      code: "invalid_response",
      message: "OpenRouter response contained no text",
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

export function createOpenRouterEvaluationProvider() {
  return { evaluate: evaluateWithOpenRouter };
}
