/**
 * Optional paid slip verifier that confirms the transfer with the bank network.
 *
 * SLIP_PROVIDER = "none" (default) | one name | comma-separated failover order,
 *   e.g. "slip2go,thunder": try slip2go; if it throws (down, quota, ...) try thunder.
 *   A provider that just failed is skipped for PROVIDER_COOLDOWN_MS.
 *   Names: "slip2go" | "thunder" | "easyslip"
 *
 * Contract with the payment route: return { ok: false } only when the provider positively
 * says the slip is bad (not found / fake / duplicate). Throw on transport, auth, quota,
 * rate-limit and server errors so the route falls back to local checks instead of
 * rejecting a customer because the provider is down.
 *
 * easyslip: EasySlip API v2 (https://document.easyslip.com/en/v2/)
 *   POST https://api.easyslip.com/v2/verify/bank, Authorization: Bearer <EASYSLIP_API_KEY>
 *   body: JSON { payload } when we decoded the slip QR, otherwise multipart "image" (max 4 MB).
 *   Success: { success: true, data: { rawSlip: { transRef, date, amount: { amount }, receiver: {...} } } }
 *   Error:   { success: false, error: { code, message } }  (e.g. 404 SLIP_NOT_FOUND)
 *   Env: EASYSLIP_API_KEY (required), EASYSLIP_TIMEOUT_MS (default 15000)
 *
 * thunder: Thunder Solution API v2 (https://document.thunder.in.th/th/v2/verify/bank/)
 *   Same request/response shape as EasySlip v2: POST https://api.thunder.in.th/v2/verify/bank,
 *   JSON { payload } or multipart "image" (max 4 MB); errors { success:false, error:{ code } }
 *   (401 key, 403 quota/ban/IP, 404 SLIP_NOT_FOUND, 500 server).
 *   Env: THUNDER_API_KEY (required), THUNDER_TIMEOUT_MS (default 15000)
 *
 * slip2go: Slip2Go REST API (https://slip2go.com/guide/rest-api/qr-code, /guide/response)
 *   POST {SLIP2GO_API_URL}/api/verify-slip/qr-code/info   JSON { payload: { qrCode, checkCondition } }
 *   POST {SLIP2GO_API_URL}/api/verify-slip/qr-image/info  multipart "file" (png/jpg) + "payload" JSON
 *   Authorization: Bearer <SLIP2GO_SECRET_KEY>. The API base URL is not in the public docs;
 *   copy it from the Slip2Go dashboard (app.slip2go.com).
 *   Success: { code: "200000" | "200200", data: { transRef, dateTime, amount, receiver: { account: {...} } } }
 *   Bad slip: 200404 not found, 200500 fraud, 200501 duplicate (HTTP 200).
 *   Env: SLIP2GO_API_URL, SLIP2GO_SECRET_KEY (required), SLIP2GO_TIMEOUT_MS (default 15000)
 *
 * Other providers (SlipOK, ...) are not implemented: their APIs were not verified.
 */
import sharp from "sharp";
import type { SlipProvider } from "./types";

type VerifyResult = Awaited<ReturnType<SlipProvider["verify"]>>;

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function path(v: unknown, ...keys: string[]): unknown {
  let cur: unknown = v;
  for (const k of keys) {
    const o = obj(cur);
    if (!o) return undefined;
    cur = o[k];
  }
  return cur;
}

/** Map an EasySlip v2 / Thunder v2 response body to the provider result. Exported for tests. */
export function mapEasySlipResponse(body: unknown, httpStatus: number): VerifyResult {
  if (path(body, "success") !== true) {
    const code = str(path(body, "error", "code")) ?? `HTTP_${httpStatus}`;
    // Only "slip not found" is a verdict on the slip. Auth, quota, IP, validation, rate limit
    // and server errors throw so the caller tries the next provider / local checks.
    if (code === "SLIP_NOT_FOUND") return { ok: false, reason: "ไม่พบรายการโอนนี้ในระบบธนาคาร" };
    throw new Error(`HTTP ${httpStatus} ${code}: ${str(path(body, "error", "message")) ?? ""}`);
  }
  if (path(body, "data", "isDuplicate") === true) return { ok: false, reason: "สลิปนี้ถูกใช้ไปแล้ว" };
  const raw = path(body, "data", "rawSlip");
  const transRef = str(path(raw, "transRef"));
  const amount = path(raw, "amount", "amount");
  const date = str(path(raw, "date"));
  const at = date ? new Date(date) : null;
  if (!transRef || typeof amount !== "number" || !at || Number.isNaN(at.getTime())) {
    return { ok: false, reason: "INVALID_RESPONSE: ข้อมูลจากผู้ให้บริการไม่ครบ" };
  }
  const recvAcc = path(raw, "receiver", "account");
  return {
    ok: true,
    transRef,
    amountSatang: Math.round(amount * 100),
    transferredAt: at,
    receiverAccount: str(path(recvAcc, "bank", "account")) ?? str(path(recvAcc, "proxy", "account")),
    receiverName: str(path(recvAcc, "name", "th")) ?? str(path(recvAcc, "name", "en")),
  };
}

/** EasySlip v2 and Thunder v2 share the same API shape; only host, name and key differ. */
function easySlipShapedProvider(name: string, endpoint: string, apiKey: string, timeoutEnv: string): SlipProvider {
  return {
    name,
    async verify({ image, qrPayload }) {
      const timeout = Number(process.env[timeoutEnv]) || 15_000;
      const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
      let body: BodyInit;
      if (qrPayload) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify({ payload: qrPayload });
      } else {
        const fd = new FormData();
        fd.append("image", new Blob([new Uint8Array(image)]), "slip");
        body = fd;
      }
      // Network errors throw -> caller falls back.
      const res = await fetch(endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(timeout) });
      const json: unknown = await res.json().catch(() => null);
      return mapEasySlipResponse(json, res.status);
    },
  };
}

/** Slip2Go result codes that mean "the slip itself is bad" -> customer-facing Thai reason. */
const SLIP2GO_BAD_SLIP: Record<string, string> = {
  "200404": "ไม่พบรายการโอนนี้ในระบบธนาคาร",
  "200500": "สลิปไม่ถูกต้องหรือเป็นสลิปปลอม",
  "200501": "สลิปนี้ถูกใช้ไปแล้ว",
};

/**
 * Map a Slip2Go response body to the provider result. Throws for errors that are not a
 * verdict on the slip (auth, quota, rate limit, server, unexpected codes). Exported for tests.
 */
export function mapSlip2GoResponse(body: unknown, httpStatus: number): VerifyResult {
  const code = str(path(body, "code")) ?? "";
  if (code in SLIP2GO_BAD_SLIP) return { ok: false, reason: SLIP2GO_BAD_SLIP[code] };
  if (code !== "200000" && code !== "200200") {
    throw new Error(`slip2go HTTP ${httpStatus} code ${code || "?"}: ${str(path(body, "message")) ?? ""}`);
  }
  const data = path(body, "data");
  const transRef = str(path(data, "transRef"));
  const amount = path(data, "amount");
  const dateTime = str(path(data, "dateTime"));
  const at = dateTime ? new Date(dateTime) : null;
  if (!transRef || typeof amount !== "number" || !at || Number.isNaN(at.getTime())) {
    throw new Error("slip2go returned an incomplete slip");
  }
  const recvAcc = path(data, "receiver", "account");
  return {
    ok: true,
    transRef,
    amountSatang: Math.round(amount * 100),
    transferredAt: at,
    receiverAccount: str(path(recvAcc, "bank", "account")) ?? str(path(recvAcc, "proxy", "account")),
    receiverName: str(path(recvAcc, "name")),
  };
}

function slip2GoProvider(apiUrl: string, secret: string): SlipProvider {
  const base = apiUrl.replace(/\/+$/, "");
  // Our own duplicate checks stay authoritative; this adds Slip2Go's history for our account.
  const checkCondition = { checkDuplicate: true };
  return {
    name: "slip2go",
    async verify({ image, qrPayload }) {
      const timeout = Number(process.env.SLIP2GO_TIMEOUT_MS) || 15_000;
      const headers: Record<string, string> = { Authorization: `Bearer ${secret}` };
      let url: string;
      let body: BodyInit;
      if (qrPayload) {
        url = `${base}/api/verify-slip/qr-code/info`;
        headers["Content-Type"] = "application/json";
        body = JSON.stringify({ payload: { qrCode: qrPayload, checkCondition } });
      } else {
        // Image endpoint accepts png/jpg only; normalize (WebP uploads are allowed on our side).
        url = `${base}/api/verify-slip/qr-image/info`;
        const jpeg = await sharp(image).rotate().jpeg({ quality: 92 }).toBuffer();
        const fd = new FormData();
        fd.append("file", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "slip.jpg");
        fd.append("payload", JSON.stringify({ checkCondition }));
        body = fd;
      }
      // Network errors and non-verdict responses throw -> caller falls back to local checks.
      const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeout) });
      const json: unknown = await res.json().catch(() => null);
      return mapSlip2GoResponse(json, res.status);
    },
  };
}

function buildProvider(name: string): SlipProvider | null {
  const env = process.env;
  switch (name) {
    case "easyslip":
      if (env.EASYSLIP_API_KEY) {
        return easySlipShapedProvider("easyslip", "https://api.easyslip.com/v2/verify/bank", env.EASYSLIP_API_KEY, "EASYSLIP_TIMEOUT_MS");
      }
      console.warn("[slip] easyslip: EASYSLIP_API_KEY is not set; skipped");
      return null;
    case "thunder":
      if (env.THUNDER_API_KEY) {
        return easySlipShapedProvider("thunder", "https://api.thunder.in.th/v2/verify/bank", env.THUNDER_API_KEY, "THUNDER_TIMEOUT_MS");
      }
      console.warn("[slip] thunder: THUNDER_API_KEY is not set; skipped");
      return null;
    case "slip2go":
      if (env.SLIP2GO_API_URL && env.SLIP2GO_SECRET_KEY) return slip2GoProvider(env.SLIP2GO_API_URL, env.SLIP2GO_SECRET_KEY);
      console.warn("[slip] slip2go: SLIP2GO_API_URL / SLIP2GO_SECRET_KEY is not set; skipped");
      return null;
    default:
      console.warn(`[slip] unknown provider "${name}"; skipped`);
      return null;
  }
}

const PROVIDER_COOLDOWN_MS = 60_000;
// Per process: provider name -> time until which it is skipped after a failure.
const cooldownUntil = new Map<string, number>();

/**
 * Tries providers in order and returns the first verdict. A provider that throws is put on
 * cooldown and the next one is tried; if all are cooling down they are tried anyway.
 * Throws when no provider gave a verdict. Exported for tests.
 */
export function failoverProvider(providers: SlipProvider[], now: () => number = Date.now): SlipProvider {
  return {
    name: providers.map((p) => p.name).join(">"),
    async verify(input) {
      const ready = providers.filter((p) => (cooldownUntil.get(p.name) ?? 0) <= now());
      const order = ready.length > 0 ? ready : providers;
      const errors: string[] = [];
      for (const p of order) {
        try {
          const res = await p.verify(input);
          cooldownUntil.delete(p.name);
          return { ...res, via: p.name };
        } catch (e) {
          cooldownUntil.set(p.name, now() + PROVIDER_COOLDOWN_MS);
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[slip] provider ${p.name} failed, trying next: ${msg}`);
          errors.push(`${p.name}: ${msg}`);
        }
      }
      throw new Error(`all slip providers failed (${errors.join("; ")})`);
    },
  };
}

/** Configured provider (with failover when several are listed), or null for "none"/unset. */
export function getSlipProvider(): SlipProvider | null {
  const names = (process.env.SLIP_PROVIDER ?? "none")
    .split(",")
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n !== "" && n !== "none");
  const providers = [...new Set(names)].map(buildProvider).filter((p): p is SlipProvider => p !== null);
  if (providers.length === 0) return null;
  return providers.length === 1 ? providers[0] : failoverProvider(providers);
}
