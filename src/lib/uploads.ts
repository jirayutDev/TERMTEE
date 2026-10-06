import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { sniffImageFormat, type SlipImageFormat } from "@/lib/slip/image";

/**
 * Private storage for user uploads (support case attachments). Files may contain personal
 * data, so they are never served from public/ — only through an authorizing route handler.
 * Same interface as slip-storage: swap `LocalUploadStorage` for an S3/R2 implementation.
 */
export interface UploadStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
}

export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

const EXT: Record<SlipImageFormat, { ext: string; contentType: string }> = {
  jpeg: { ext: "jpg", contentType: "image/jpeg" },
  png: { ext: "png", contentType: "image/png" },
  webp: { ext: "webp", contentType: "image/webp" },
};

const EXT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Storage keys are content addressed: sha256 hex + "." + ext. Anything else is rejected. */
const SAFE_KEY = /^[a-f0-9]{64}\.(jpg|png|webp)$/;

export function isUploadKey(key: string): boolean {
  return SAFE_KEY.test(key);
}

export function contentTypeForUploadKey(key: string): string {
  return EXT_TYPES[path.extname(key).slice(1).toLowerCase()] ?? "application/octet-stream";
}

/** Thrown by validateImageUpload. `message` is Thai and safe to show to the user. */
export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export interface ValidatedUpload {
  buffer: Buffer;
  key: string;
  contentType: string;
}

/**
 * JPEG / PNG / WebP only (by magic bytes, confirmed by decoding the header with sharp),
 * <= 5 MB. Never trusts the client filename or MIME type.
 */
export async function validateImageUpload(file: File): Promise<ValidatedUpload> {
  if (file.size === 0) throw new UploadError("ไฟล์ว่างเปล่า");
  if (file.size > UPLOAD_MAX_BYTES) throw new UploadError(`ไฟล์ ${file.name} ใหญ่เกิน 5 MB`);
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > UPLOAD_MAX_BYTES) throw new UploadError(`ไฟล์ ${file.name} ใหญ่เกิน 5 MB`);

  const format = sniffImageFormat(buffer);
  if (!format) throw new UploadError("รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP");
  try {
    const meta = await sharp(buffer, { failOn: "error" }).metadata();
    if (meta.format !== format || !meta.width || !meta.height) throw new Error("mismatch");
  } catch {
    throw new UploadError(`ไฟล์ ${file.name} เสียหรือเปิดไม่ได้`);
  }
  const { ext, contentType } = EXT[format];
  const hash = createHash("sha256").update(buffer).digest("hex");
  return { buffer, key: `${hash}.${ext}`, contentType };
}

class LocalUploadStorage implements UploadStorage {
  // Runtime-configured dir: keep the bundler from tracing the whole project.
  private readonly dir = path.resolve(
    /*turbopackIgnore: true*/ process.cwd(),
    process.env.UPLOAD_STORAGE_DIR || "storage/uploads",
  );

  private file(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error(`invalid upload key: ${key}`);
    const file = path.join(this.dir, key);
    // Belt and braces: the regex already forbids separators and "..".
    if (path.dirname(file) !== this.dir) throw new Error(`invalid upload key: ${key}`);
    return file;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.file(key);
    await mkdir(this.dir, { recursive: true });
    await writeFile(file, body);
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    try {
      const body = await readFile(this.file(key));
      return { body, contentType: contentTypeForUploadKey(key) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}

let storage: UploadStorage | null = null;

export function getUploadStorage(): UploadStorage {
  storage ??= new LocalUploadStorage();
  return storage;
}
