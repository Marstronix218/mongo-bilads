/**
 * POST /api/pitch (Orangeboard) — outbound seller→advertiser email draft.
 * Body: { recordId, advertiserName, category, visibilitySummary?,
 * clusterSummary? } → PitchResult.
 *
 * Failure chain (app never dead-ends): draftPitch tries one LLM call and
 * falls back to a deterministic template internally, so every well-formed
 * request returns 200 — the only error here is 400 for missing fields.
 */
import { NextRequest, NextResponse } from "next/server";
import { draftPitch, type PitchInput } from "@/lib/pitch";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: PitchInput;
  try {
    body = (await req.json()) as PitchInput;
    for (const field of ["recordId", "advertiserName", "category"] as const) {
      if (typeof body?.[field] !== "string" || !body[field]) throw new Error(`missing ${field}`);
    }
    if (body.visibilitySummary !== undefined && typeof body.visibilitySummary !== "string")
      throw new Error("visibilitySummary must be a string");
    if (body.clusterSummary !== undefined && typeof body.clusterSummary !== "string")
      throw new Error("clusterSummary must be a string");
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid request body" },
      { status: 400 }
    );
  }

  const result = await draftPitch(body);
  return NextResponse.json(result);
}
