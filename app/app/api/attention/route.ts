/**
 * POST /api/attention — VLM attention testing (Peel-style Vision Studio lite).
 *
 * Body: { imageUrl: local path or InsForge Storage URL, headline, subline?, productName }
 * Response: AttentionReport (source "vlm" | "heuristic").
 *
 * Failure chain: live vision model → deterministic copy heuristic. Placeholder
 * images skip the VLM entirely (nothing real to look at). Always 200 for a
 * well-formed request.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  runAttention,
  heuristicAttention,
  loadCreativePng,
  type AttentionInput,
} from "@/lib/attention";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let input: AttentionInput;
  try {
    const body = (await req.json()) as Partial<AttentionInput>;
    if (!body.imageUrl || !body.headline || !body.productName) {
      throw new Error("imageUrl, headline, and productName are required");
    }
    input = body as AttentionInput;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid request body" },
      { status: 400 }
    );
  }

  const png = await loadCreativePng(input.imageUrl);
  if (png) {
    try {
      return NextResponse.json(await runAttention(input, png));
    } catch {
      // fall through to heuristic
    }
  }
  return NextResponse.json(heuristicAttention(input));
}
