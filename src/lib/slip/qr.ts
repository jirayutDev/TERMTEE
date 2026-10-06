/**
 * Thai bank slip "mini QR" decoding and parsing.
 *
 * Payload is EMVCo-style TLV (2-char tag, 2-digit decimal length, value):
 *   00 -> sub-TLV: 00 = API id (e.g. "000001"), 01 = sending bank code (3 digits), 02 = transaction ref
 *   51 -> country code "TH"
 *   91 -> CRC16-CCITT (poly 0x1021, init 0xFFFF) over everything up to and including "9104", 4 hex chars
 * PromptPay *payment* QRs (tag 29/30 merchant info, tag 00 = "01") are not slips and are ignored.
 */
import jsQR from "jsqr";
import { cropRgba, orientRaw, toRgba, type CropRect, type OrientedRaw, type RgbaImage } from "./image";

export interface TlvField {
  tag: string;
  value: string;
}

/** Parse a flat TLV string. Returns null if the structure is malformed. */
export function parseTlv(s: string): TlvField[] | null {
  const out: TlvField[] = [];
  let i = 0;
  while (i < s.length) {
    if (i + 4 > s.length) return null;
    const tag = s.slice(i, i + 2);
    const lenStr = s.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(lenStr)) return null;
    const len = Number(lenStr);
    const value = s.slice(i + 4, i + 4 + len);
    if (value.length !== len) return null;
    out.push({ tag, value });
    i += 4 + len;
  }
  return out;
}

/** CRC16-CCITT (FALSE): poly 0x1021, init 0xFFFF, no reflection, no xorout. Returns 4 uppercase hex chars. */
export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  const bytes = Buffer.from(input, "utf8");
  for (const b of bytes) {
    crc ^= b << 8;
    for (let k = 0; k < 8; k++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export interface SlipQrInfo {
  isSlip: boolean; // looks like a bank slip mini-QR (not a PromptPay payment QR)
  apiId: string | null;
  sendingBank: string | null;
  transRef: string | null; // null when CRC is invalid
  countryCode: string | null;
  crcValid: boolean;
}

const NOT_SLIP: SlipQrInfo = {
  isSlip: false,
  apiId: null,
  sendingBank: null,
  transRef: null,
  countryCode: null,
  crcValid: false,
};

/** Parse a decoded QR string as a Thai bank slip mini-QR. Never throws. */
export function parseSlipQr(payload: string): SlipQrInfo {
  const p = payload.trim();
  const fields = parseTlv(p);
  if (!fields || fields.length === 0) return NOT_SLIP;
  const get = (tag: string) => fields.find((f) => f.tag === tag)?.value ?? null;

  // PromptPay / EMV merchant-presented payment QR -> not a slip
  if (get("29") !== null || get("30") !== null) return NOT_SLIP;

  const t00 = get("00");
  if (!t00) return NOT_SLIP;
  const sub = parseTlv(t00);
  if (!sub) return NOT_SLIP;
  const subGet = (tag: string) => sub.find((f) => f.tag === tag)?.value ?? null;
  const apiId = subGet("00");
  const sendingBank = subGet("01");
  const ref = subGet("02");
  if (!ref) return NOT_SLIP;

  const crcVal = get("91");
  let crcValid = false;
  const crcIdx = p.lastIndexOf("9104");
  if (crcVal && crcVal.length === 4 && crcIdx >= 0 && crcIdx + 8 === p.length) {
    crcValid = crc16ccitt(p.slice(0, crcIdx + 4)) === crcVal.toUpperCase();
  }

  return {
    isSlip: true,
    apiId,
    sendingBank: sendingBank && /^\d{3}$/.test(sendingBank) ? sendingBank : null,
    transRef: crcValid ? ref : null,
    countryCode: get("51"),
    crcValid,
  };
}

function tryDecode(img: RgbaImage, invert: boolean): string | null {
  const r = jsQR(img.data, img.width, img.height, {
    inversionAttempts: invert ? "attemptBoth" : "dontInvert",
  });
  return r?.data ? r.data : null;
}

// Regions where slip QRs usually sit (fractions of the oriented image).
const CROPS: CropRect[] = [
  { left: 0.5, top: 0.5, width: 0.5, height: 0.5 }, // bottom-right (KBank, SCB, KTB ...)
  { left: 0, top: 0.5, width: 1, height: 0.5 }, // bottom half
  { left: 0.5, top: 0, width: 0.5, height: 0.5 }, // top-right
  { left: 0, top: 0.5, width: 0.5, height: 0.5 }, // bottom-left
  { left: 0, top: 0, width: 1, height: 0.5 }, // top half
  { left: 0.25, top: 0.6, width: 0.5, height: 0.4 }, // bottom-center
  { left: 0.6, top: 0.65, width: 0.4, height: 0.35 }, // small bottom-right corner
];

/**
 * Find a QR in a slip image. Tries the whole image, then cropped/upscaled and thresholded
 * variants. Prefers a payload that parses as a slip mini-QR; otherwise returns the first QR
 * found (e.g. someone uploaded a PromptPay QR), or null.
 */
export async function decodeSlipQr(buf: Buffer): Promise<string | null> {
  let fallback: string | null = null;
  const consider = (s: string | null): string | null => {
    if (!s) return null;
    if (parseSlipQr(s).isSlip) return s;
    fallback ??= s;
    return null;
  };

  let oriented: OrientedRaw;
  try {
    const full = await toRgba(buf, 2000);
    const hit = consider(tryDecode(full, true));
    if (hit) return hit;
    oriented = await orientRaw(buf);
  } catch {
    return fallback;
  }

  for (const rect of CROPS) {
    for (const opt of [{ threshold: null }, { threshold: 140 }] as const) {
      try {
        const img = await cropRgba(oriented, rect, { targetSide: 1000, threshold: opt.threshold });
        const hit = consider(tryDecode(img, false));
        if (hit) return hit;
      } catch {
        // ignore this variant
      }
    }
  }
  return fallback;
}
