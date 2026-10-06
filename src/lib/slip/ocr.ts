/**
 * OCR with tesseract.js ("tha+eng"), one lazily created worker reused per process.
 *
 * NETWORK ON FIRST RUN: tesseract.js downloads tha/eng .traineddata (~ a few MB, from the
 * jsDelivr CDN @tesseract.js-data) the first time the worker starts, then caches them in
 *   SLIP_OCR_CACHE_DIR (default: <os.tmpdir()>/termtee-tessdata).
 * For offline servers, pre-populate that dir with tha.traineddata + eng.traineddata, or set
 * SLIP_OCR_LANG_PATH to a local directory/URL containing tha.traineddata.gz + eng.traineddata.gz.
 *
 * Env:
 *   SLIP_OCR_CACHE_DIR   cache dir for traineddata (optional)
 *   SLIP_OCR_LANG_PATH   override download location (optional)
 *   SLIP_OCR_TIMEOUT_MS  per-image recognize timeout, default 20000
 */
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";

const INIT_TIMEOUT_MS = 90_000; // first start may download traineddata

let workerPromise: Promise<Worker> | null = null;

export function ocrCacheDir(): string {
  return process.env.SLIP_OCR_CACHE_DIR || path.join(os.tmpdir(), "termtee-tessdata");
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

async function startWorker(): Promise<Worker> {
  const cachePath = ocrCacheDir();
  await mkdir(cachePath, { recursive: true });
  const worker = await createWorker(["tha", "eng"], 1 /* OEM.LSTM_ONLY */, {
    cachePath,
    ...(process.env.SLIP_OCR_LANG_PATH ? { langPath: process.env.SLIP_OCR_LANG_PATH } : {}),
    logger: () => {},
    errorHandler: (e: unknown) => console.error("[slip/ocr] worker error", e),
  });
  await worker.setParameters({ preserve_interword_spaces: "1" });
  return worker;
}

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = withTimeout(startWorker(), INIT_TIMEOUT_MS, "OCR worker init").catch((e) => {
      workerPromise = null; // allow retry on next call
      throw e;
    });
  }
  return workerPromise;
}

/** Terminate and forget the worker (after a timeout, or on shutdown). */
export async function resetOcrWorker(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  if (!p) return;
  try {
    await (await p).terminate();
  } catch {
    // already dead
  }
}

/** Run OCR on a preprocessed image (see toOcrPng). Throws on timeout/failure. */
export async function ocrImage(png: Buffer): Promise<string> {
  const timeout = Number(process.env.SLIP_OCR_TIMEOUT_MS) || 20_000;
  const worker = await getWorker();
  try {
    const res = await withTimeout(worker.recognize(png), timeout, "OCR");
    return res.data.text ?? "";
  } catch (e) {
    // A stuck worker would block every following job: throw it away.
    await resetOcrWorker();
    throw e;
  }
}
