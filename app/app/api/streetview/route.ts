import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const STREET_VIEW_URL = "https://maps.googleapis.com/maps/api/streetview";
const METADATA_URL = "https://maps.googleapis.com/maps/api/streetview/metadata";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const key = process.env.GOOGLE_STREET_VIEW_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY or GOOGLE_STREET_VIEW_API_KEY is not configured" },
      { status: 503 }
    );
  }

  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const heading = Number(req.nextUrl.searchParams.get("heading") ?? 0);
  const pitch = Number(req.nextUrl.searchParams.get("pitch") ?? 2);
  const fov = Number(req.nextUrl.searchParams.get("fov") ?? 74);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const params = new URLSearchParams({
    key,
    location: `${lat.toFixed(7)},${lng.toFixed(7)}`,
    heading: String(Math.round(((heading % 360) + 360) % 360)),
    pitch: String(Math.max(-30, Math.min(30, Math.round(pitch)))),
    fov: String(Math.max(35, Math.min(110, Math.round(fov)))),
    size: "1280x720",
    source: "outdoor",
    return_error_code: "true",
  });

  const meta = await fetch(`${METADATA_URL}?${params.toString()}`, { cache: "no-store" });
  const metadata = (await meta.json().catch(() => null)) as { status?: string; error_message?: string } | null;
  if (!meta.ok || metadata?.status !== "OK") {
    return NextResponse.json(
      { error: metadata?.error_message ?? metadata?.status ?? `Street View metadata HTTP ${meta.status}` },
      { status: 404 }
    );
  }

  const image = await fetch(`${STREET_VIEW_URL}?${params.toString()}`, { cache: "no-store" });
  if (!image.ok || !image.body) {
    return NextResponse.json({ error: `Street View image HTTP ${image.status}` }, { status: image.status || 502 });
  }

  return new NextResponse(image.body, {
    headers: {
      "Content-Type": image.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
