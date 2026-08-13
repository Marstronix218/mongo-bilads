/**
 * Image generation + persistence for /api/generate.
 * Generated art is uploaded to InsForge Storage for durable production URLs.
 * Local development can fall back to app/public/generated when Storage is not
 * configured. On any failure the placeholder route ships instead.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { image } from "./gmi";
import { uploadFile } from "./insforge";

const GENERATED_BUCKET = "generated-creatives";

export interface GeneratedImageResult {
  imageUrl: string;
  asset?: {
    bucket: string;
    key: string;
    url: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
  };
}

/** Branded SVG placeholder rendered by app/app/api/placeholder/route.ts. */
export function placeholderUrl(text: string): string {
  return `/api/placeholder?w=1024&h=512&text=${encodeURIComponent(text)}`;
}

function generatedDir(): string {
  // process.cwd() is app/ when started there, repo root otherwise.
  const local = join(process.cwd(), "public");
  return existsSync(local)
    ? join(local, "generated")
    : join(process.cwd(), "app", "public", "generated");
}

/**
 * Generate and persist one ad image. Returns its durable Storage URL (or a
 * local development path), with a placeholder URL on failure.
 */
export async function generateAdImage(
  prompt: string,
  cacheKey: string,
  index: number,
  placeholderText: string,
  forceRegenerate = false,
  storageScope?: { workspaceId: string; campaignId: string }
): Promise<GeneratedImageResult> {
  const filename = `${cacheKey}-${index}.png`;
  const urlPath = `/generated/${filename}`;
  const diskPath = join(generatedDir(), filename);
  if (!forceRegenerate && existsSync(diskPath)) return { imageUrl: urlPath };
  try {
    const bytes = await image(prompt);

    let storageError: unknown;
    try {
      const stored = await uploadFile(
        GENERATED_BUCKET,
        storageScope
          ? `${storageScope.workspaceId}/${storageScope.campaignId}/generated/${filename}`
          : `generated/${filename}`,
        bytes,
        "image/png"
      );
      if (stored) return { imageUrl: stored.url, asset: stored };
    } catch (error) {
      storageError = error;
    }

    // Deployed functions cannot publish files written at runtime. Local disk is
    // retained only for offline/development use when Storage is unavailable.
    if (process.env.NODE_ENV === "production") {
      throw storageError ?? new Error("InsForge Storage is not configured");
    }

    mkdirSync(generatedDir(), { recursive: true });
    writeFileSync(diskPath, bytes);
    return { imageUrl: urlPath };
  } catch (error) {
    console.warn(
      `Image generation failed for ${filename}; returning a placeholder:`,
      error instanceof Error ? error.message : String(error)
    );
    return { imageUrl: placeholderUrl(placeholderText) };
  }
}
