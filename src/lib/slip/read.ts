/**
 * readSlip: QR + OCR + text parsing -> SlipData.
 * (Kept separate from index.ts so scripts/tests can import it without "server-only".)
 */
import { toOcrPng } from "./image";
import { ocrImage } from "./ocr";
import { parseSlipText } from "./parse";
import { decodeSlipQr, parseSlipQr } from "./qr";
import type { SlipData } from "./types";

export interface ReadSlipOptions {
  /** Skip OCR (QR only). */
  skipOcr?: boolean;
  now?: Date;
}

/** Read a validated slip image. Never throws for unreadable content; fields are null instead. */
export async function readSlip(buf: Buffer, opts: ReadSlipOptions = {}): Promise<SlipData> {
  const qrTask = decodeSlipQr(buf).catch((e) => {
    console.error("[slip] QR decode failed", e);
    return null;
  });
  const ocrTask: Promise<string> = opts.skipOcr
    ? Promise.resolve("")
    : toOcrPng(buf)
        .then(ocrImage)
        .catch((e) => {
          console.error("[slip] OCR failed", e);
          return "";
        });

  const [qrPayload, ocrText] = await Promise.all([qrTask, ocrTask]);
  const qr = qrPayload ? parseSlipQr(qrPayload) : null;
  const parsed = parseSlipText(ocrText, { now: opts.now });

  return {
    qrPayload,
    transRef: qr?.transRef ?? null,
    sendingBank: qr?.sendingBank ?? null,
    amountSatang: parsed.amountSatang,
    transferredAt: parsed.transferredAt,
    receiverName: parsed.receiverName,
    receiverAccount: parsed.receiverAccount,
    ocrText,
  };
}
