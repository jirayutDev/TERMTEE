import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Private storage for uploaded transfer slips. Slips contain personal banking
 * data, so they must never be served from public/ — only via the admin route.
 * Replace `localStorage` with an S3/R2 implementation of the same interface.
 */
export interface SlipStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
}

const EXT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  bin: "application/octet-stream",
};

/** Detects the image type from magic bytes (never trust the client's filename / MIME). */
export function sniffImage(buf: Buffer): { ext: string; contentType: string } {
  let ext = "bin";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = "jpg";
  else if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    ext = "png";
  else if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    ext = "webp";
  else if (buf.length >= 6 && buf.toString("ascii", 0, 3) === "GIF") ext = "gif";
  else if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") ext = "heic";
  return { ext, contentType: EXT_TYPES[ext] };
}

export function contentTypeForKey(key: string): string {
  return EXT_TYPES[path.extname(key).slice(1).toLowerCase()] ?? EXT_TYPES.bin;
}

/** Storage key = sha256 hash + extension (content addressed, so re-uploads overwrite identically). */
export function slipKey(hash: string, buf: Buffer): string {
  return `${hash}.${sniffImage(buf).ext}`;
}

const SAFE_KEY = /^[a-f0-9]{64}\.[a-z]{2,5}$/;

class LocalSlipStorage implements SlipStorage {
  // Runtime-configured dir: keep the bundler from tracing the whole project.
  private readonly dir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.SLIP_STORAGE_DIR || "storage/slips");

  private file(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error(`invalid slip key: ${key}`);
    return path.join(this.dir, key);
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.file(key);
    await mkdir(this.dir, { recursive: true });
    await writeFile(file, body);
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    try {
      const body = await readFile(this.file(key));
      return { body, contentType: contentTypeForKey(key) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}

let storage: SlipStorage | null = null;

export function getSlipStorage(): SlipStorage {
  storage ??= new LocalSlipStorage();
  return storage;
}
