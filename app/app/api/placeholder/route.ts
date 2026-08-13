import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const w = parseInt(searchParams.get("w") || "1024");
  const h = parseInt(searchParams.get("h") || "512");
  const text = searchParams.get("text") || "Bilads";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#1a1a2e"/>
        <stop offset="50%" style="stop-color:#16213e"/>
        <stop offset="100%" style="stop-color:#0f3460"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bg)"/>
    <text x="${w / 2}" y="${h / 2 - 20}" text-anchor="middle" fill="#F5D400" font-family="Arial,sans-serif" font-size="48" font-weight="bold">${escapeXml(text)}</text>
    <text x="${w / 2}" y="${h / 2 + 30}" text-anchor="middle" fill="#F5F1E8" font-family="Arial,sans-serif" font-size="24" opacity="0.7">Billboard Ad Concept</text>
  </svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
