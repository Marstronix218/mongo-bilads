import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { chat, GmiUnavailableError } from "@/lib/gmi";

export const runtime = "nodejs";
export const maxDuration = 60;

type Point = [number, number];
type Detection = {
  quad: [Point, Point, Point, Point] | null;
  confidence?: number;
  reason?: string;
  source: "gmi" | "none" | "error";
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { value: Detection; expiresAt: number }>();

const SYSTEM =
  "You detect existing outdoor advertising faces in street-level imagery. " +
  "Return only JSON. Do not invent a billboard. If there is no visible physical billboard, poster, bus-shelter ad, wallscape, or large ad sign face, return null.";

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object in detector response");
    return JSON.parse(match[0]);
  }
}

function normalizeQuad(value: unknown, imageW: number, imageH: number): [Point, Point, Point, Point] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const points = value.map((point) => {
    if (!Array.isArray(point) || point.length < 2) return null;
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [x, y] as Point;
  });
  if (points.some((point) => point == null)) return null;

  const max = Math.max(...(points as Point[]).flat());
  const scaled = (points as Point[]).map(([x, y]) => {
    const px = max <= 1.5 ? x * imageW : x;
    const py = max <= 1.5 ? y * imageH : y;
    return [
      Math.max(0, Math.min(imageW, px)),
      Math.max(0, Math.min(imageH, py)),
    ] as Point;
  });

  const area =
    0.5 *
    Math.abs(
      scaled.reduce((sum, [x, y], i) => {
        const [nx, ny] = scaled[(i + 1) % scaled.length];
        return sum + x * ny - nx * y;
      }, 0)
    );
  if (area < imageW * imageH * 0.003 || area > imageW * imageH * 0.55) return null;
  return scaled as [Point, Point, Point, Point];
}

function cacheKey(imageUrl: string): string {
  return createHash("sha256").update(imageUrl).digest("hex");
}

function isRateLimit(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    ("status" in err || "error" in err) &&
    ((err as { status?: unknown }).status === 429 ||
      String((err as { error?: unknown }).error ?? "").toLowerCase().includes("rate limit"))
  );
}

export async function POST(req: NextRequest): Promise<NextResponse<Detection>> {
  let body: { imageUrl?: string; imageW?: number; imageH?: number; boardName?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ quad: null, source: "error", reason: "Invalid request body" }, { status: 400 });
  }

  const imageUrl = body.imageUrl;
  const imageW = Number(body.imageW ?? 0);
  const imageH = Number(body.imageH ?? 0);
  if (!imageUrl || !/^data:image\//i.test(imageUrl) || imageW <= 0 || imageH <= 0) {
    return NextResponse.json({ quad: null, source: "error", reason: "imageUrl, imageW, and imageH are required" }, { status: 400 });
  }

  const key = cacheKey(imageUrl);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.value);
  if (cached) cache.delete(key);

  try {
    const text = await chat(
      [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Find the best existing physical ad face near ${body.boardName ?? "this selected board"}. ` +
                `Return {"quad":[[x,y],[x,y],[x,y],[x,y]],"confidence":0-1,"reason":"short"} in pixel coordinates ` +
                `for TL, TR, BR, BL. If no real ad face is visible, return {"quad":null,"confidence":0,"reason":"none visible"}.`,
            },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      process.env.GMI_VISION_MODEL ?? process.env.GMI_CHAT_MODEL
    );
    const parsed = parseJson(text) as { quad?: unknown; confidence?: unknown; reason?: unknown };
    const quad = normalizeQuad(parsed.quad, imageW, imageH);
    const value: Detection = {
      quad,
      confidence: Number(parsed.confidence ?? (quad ? 0.5 : 0)),
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
      source: quad ? "gmi" : "none",
    };
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(value);
  } catch (err) {
    const reason = isRateLimit(err)
      ? "Detector rate-limited; keeping Street View scene unmodified."
      : "Detector unavailable";
    if (!(err instanceof GmiUnavailableError) && !isRateLimit(err)) {
      console.error("detect-billboard failed:", err);
    }
    const value: Detection = { quad: null, source: "error", reason };
    cache.set(key, { value, expiresAt: Date.now() + 5 * 60 * 1000 });
    return NextResponse.json(value);
  }
}
