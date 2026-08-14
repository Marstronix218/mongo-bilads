import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/apiAuth";
import { downloadFile, getFileMetadata } from "@/lib/platform/mongo/gridfs";

export const runtime = "nodejs";

const ALLOWED_BUCKETS = new Set(["product-assets", "generated-creatives", "campaign-audio"]);

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ bucket: string; id: string }> }
): Promise<NextResponse> {
  const auth = await authorizeApiRequest(req);
  if (auth.response) return auth.response;

  const { bucket, id } = await context.params;
  if (!ALLOWED_BUCKETS.has(bucket) || !/^[0-9a-f]{24}$/i.test(id)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const [metadata, bytes] = await Promise.all([
    getFileMetadata(bucket, id),
    downloadFile(bucket, id),
  ]);
  if (!metadata || !bytes) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": metadata.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
