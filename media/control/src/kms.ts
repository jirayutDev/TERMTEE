/**
 * Content key acquisition from PallyCon KMS via CPIX (SPEKE-style key request).
 *
 * TODO(verify): the request/response shape below follows the DASH-IF CPIX 2.x schema as used by
 * PallyCon's "CPIX API" (POST {PALLYCON_KMS_URL}/{PALLYCON_KMS_TOKEN}, body = CPIX XML, `id` = content id).
 * Before going live, verify against the current PallyCon docs:
 *   - exact endpoint path and whether the KMS token goes in the path or a header
 *   - whether PallyCon honours the client-supplied `kid` or returns its own (we read it back either way)
 *   - FairPlay key URI format (we use URIExtXKey from the response, fallback `skd://<contentId>`)
 *   - whether PallyCon's own PSSH boxes must be used instead of packager-generated ones
 *     (packager is run with --protection_systems; switch to --pssh if license requests fail)
 */
import { randomBytes, randomUUID } from "node:crypto";
import { config } from "./config.js";

export interface ContentKey {
  keyIdHex: string; // 16 bytes hex
  keyHex: string; // 16 bytes hex
  ivHex?: string; // explicit IV if the KMS provides one
  fairplayKeyUri: string; // HLS EXT-X-KEY URI for FairPlay (skd://...)
}

const SYSTEM_IDS = {
  widevine: "edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",
  playready: "9a04f079-9840-4286-ab92-e65be0885f95",
  fairplay: "94ce86fb-07ff-4f43-adb8-93d2fa968ca2",
};

export async function getContentKey(contentId: string): Promise<ContentKey> {
  if (!config.pallyconKmsToken) {
    if (config.devKeyId && config.devKey) {
      console.warn("[kms] PALLYCON_KMS_TOKEN not set, using DRM_DEV_KEY_* (testing only)");
      return {
        keyIdHex: config.devKeyId,
        keyHex: config.devKey,
        fairplayKeyUri: `skd://${contentId}`,
      };
    }
    throw new Error("PALLYCON_KMS_TOKEN is not configured");
  }

  const kid = randomUUID();
  const body = buildCpixRequest(contentId, kid);
  const url = `${config.pallyconKmsUrl.replace(/\/$/, "")}/${encodeURIComponent(config.pallyconKmsToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`KMS ${res.status}: ${text.slice(0, 300)}`);
  return parseCpixResponse(text, contentId);
}

function buildCpixRequest(contentId: string, kid: string): string {
  const drm = Object.values(SYSTEM_IDS)
    .map((sid) => `    <cpix:DRMSystem kid="${kid}" systemId="${sid}"/>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<cpix:CPIX id="${xmlEscape(contentId)}" xmlns:cpix="urn:dashif:org:cpix" xmlns:pskc="urn:ietf:params:xml:ns:keyprov:pskc" xmlns:speke="urn:aws:amazon:com:speke">
  <cpix:ContentKeyList>
    <cpix:ContentKey kid="${kid}"/>
  </cpix:ContentKeyList>
  <cpix:DRMSystemList>
${drm}
  </cpix:DRMSystemList>
</cpix:CPIX>`;
}

// Namespace-prefix tolerant regex helpers (avoids an XML dependency for a fixed, small document).
const tag = (name: string) => `(?:[\\w-]+:)?${name}`;

function parseCpixResponse(xml: string, contentId: string): ContentKey {
  const ck = new RegExp(`<${tag("ContentKey")}\\b([^>]*)>([\\s\\S]*?)</${tag("ContentKey")}>`).exec(xml);
  if (!ck) throw new Error("KMS response has no ContentKey");
  const attrs = ck[1] ?? "";
  const kid = /\bkid="([^"]+)"/.exec(attrs)?.[1];
  const iv = /\bexplicitIV="([^"]+)"/.exec(attrs)?.[1];
  const plain = new RegExp(`<${tag("PlainValue")}>([^<]+)</${tag("PlainValue")}>`).exec(ck[2] ?? "")?.[1];
  if (!kid || !plain) throw new Error("KMS response missing kid or key value");

  const keyHex = Buffer.from(plain.trim(), "base64").toString("hex");
  if (keyHex.length !== 32) throw new Error("KMS key is not 16 bytes");

  let fairplayKeyUri = `skd://${contentId}`;
  const fpBlock = new RegExp(
    `<${tag("DRMSystem")}\\b[^>]*systemId="${SYSTEM_IDS.fairplay}"[^>]*>([\\s\\S]*?)</${tag("DRMSystem")}>`,
    "i",
  ).exec(xml)?.[1];
  const uriB64 = fpBlock && new RegExp(`<${tag("URIExtXKey")}>([^<]+)</`).exec(fpBlock)?.[1];
  if (uriB64) fairplayKeyUri = Buffer.from(uriB64.trim(), "base64").toString("utf8").trim();

  return {
    keyIdHex: kid.replace(/-/g, "").toLowerCase(),
    keyHex,
    ivHex: iv ? Buffer.from(iv, "base64").toString("hex") : undefined,
    fairplayKeyUri,
  };
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Random key for manual experiments: `node -e "import('./dist/kms.js').then(m=>console.log(m.randomDevKey()))"` */
export function randomDevKey(): { keyId: string; key: string } {
  return { keyId: randomBytes(16).toString("hex"), key: randomBytes(16).toString("hex") };
}
