/**
 * URL → brief + ICP onboarding (Peel-style ABM intake).
 *
 * Fetches a company homepage, strips it to readable text, and asks the LLM
 * to infer a ProductBrief (name, description, audience/ICP). Failure chain
 * matches the rest of the app: live LLM → deterministic fallback built from
 * the page <title> and meta description — the endpoint never dead-ends.
 */
import type { ProductBrief } from "./types";
import { chatJson } from "./parse";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_PAGE_CHARS = 6_000;

export interface SitePage {
  host: string;
  title: string;
  metaDescription: string;
  text: string;
}

/** Reject URLs that would let the scanner reach private/internal hosts. */
export function normalizeSiteUrl(raw: string): URL {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("only http(s) URLs are supported");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "[::1]"
  ) {
    throw new Error("private hosts are not allowed");
  }
  return url;
}

export async function fetchSitePage(url: URL): Promise<SitePage> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; BiladsBot/1.0; +http://localhost)",
      Accept: "text/html",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`site returned ${res.status}`);
  const html = (await res.text()).slice(0, 500_000);

  const title = matchTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription =
    matchMeta(html, "description") ?? matchMeta(html, "og:description") ?? "";

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|#160);/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PAGE_CHARS);

  return { host: url.hostname, title, metaDescription, text };
}

function matchTag(html: string, re: RegExp): string {
  return (html.match(re)?.[1] ?? "").replace(/\s+/g, " ").trim();
}

function matchMeta(html: string, name: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`,
    "i"
  );
  const m = html.match(re);
  return m ? (m[1] ?? m[2] ?? "").trim() : null;
}

/** LLM pass: infer the brief + ICP from the scraped page. */
export async function runOnboard(page: SitePage): Promise<ProductBrief> {
  const inferred = await chatJson<{
    productName?: string;
    description?: string;
    audience?: string;
  }>([
    {
      role: "system",
      content:
        "You turn a company homepage into a billboard campaign brief. " +
        "Reply with ONLY a JSON object: " +
        '{"productName": string (the company/product name, short), ' +
        '"description": string (2-3 sentences: what it is, who it serves, the single strongest benefit), ' +
        '"audience": string (1-2 sentences describing the ideal customer profile in San Francisco: who they are, age range if inferable, what they care about)}. ' +
        "Plain language, no marketing fluff, no invented claims.",
    },
    {
      role: "user",
      content:
        `Site: ${page.host}\nTitle: ${page.title}\nMeta description: ${page.metaDescription}\n\n` +
        `Page text:\n${page.text}`,
    },
  ]);
  const productName = inferred.productName?.trim();
  const description = inferred.description?.trim();
  const audience = inferred.audience?.trim();
  if (!productName || !description || !audience) {
    throw new Error("LLM onboarding returned incomplete brief");
  }
  return { productName, description, audience };
}

/** Deterministic fallback: build a usable brief from title/meta alone. */
export function fallbackOnboard(page: SitePage): ProductBrief {
  const name =
    page.title.split(/[|–—•·:-]/)[0].trim() ||
    page.host.replace(/^www\./, "").split(".")[0];
  return {
    productName: name,
    description:
      page.metaDescription ||
      page.text.slice(0, 240) ||
      `${name} — imported from ${page.host}.`,
    audience:
      "San Francisco residents and workers likely to encounter the brand during a daily commute.",
  };
}
