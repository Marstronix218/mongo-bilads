import "server-only";

import { InferenceError, type InferenceProvider } from "./contracts";

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export interface ProviderFetchOptions {
  provider: InferenceProvider;
  url: string;
  init: RequestInit;
  timeoutMs: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds)) return Math.min(seconds * 1_000, 5_000);
  return Math.min(250 * 2 ** attempt + Math.floor(Math.random() * 100), 2_000);
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

async function safeErrorText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.replace(/\s+/g, " ").slice(0, 500);
}

/** Fetch with a per-attempt timeout and bounded retries for transient provider failures. */
export async function providerFetch(options: ProviderFetchOptions): Promise<Response> {
  const retries = Math.max(0, Math.min(options.maxRetries ?? 1, 2));

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) {
      throw new InferenceError({
        provider: options.provider,
        code: "aborted",
        message: `${options.provider} request was aborted`,
        cause: options.signal.reason,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new DOMException("Timed out", "TimeoutError")),
      options.timeoutMs
    );
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });

    try {
      const response = await fetch(options.url, {
        ...options.init,
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.ok) return response;

      const retryable = RETRYABLE_STATUS.has(response.status);
      if (retryable && attempt < retries) {
        await sleep(retryDelay(attempt, response.headers.get("retry-after")), options.signal);
        continue;
      }

      throw new InferenceError({
        provider: options.provider,
        code: response.status === 429 ? "rate_limited" : "provider_error",
        message: `${options.provider} request failed (${response.status}): ${await safeErrorText(response)}`,
        status: response.status,
        retryable,
      });
    } catch (error) {
      if (error instanceof InferenceError) throw error;
      const callerAborted = options.signal?.aborted;
      const timedOut = controller.signal.aborted && !callerAborted;
      if (!callerAborted && !timedOut && attempt < retries) {
        await sleep(retryDelay(attempt, null), options.signal);
        continue;
      }
      throw new InferenceError({
        provider: options.provider,
        code: callerAborted ? "aborted" : timedOut ? "timeout" : "provider_error",
        message: callerAborted
          ? `${options.provider} request was aborted`
          : timedOut
            ? `${options.provider} request timed out after ${options.timeoutMs}ms`
            : `${options.provider} request failed`,
        retryable: timedOut || !callerAborted,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }

  throw new Error("Unreachable provider retry state");
}

export function requiredSecret(provider: InferenceProvider, name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new InferenceError({
      provider,
      code: "not_configured",
      message: `${name} is not configured`,
    });
  }
  return value;
}

export async function jsonBody<T>(provider: InferenceProvider, response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new InferenceError({
      provider,
      code: "invalid_response",
      message: `${provider} returned invalid JSON`,
      cause: error,
    });
  }
}
