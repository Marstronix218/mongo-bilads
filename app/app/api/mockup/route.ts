/**
 * POST /api/mockup (Orangeboard) — creative mockup copy + billboard art for a
 * (board, advertiser) pair. Body: { recordId, advertiserName, category,
 * address } → { headline, subline, imageUrl, source }.
 *
 * Failure chain (app never dead-ends): generateMockup falls back internally
 * (LLM copy → canned copy; image gen → branded placeholder), so a well-formed
 * request for a real board always returns 200. 400 for missing fields, 404
 * for a recordId that isn't in the GASP inventory.
 */
import { NextRequest, NextResponse } from "next/server";
import { getInventoryBoard } from "@/lib/inventory";
import { generateMockup, type MockupInput } from "@/lib/mockup";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: MockupInput;
  try {
    body = (await req.json()) as MockupInput;
    for (const field of ["recordId", "advertiserName", "category", "address"] as const) {
      if (typeof body?.[field] !== "string" || !body[field]) throw new Error(`missing ${field}`);
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid request body" },
      { status: 400 }
    );
  }

  if (!getInventoryBoard(body.recordId)) {
    return NextResponse.json({ error: `unknown recordId: ${body.recordId}` }, { status: 404 });
  }

  const result = await generateMockup(body);
  return NextResponse.json(result);
}
