import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const key = process.env.GOOGLE_STREET_VIEW_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY or GOOGLE_STREET_VIEW_API_KEY is not configured" },
      { status: 503 }
    );
  }

  return NextResponse.json(
    { key },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
