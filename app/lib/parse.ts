/**
 * JSON hygiene for all agents (PRD §5): strip code fences, JSON.parse in
 * try/catch, one silent retry with "return only valid JSON", then throw —
 * the caller handles the deterministic fallback.
 */
import { chat, type ChatMessage } from "./gmi";

export function parseJsonStrict<T = unknown>(text: string): T {
  let cleaned = text.trim();
  // Strip ```json ... ``` (or bare ```) fences.
  const fence = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  if (fence) cleaned = fence[1];
  // Some models prepend prose — fall back to the outermost {...} span.
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);
  }
  return JSON.parse(cleaned) as T;
}

/**
 * Chat call that must return JSON. On a parse failure, retries once with a
 * stern reminder appended; a second failure throws to the caller's fallback.
 */
export async function chatJson<T = unknown>(messages: ChatMessage[]): Promise<T> {
  const first = await chat(messages);
  try {
    return parseJsonStrict<T>(first);
  } catch {
    const retry = await chat([
      ...messages,
      { role: "assistant", content: first },
      { role: "user", content: "Return only valid JSON — no prose, no code fences." },
    ]);
    return parseJsonStrict<T>(retry);
  }
}
