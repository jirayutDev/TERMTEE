/**
 * Slip image validation + preprocessing (server-only, uses sharp).
 *
 * validateSlipFile() -> original bytes as Buffer (hash/store these)
 * prepareSlipImage() -> raw RGBA (for QR) + grayscale upscaled PNG (for OCR)
 */
import { createHash } from "node:crypto";
import sharp from "sharp";

export const SLIP_MAX_BYTES = 5 * 1024 * 1024;
export const SLIP_MIN_DIM = 200;
export const SLIP_MAX_DIM = 4000;

export type SlipImageFormat = "jpeg" | "png" | "webp";

export type SlipImageErrorCode = "EMPTY" | "TOO_LARGE" | "BAD_FORMAT" | "CORRUPT" | "TOO_SMALL_DIM" | "TOO_LARGE_DIM";

/** Thrown by validateSlipFile. `message` is Thai and safe to show to the customer. */
export class SlipImageError extends Error {
  constructor(
    public readonly code: SlipImageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SlipImageError";
  }
}

/** Detect format from magic bytes (never trust the client MIME type). */
export function sniffImageFormat(buf: Buffer): SlipImageFormat | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return "png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

async function toBuffer(file: File | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(file)) return file;
  if (typeof file.size === "number" && file.size > SLIP_MAX_BYTES) {
    throw new SlipImageError("TOO_LARGE", "ไฟล์สลิปใหญ่เกิน 5 MB");
  }
  return Buffer.from(await file.arrayBuffer());
}

export interface ValidatedSlip {
  buffer: Buffer;
  format: SlipImageFormat;
  width: number; // after EXIF orientation
  height: number;
}

/** Validate and return full info. Throws SlipImageError. */
export async function inspectSlipFile(file: File | Buffer): Promise<ValidatedSlip> {
  const buffer = await toBuffer(file);
  if (buffer.length === 0) throw new SlipImageError("EMPTY", "ไม่พบไฟล์สลิป");
  if (buffer.length > SLIP_MAX_BYTES) throw new SlipImageError("TOO_LARGE", "ไฟล์สลิปใหญ่เกิน 5 MB");

  const format = sniffImageFormat(buffer);
  if (!format) throw new SlipImageError("BAD_FORMAT", "รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP");

  let width: number | undefined;
  let height: number | undefined;
  try {
    const meta = await sharp(buffer, { failOn: "error" }).metadata();
    if (meta.format !== format) {
      throw new Error(`format mismatch ${meta.format} vs ${format}`);
    }
    width = meta.autoOrient?.width ?? meta.width;
    height = meta.autoOrient?.height ?? meta.height;
    // Decode fully once so truncated/corrupt files are caught here, not later.
    await sharp(buffer, { failOn: "error" }).resize(32, 32, { fit: "inside" }).raw().toBuffer();
  } catch {
    throw new SlipImageError("CORRUPT", "ไฟล์รูปเสียหรือเปิดไม่ได้");
  }
  if (!width || !height) throw new SlipImageError("CORRUPT", "ไฟล์รูปเสียหรือเปิดไม่ได้");
  if (width < SLIP_MIN_DIM || height < SLIP_MIN_DIM) {
    throw new SlipImageError("TOO_SMALL_DIM", `รูปสลิปเล็กเกินไป (ต้องอย่างน้อย ${SLIP_MIN_DIM}x${SLIP_MIN_DIM} px)`);
  }
  if (width > SLIP_MAX_DIM || height > SLIP_MAX_DIM) {
    throw new SlipImageError("TOO_LARGE_DIM", `รูปสลิปใหญ่เกินไป (ไม่เกิน ${SLIP_MAX_DIM}x${SLIP_MAX_DIM} px)`);
  }
  return { buffer, format, width, height };
}

/**
 * Validate an uploaded slip: JPEG/PNG/WebP by magic bytes, <= 5 MB, 200..4000 px per side.
 * Returns the original bytes as a Buffer (hash and store exactly these). Throws SlipImageError.
 */
export async function validateSlipFile(file: File | Buffer): Promise<Buffer> {
  return (await inspectSlipFile(file)).buffer;
}

export function sha256Hex(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

async function rawRgba(pipeline: ReturnType<typeof sharp>): Promise<RgbaImage> {
  // Force 4-channel sRGB output (grayscale/threshold pipelines would otherwise give 1-2 channels).
  const { data, info } = await pipeline.toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`expected RGBA, got ${info.channels} channels`);
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

/** EXIF-rotated RGBA of the whole slip, downscaled so the long side is <= maxSide. */
export async function toRgba(buf: Buffer, maxSide = 2000): Promise<RgbaImage> {
  return rawRgba(sharp(buf).rotate().resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true }));
}

export interface CropRect {
  left: number; // fractions 0..1 of the oriented image
  top: number;
  width: number;
  height: number;
}

/**
 * Crop (fractions of the oriented image), upscale so the crop's long side is ~targetSide and
 * optionally grayscale+threshold. Used for QR retries on small slip QRs.
 */
export interface OrientedRaw {
  data: Buffer;
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
}

/** Decode once with EXIF orientation applied, as raw pixels (input for cropRgba). */
export async function orientRaw(buf: Buffer): Promise<OrientedRaw> {
  const { data, info } = await sharp(buf).rotate().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels as OrientedRaw["channels"] };
}

export async function cropRgba(
  src: OrientedRaw,
  rect: CropRect,
  opts: { targetSide?: number; threshold?: number | null } = {},
): Promise<RgbaImage> {
  const W = src.width;
  const H = src.height;
  const left = Math.max(0, Math.floor(rect.left * W));
  const top = Math.max(0, Math.floor(rect.top * H));
  const width = Math.max(1, Math.min(W - left, Math.floor(rect.width * W)));
  const height = Math.max(1, Math.min(H - top, Math.floor(rect.height * H)));
  const target = opts.targetSide ?? 1200;
  let p = sharp(src.data, { raw: { width: W, height: H, channels: src.channels } }).extract({ left, top, width, height });
  const long = Math.max(width, height);
  if (long !== target) {
    p = p.resize(Math.round((width * target) / long), Math.round((height * target) / long), {
      kernel: long < target ? "nearest" : "lanczos3",
    });
  }
  if (opts.threshold != null) p = p.grayscale().threshold(opts.threshold);
  return rawRgba(p);
}

/** Grayscale, normalized, upscaled (long side >= 1800) and sharpened PNG for tesseract. */
export async function toOcrPng(buf: Buffer): Promise<Buffer> {
  const meta = await sharp(buf).rotate().toBuffer({ resolveWithObject: true });
  const { width, height } = meta.info;
  const minWidth = 1400;
  let p = sharp(meta.data).grayscale();
  if (width < minWidth) {
    p = p.resize(minWidth, Math.round((height * minWidth) / width), { kernel: "lanczos3" });
  } else if (width > 2400) {
    p = p.resize(2400, null, { kernel: "lanczos3" });
  }
  return p.normalize().sharpen().png().toBuffer();
}
