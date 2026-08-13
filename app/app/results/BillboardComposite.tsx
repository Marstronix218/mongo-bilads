"use client";

import { useEffect, useRef } from "react";
import type { AdCorners } from "@/lib/types";

/**
 * Composites a generated ad image onto a billboard photo using
 * perspective warp via canvas 2D. Falls back to a simple overlay
 * if the billboard photo isn't available.
 */
export default function BillboardComposite({
  boardPhoto,
  adImageUrl,
  adCorners,
  headline,
  subline,
  language,
  width = 600,
}: {
  boardPhoto: string;
  adImageUrl: string;
  adCorners: AdCorners;
  headline: string;
  subline: string;
  language: string;
  width?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const height = Math.round(width * 0.65);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = width;
    canvas.height = height;

    const boardImg = new Image();
    boardImg.crossOrigin = "anonymous";

    const adImg = new Image();
    adImg.crossOrigin = "anonymous";

    let cancelled = false;

    boardImg.onload = () => {
      if (cancelled) return;
      adImg.onload = () => {
        if (cancelled) return;

        // Draw billboard photo
        ctx.drawImage(boardImg, 0, 0, width, height);

        // Scale adCorners from original photo dimensions to canvas
        const scaleX = width / boardImg.naturalWidth;
        const scaleY = height / boardImg.naturalHeight;
        const corners = adCorners.map(([x, y]) => [
          x * scaleX,
          y * scaleY,
        ]) as [[number, number], [number, number], [number, number], [number, number]];

        // Draw the ad using a quadrilateral fill via multiple triangles
        drawPerspectiveAd(ctx, adImg, corners);

        // Overlay text
        drawTextOverlay(ctx, corners, headline, subline, language);
      };

      adImg.onerror = () => {
        if (cancelled) return;
        // Draw board without ad
        ctx.drawImage(boardImg, 0, 0, width, height);
      };

      adImg.src = adImageUrl;
    };

    boardImg.onerror = () => {
      if (cancelled) return;
      // No billboard photo — draw ad flat with text overlay
      adImg.onload = () => {
        if (cancelled) return;
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(adImg, 0, 0, width, height);
        const corners: [[number, number], [number, number], [number, number], [number, number]] = [
          [0, 0], [width, 0], [width, height], [0, height],
        ];
        drawTextOverlay(ctx, corners, headline, subline, language);
      };
      adImg.src = adImageUrl;
    };

    boardImg.src = boardPhoto;

    return () => {
      cancelled = true;
    };
  }, [boardPhoto, adImageUrl, adCorners, headline, subline, language, width, height]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg"
        style={{ aspectRatio: `${width}/${height}` }}
      />
      {/* Language badge */}
      <span className="absolute top-2 right-2 bg-bilads-accent text-bilads-bg text-xs font-bold px-2 py-1 rounded">
        {language.toUpperCase()}
      </span>
    </div>
  );
}

/**
 * Draws an image onto a quadrilateral defined by 4 corner points
 * using a grid-based subdivision approach for perspective approximation.
 */
function drawPerspectiveAd(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  corners: [[number, number], [number, number], [number, number], [number, number]]
) {
  const [tl, tr, br, bl] = corners;
  const gridSize = 12; // subdivision for smooth perspective

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const u0 = gx / gridSize;
      const v0 = gy / gridSize;
      const u1 = (gx + 1) / gridSize;
      const v1 = (gy + 1) / gridSize;

      // Bilinear interpolation for each corner of this grid cell
      const p00 = bilerp(tl, tr, br, bl, u0, v0);
      const p10 = bilerp(tl, tr, br, bl, u1, v0);
      const p01 = bilerp(tl, tr, br, bl, u0, v1);
      const p11 = bilerp(tl, tr, br, bl, u1, v1);

      // Source rectangle in the ad image
      const sx = u0 * img.naturalWidth;
      const sy = v0 * img.naturalHeight;
      const sw = (u1 - u0) * img.naturalWidth;
      const sh = (v1 - v0) * img.naturalHeight;

      // Draw as two triangles using save/clip/transform/restore
      drawTexturedTriangle(ctx, img, sx, sy, sw, sh, p00, p10, p01);
      drawTexturedTriangle(ctx, img, sx + sw, sy + sh, -sw, -sh, p11, p01, p10);
    }
  }
}

function bilerp(
  tl: [number, number],
  tr: [number, number],
  br: [number, number],
  bl: [number, number],
  u: number,
  v: number
): [number, number] {
  const top: [number, number] = [
    tl[0] + (tr[0] - tl[0]) * u,
    tl[1] + (tr[1] - tl[1]) * u,
  ];
  const bot: [number, number] = [
    bl[0] + (br[0] - bl[0]) * u,
    bl[1] + (br[1] - bl[1]) * u,
  ];
  return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
}

function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  p0: [number, number],
  p1: [number, number],
  p2: [number, number]
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.closePath();
  ctx.clip();

  // Affine transform mapping source triangle to destination triangle
  const denom = sw * sh;
  if (Math.abs(denom) < 0.001) {
    ctx.restore();
    return;
  }

  // Map unit square region to destination points
  const dx1 = p1[0] - p0[0];
  const dy1 = p1[1] - p0[1];
  const dx2 = p2[0] - p0[0];
  const dy2 = p2[1] - p0[1];

  ctx.setTransform(dx1 / sw, dy1 / sw, dx2 / sh, dy2 / sh, p0[0] - (dx1 * sx) / sw - (dx2 * sy) / sh, p0[1] - (dy1 * sx) / sw - (dy2 * sy) / sh);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function drawTextOverlay(
  ctx: CanvasRenderingContext2D,
  corners: [[number, number], [number, number], [number, number], [number, number]],
  headline: string,
  subline: string,
  _language: string
) {
  const [tl, tr, , bl] = corners;
  const centerX = (tl[0] + tr[0]) / 2;
  const centerY = (tl[1] + bl[1]) / 2;
  const adWidth = tr[0] - tl[0];

  // Semi-transparent backdrop
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();

  // Headline
  const headlineSize = Math.max(14, Math.round(adWidth * 0.06));
  ctx.font = `bold ${headlineSize}px sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 4;
  ctx.fillText(headline, centerX, centerY - headlineSize * 0.6, adWidth * 0.9);

  // Subline
  const sublineSize = Math.max(10, Math.round(adWidth * 0.035));
  ctx.font = `${sublineSize}px sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText(subline, centerX, centerY + headlineSize * 0.6, adWidth * 0.9);

  ctx.shadowBlur = 0;
}
