/**
 * Compare data read from a slip with the order. Pure function, no I/O.
 *
 * Decision: any check "fail" -> REJECTED; amount+time+receiver+qr all "pass" -> VERIFIED;
 * otherwise NEEDS_REVIEW (admin looks at the slip).
 */
import type { ExpectedPayment, SlipCheckResult, SlipData, SlipDecision, SlipEvaluation } from "./types";

const MIN = 60_000;
const ORDER_SKEW_MS = 10 * MIN; // slip may be up to 10 min before order creation (clock skew)
const FUTURE_SKEW_MS = 5 * MIN;
const MAX_AGE_MS = 24 * 60 * MIN;

export interface EvaluateOptions {
  duplicateTransRef?: boolean;
  now?: Date; // for tests
}

export function formatBaht(satang: number): string {
  return (satang / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatBangkok(d: Date): string {
  return d.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });
}

// ---------------------------------------------------------------------------
// Account / name matching
// ---------------------------------------------------------------------------

/** Digits-only form of a configured account / PromptPay id (+66 phone -> 0...). */
export function normalizeFullAccount(acc: string): string {
  let d = acc.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("66")) d = "0" + d.slice(2); // +66 8x xxx xxxx
  if (d.length === 13 && d.startsWith("0066")) d = "0" + d.slice(4);
  return d;
}

/** Masked form as [0-9x] characters, e.g. "xxx-x-x5678-x" -> "xxxxx5678x". */
export function normalizeMaskedAccount(masked: string): string {
  return masked
    .replace(/[X*•]/g, "x")
    .replace(/[^0-9x]/g, "");
}

export type MatchResult = "match" | "mismatch" | "unknown";

/**
 * Compare a masked account (as printed) with a full account. Only visible digits are compared,
 * aligned from the right. Needs >= 3 visible digits to say "match".
 */
export function matchMaskedAccount(masked: string, full: string): MatchResult {
  const m = normalizeMaskedAccount(masked);
  const f = normalizeFullAccount(full);
  const visible = (m.match(/\d/g) ?? []).length;
  if (visible < 3 || f.length === 0) return "unknown";
  if (m.length > f.length) {
    // e.g. 15-digit e-wallet id vs 10-digit account: compare tail only if the extra part is masked
    const extra = m.slice(0, m.length - f.length);
    if (/\d/.test(extra)) return "mismatch";
  }
  const mm = m.slice(-f.length);
  const ff = f.slice(-mm.length);
  for (let i = 0; i < mm.length; i++) {
    if (mm[i] !== "x" && mm[i] !== ff[i]) return "mismatch";
  }
  return "match";
}

const NAME_TITLES = [
  // Thai personal titles
  "นางสาว",
  "น.ส.",
  "นส.",
  "นาย",
  "นาง",
  "ด.ช.",
  "ด.ญ.",
  // Thai company forms
  "ห้างหุ้นส่วนจำกัด",
  "หจก.",
  "บริษัทมหาชน",
  "บริษัท",
  "บจก.",
  "บมจ.",
  "(มหาชน)",
  "มหาชน",
  "จำกัด",
  "จก.",
  // English
  "public company limited",
  "company limited",
  "co., ltd.",
  "co.,ltd.",
  "co.,ltd",
  "co., ltd",
  "co. ltd",
  "co ltd",
  "pcl.",
  "pcl",
  "ltd.",
  "ltd",
  "limited",
  "company",
  "mrs.",
  "mrs",
  "miss",
  "mr.",
  "mr",
  "ms.",
  "ms",
].sort((a, b) => b.length - a.length);

/** Lowercase, strip titles/company forms, punctuation and spaces. */
export function normalizeName(name: string): string {
  let s = name.normalize("NFC").toLowerCase().replace(/ํา/g, "ำ");
  // cut at masking / truncation marks: "สมชาย ใ***", "เทอมตี เอ็นเ..."
  s = s.replace(/[*x]{2,}.*$/, "").replace(/(\.\.\.|…).*$/, "");
  for (const t of NAME_TITLES) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
    const latin = /^[a-z]/.test(t);
    s = s.replace(new RegExp(latin ? `(^|[^a-z])${esc}(?=$|[^a-z])` : esc, "g"), latin ? "$1 " : " ");
  }
  return s.replace(/[^a-z0-9฀-๿]/g, "");
}

function similarity(a: string, b: string): number {
  // Levenshtein ratio
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

/** Fuzzy name compare that tolerates truncation (slip shows a prefix) and light OCR noise. */
export function matchName(slipName: string, expected: string): MatchResult {
  const s = normalizeName(slipName);
  const e = normalizeName(expected);
  if (s.length < 3 || e.length < 3) return "unknown";
  if (e.includes(s) || s.includes(e)) return "match";
  // truncated + noisy: compare against the expected prefix of the same length
  const prefix = e.slice(0, s.length);
  if (s.length >= 4 && similarity(s, prefix) >= 0.8) return "match";
  if (similarity(s, e) >= 0.8) return "match";
  return "mismatch";
}

function bestOf(results: MatchResult[]): MatchResult {
  if (results.includes("match")) return "match";
  if (results.includes("mismatch")) return "mismatch";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkDuplicate(data: SlipData, dup: boolean | undefined): SlipCheckResult {
  if (dup) return { name: "duplicate", result: "fail", detail: "สลิปนี้ถูกใช้ไปแล้ว" };
  if (data.transRef) return { name: "duplicate", result: "pass", detail: "ไม่พบเลขอ้างอิงนี้ในระบบ" };
  return { name: "duplicate", result: "unknown", detail: "ไม่มีเลขอ้างอิงจาก QR ใช้ตรวจสลิปซ้ำได้เฉพาะจากไฟล์" };
}

function checkAmount(data: SlipData, exp: ExpectedPayment): SlipCheckResult {
  if (data.amountSatang == null) {
    return { name: "amount", result: "unknown", detail: "อ่านยอดเงินจากสลิปไม่ได้" };
  }
  if (data.amountSatang !== exp.amountSatang) {
    return {
      name: "amount",
      result: "fail",
      detail: `ยอดเงินในสลิป ${formatBaht(data.amountSatang)} บาท ไม่ตรงกับยอดที่ต้องชำระ ${formatBaht(exp.amountSatang)} บาท`,
    };
  }
  return { name: "amount", result: "pass", detail: `ยอดเงินตรงกัน ${formatBaht(data.amountSatang)} บาท` };
}

function checkTime(data: SlipData, exp: ExpectedPayment, now: Date): SlipCheckResult {
  const t = data.transferredAt;
  if (!t || Number.isNaN(t.getTime())) {
    return { name: "time", result: "unknown", detail: "อ่านวันเวลาโอนจากสลิปไม่ได้" };
  }
  const when = formatBangkok(t);
  if (t.getTime() < exp.orderCreatedAt.getTime() - ORDER_SKEW_MS) {
    return { name: "time", result: "fail", detail: `เวลาโอนในสลิป (${when}) อยู่ก่อนการสั่งซื้อ` };
  }
  if (t.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    return { name: "time", result: "fail", detail: `เวลาโอนในสลิป (${when}) อยู่ในอนาคต` };
  }
  if (now.getTime() - t.getTime() > MAX_AGE_MS) {
    return { name: "time", result: "fail", detail: `สลิปเก่าเกิน 24 ชั่วโมง (${when})` };
  }
  return { name: "time", result: "pass", detail: `เวลาโอน ${when}` };
}

function checkReceiver(data: SlipData, exp: ExpectedPayment): SlipCheckResult {
  if (exp.receiverAccounts.length === 0 && exp.receiverNames.length === 0) {
    return { name: "receiver", result: "unknown", detail: "ยังไม่ได้ตั้งค่าบัญชีรับเงิน (ตั้งค่า → รับเงินและตรวจสลิป)" };
  }
  const acc: MatchResult =
    data.receiverAccount && exp.receiverAccounts.length
      ? bestOf(exp.receiverAccounts.map((a) => matchMaskedAccount(data.receiverAccount!, a)))
      : "unknown";
  const name: MatchResult =
    data.receiverName && exp.receiverNames.length
      ? bestOf(exp.receiverNames.map((n) => matchName(data.receiverName!, n)))
      : "unknown";

  const shown = [data.receiverName, data.receiverAccount].filter(Boolean).join(" ");
  if (acc === "mismatch" && name === "mismatch") {
    return { name: "receiver", result: "fail", detail: `บัญชีผู้รับในสลิป (${shown}) ไม่ใช่บัญชีของเรา` };
  }
  if ((acc === "mismatch" && name === "unknown") || (name === "mismatch" && acc === "unknown")) {
    const what = acc === "mismatch" ? "เลขบัญชีผู้รับ" : "ชื่อผู้รับ";
    return { name: "receiver", result: "fail", detail: `${what}ในสลิป (${shown}) ไม่ตรงกับบัญชีรับเงินของเรา` };
  }
  if (acc === "mismatch" || name === "mismatch") {
    // one matches, the other contradicts: likely OCR error, let an admin decide
    return { name: "receiver", result: "unknown", detail: `ข้อมูลผู้รับขัดกัน (${shown}) ชื่อหรือเลขบัญชีตรงเพียงอย่างเดียว` };
  }
  if (acc === "match" || name === "match") {
    const parts = [acc === "match" ? "เลขบัญชี" : null, name === "match" ? "ชื่อ" : null].filter(Boolean).join("และ");
    return { name: "receiver", result: "pass", detail: `${parts}ผู้รับตรงกับบัญชีของเรา (${shown})` };
  }
  return { name: "receiver", result: "unknown", detail: "อ่านข้อมูลผู้รับจากสลิปไม่ได้" };
}

function checkQr(data: SlipData): SlipCheckResult {
  if (data.transRef) {
    return { name: "qr", result: "pass", detail: `QR สลิปถูกต้อง เลขอ้างอิง ${data.transRef}` };
  }
  if (data.qrPayload) {
    return { name: "qr", result: "unknown", detail: "พบ QR แต่ไม่ใช่ QR สลิปธนาคาร หรือรหัสตรวจสอบไม่ถูกต้อง" };
  }
  return { name: "qr", result: "unknown", detail: "ไม่พบ QR ในสลิป" };
}

export function evaluateSlip(data: SlipData, expected: ExpectedPayment, opts: EvaluateOptions = {}): SlipEvaluation {
  const now = opts.now ?? new Date();
  const checks: SlipCheckResult[] = [
    checkDuplicate(data, opts.duplicateTransRef),
    checkAmount(data, expected),
    checkTime(data, expected, now),
    checkReceiver(data, expected),
    checkQr(data),
  ];
  const failed = checks.find((c) => c.result === "fail");
  const required = ["amount", "time", "receiver", "qr"] as const;
  let decision: SlipDecision;
  if (failed) decision = "REJECTED";
  else if (required.every((n) => checks.find((c) => c.name === n)?.result === "pass")) decision = "VERIFIED";
  else decision = "NEEDS_REVIEW";
  return { decision, checks, rejectReason: failed ? failed.detail : null };
}
