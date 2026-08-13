/**
 * POST /api/advertisers (Orangeboard) — ranked best-fit advertisers for one
 * GASP board. Body: { recordId: string, mode?: "b2b" | "b2c" | "auto",
 * enrich?: boolean } → AdvertiserAnalysis.
 *
 * Failure chain (app never dead-ends):
 *   - analyzeAdvertisers is deterministic (computed signals only) — a valid
 *     recordId always returns 200, even with zero Fiber coverage.
 *   - enrich=true layers ONE LLM call of modeled firmographics on top; any
 *     LLM failure silently returns the un-enriched computed analysis.
 *   - 404 only for a recordId that isn't in the GASP inventory; 400 for a
 *     malformed body.
 */
import { NextRequest, NextResponse } from "next/server";
import { analyzeAdvertisers, enrichAdvertisers } from "@/lib/advertisers";

export const runtime = "nodejs";

interface AdvertisersRequest {
  recordId: string;
  mode?: "b2b" | "b2c" | "auto";
  enrich?: boolean;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: AdvertisersRequest;
  try {
    body = (await req.json()) as AdvertisersRequest;
    if (typeof body?.recordId !== "string" || !body.recordId) throw new Error("missing recordId");
    if (body.mode !== undefined && !["b2b", "b2c", "auto"].includes(body.mode))
      throw new Error("mode must be b2b, b2c, or auto");
    if (body.enrich !== undefined && typeof body.enrich !== "boolean")
      throw new Error("enrich must be a boolean");
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid request body" },
      { status: 400 }
    );
  }

  const analysis = analyzeAdvertisers(body.recordId, body.mode ?? "auto");
  if (!analysis) {
    return NextResponse.json({ error: `unknown recordId: ${body.recordId}` }, { status: 404 });
  }

  if (body.enrich) {
    // Silent fallback inside — on any LLM failure the computed list returns unchanged.
    analysis.advertisers = await enrichAdvertisers(analysis.advertisers, body.recordId);
  }

  return NextResponse.json(analysis);
}
