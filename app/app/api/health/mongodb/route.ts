import { NextResponse } from "next/server";
import { mongodbConfigured, pingMongoDB } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(): Promise<NextResponse> {
  if (!mongodbConfigured()) {
    return NextResponse.json(
      { connected: false, error: "MongoDB is not configured" },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  try {
    await pingMongoDB();
    return NextResponse.json({ connected: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error(
      "MongoDB health check failed",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { connected: false, error: "MongoDB is unavailable" },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }
}
