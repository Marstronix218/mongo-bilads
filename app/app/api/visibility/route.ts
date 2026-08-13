/**
 * POST /api/visibility — physical visibility report for one GASP board
 * (Orangeboard seller-side).
 *
 * Body: { recordId: string }
 * Response: VisibilityReport — deterministic geometry/data math over the
 * traffic heatmap + Fiber business enrichment (no LLM), with every signal
 * tagged computed vs modeled. 400 on a missing recordId, 404 on an unknown
 * one; well-formed requests for known boards always succeed.
 */
import { NextRequest, NextResponse } from "next/server";
import { computeVisibility } from "@/lib/visibility";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let recordId: string;
  try {
    const body = (await req.json()) as { recordId?: string };
    if (typeof body.recordId !== "string" || body.recordId.trim() === "") {
      throw new Error("missing recordId");
    }
    recordId = body.recordId.trim();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid request body" },
      { status: 400 }
    );
  }

  const report = computeVisibility(recordId);
  if (!report) {
    return NextResponse.json({ error: `unknown recordId: ${recordId}` }, { status: 404 });
  }
  return NextResponse.json(report);
}
