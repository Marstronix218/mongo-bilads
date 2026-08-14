import "server-only";

import { createHash } from "node:crypto";
import { GridFSBucket, ObjectId, type GridFSFile } from "mongodb";
import { mongoDatabase } from "@/lib/mongodb";
import type { StoredFile } from "./contracts";

const BUCKET_PREFIX = "bilads_";

function assertBucket(bucket: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(bucket)) throw new Error(`invalid bucket: ${bucket}`);
}

function assertKey(key: string): void {
  if (key.startsWith("/") || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`invalid object key: ${key}`);
  }
}

async function gridfs(bucket: string): Promise<GridFSBucket> {
  assertBucket(bucket);
  return new GridFSBucket(await mongoDatabase(), { bucketName: `${BUCKET_PREFIX}${bucket}` });
}

function metadata(bucket: string, file: GridFSFile): StoredFile {
  const data = file.metadata as { mimeType?: string; sha256?: string } | undefined;
  return {
    id: file._id.toHexString(), bucket, key: file.filename,
    url: `/api/platform/files/${encodeURIComponent(bucket)}/${file._id.toHexString()}`,
    mimeType: data?.mimeType ?? "application/octet-stream", byteSize: file.length,
    sha256: data?.sha256 ?? "",
  };
}

export async function uploadFile(
  bucket: string,
  key: string,
  bytes: Buffer,
  mimeType = "application/octet-stream"
): Promise<StoredFile> {
  assertKey(key);
  const store = await gridfs(bucket);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = await store.find({ filename: key }).sort({ uploadDate: -1 }).limit(1).next();
  if (existing) {
    const existingMetadata = metadata(bucket, existing);
    if (existingMetadata.sha256 !== sha256) throw new Error("storage key already belongs to different content");
    return existingMetadata;
  }
  const id = new ObjectId();
  await new Promise<void>((resolve, reject) => {
    const stream = store.openUploadStreamWithId(id, key, { metadata: { bucket, mimeType, sha256 } });
    stream.once("error", reject);
    stream.once("finish", () => resolve());
    stream.end(bytes);
  });
  return {
    id: id.toHexString(),
    bucket,
    key,
    url: `/api/platform/files/${encodeURIComponent(bucket)}/${id.toHexString()}`,
    mimeType,
    byteSize: bytes.byteLength,
    sha256,
  };
}

export async function downloadFile(bucket: string, idOrKey: string): Promise<Buffer | null> {
  const store = await gridfs(bucket);
  const file = ObjectId.isValid(idOrKey)
    ? await store.find({ _id: new ObjectId(idOrKey) }).limit(1).next()
    : (assertKey(idOrKey), await store.find({ filename: idOrKey }).sort({ uploadDate: -1 }).limit(1).next());
  if (!file) return null;
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = store.openDownloadStream(file._id);
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(Buffer.concat(chunks)));
  });
}

export async function removeFile(bucket: string, idOrKey: string): Promise<void> {
  const store = await gridfs(bucket);
  const file = ObjectId.isValid(idOrKey)
    ? await store.find({ _id: new ObjectId(idOrKey) }).limit(1).next()
    : (assertKey(idOrKey), await store.find({ filename: idOrKey }).sort({ uploadDate: -1 }).limit(1).next());
  if (file) await store.delete(file._id);
}

export async function getFileMetadata(bucket: string, id: string): Promise<StoredFile | null> {
  if (!ObjectId.isValid(id)) return null;
  const file = await (await gridfs(bucket)).find({ _id: new ObjectId(id) }).limit(1).next();
  return file ? metadata(bucket, file) : null;
}
