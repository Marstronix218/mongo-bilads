/**
 * POST /api/onboard — URL → brief + ICP (Peel-style ABM intake).
 *
 * Body: { url: string }
 * Response: { brief: ProductBrief, source: "llm" | "fallback", host: string }
 *
 * Failure chain (never dead-ends once the page fetch succeeds):
 *   live LLM inference → deterministic title/meta fallback.
 * Only an unreachable/invalid URL returns an error status.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  normalizeSiteUrl,
  fetchSitePage,
  runOnboard,
  fallbackOnboard,
} from "@/lib/onboard";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let rawUrl: string;
  try {
    const body = (await req.json()) as { url?: string };
    if (typeof body.url !== "string" || !body.url.trim()) throw new Error();
    rawUrl = body.url.trim();
  } catch {
    return NextResponse.json({ error: "missing url" }, { status: 400 });
  }

  let url;
  try {
    url = normalizeSiteUrl(rawUrl);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid url" },
      { status: 400 }
    );
  }

  let page;
  try {
    page = await fetchSitePage(url);
  } catch (e) {
    return NextResponse.json(
      { error: `could not reach ${url.hostname}: ${e instanceof Error ? e.message : "fetch failed"}` },
      { status: 502 }
    );
  }

  try {
    const brief = await runOnboard(page);
    return NextResponse.json({ brief, source: "llm", host: page.host });
  } catch {
    return NextResponse.json({
      brief: fallbackOnboard(page),
      source: "fallback",
      host: page.host,
    });
  }
}
