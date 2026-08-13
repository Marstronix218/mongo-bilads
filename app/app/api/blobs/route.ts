/**
 * POST /api/blobs — opportunity blobs (Peel-style ABM clustering).
 *
 * Body: { audienceProfile: AudienceProfile, brief?: ProductBrief }
 * Response: BlobsResult — ICP-matched business clusters + per-board nearby
 * target-account counts, computed deterministically from the Fiber dataset.
 */
import { NextRequest, NextResponse } from "next/server";
import type { AudienceProfile, ProductBrief } from "@/lib/types";
import { loadBoards } from "@/lib/boards";
import { computeBlobs } from "@/lib/blobs";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let profile: AudienceProfile;
  let brief: ProductBrief | undefined;
  try {
    const body = (await req.json()) as {
      audienceProfile?: AudienceProfile;
      brief?: ProductBrief;
    };
    if (!Array.isArray(body.audienceProfile?.interests)) {
      throw new Error("missing audienceProfile.interests");
    }
    profile = body.audienceProfile;
    brief = body.brief;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid request body" },
      { status: 400 }
    );
  }

  const briefText = brief ? `${brief.description} ${brief.audience}` : "";
  return NextResponse.json(computeBlobs(profile, briefText, loadBoards()));
}
