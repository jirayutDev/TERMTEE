/**
 * Heuristic extraction of amount / date-time / receiver from OCR text of Thai bank slips
 * (K PLUS, SCB EASY, Krungthai NEXT, Bangkok Bank, Krungsri, ttb, MyMo/GSB, PromptPay variants).
 *
 * Everything returns null when unsure. The output is untrusted and is only compared against the
 * order in evaluate.ts.
 */

export interface ParsedSlipText {
  amountSatang: number | null;
  transferredAt: Date | null;
  receiverName: string | null;
  receiverAccount: string | null;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

/**
 * Normalize OCR text: Thai digits -> ASCII, decomposed sara am, odd unicode, OCR letter/digit
 * confusion inside numeric tokens (O->0, l/I/|->1, S->5 only between digits).
 */
export function normalizeOcrText(text: string): string {
  let s = text.normalize("NFC");
  s = s.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
  s = s.replace(/\u0E4D\u0E32/g, "\u0E33"); // ํ + า -> ำ
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, "");
  s = s.replace(/[\u00A0\u2000-\u200A\u3000]/g, " ");
  s = s.replace(/[：]/g, ":").replace(/[，]/g, ",").replace(/[．]/g, ".");
  s = s.replace(/[×✕хХ]/g, "x"); // mask characters read as multiplication sign / Cyrillic
  s = s.replace(/[‐‑‒–—−]/g, "-");
  s = s.replace(/\r\n?/g, "\n");

  // Fix letter/digit confusion inside tokens that are mostly numeric, e.g. "1,5OO.00", "l0:35", "2S69".
  s = s.replace(/(?<![A-Za-z])[0-9OoQDlI|SB][0-9OoQDlI|SB,.:]*[0-9OoQDlI|SB](?![A-Za-z])/g, (tok) => {
    const digits = (tok.match(/\d/g) ?? []).length;
    if (digits === 0) return tok;
    const mapped = tok
      .replace(/[OoQD]/g, "0")
      .replace(/[lI|]/g, "1")
      .replace(/S/g, "5")
      .replace(/B/g, "8");
    const letters = tok.length - digits - (tok.match(/[,.:]/g) ?? []).length;
    const numericShape =
      /^\d{1,3}(?:,\d{3})*\.\d{2}$/.test(mapped) || // money
      /^\d{1,2}:\d{2}(?::\d{2})?$/.test(mapped) || // time
      /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(mapped); // date
    return letters <= digits || numericShape ? mapped : tok;
  });
  return s;
}

/** Regex source for a Thai keyword that tolerates OCR-inserted spaces between characters. */
function kw(word: string): string {
  return Array.from(word)
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
}

function anyKw(words: string[]): RegExp {
  return new RegExp(`(?:${words.map(kw).join("|")})`, "i");
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// Amount
// ---------------------------------------------------------------------------

const AMOUNT_KW = anyKw(["จำนวนเงิน", "จำนวน", "ยอดเงินโอน", "ยอดโอน", "ยอดชำระ", "Amount", "Total"]);
const CURRENCY_KW = /(?:บ\s*า\s*ท|THB|Baht|฿)/i;
const FEE_KW = anyKw(["ค่าธรรมเนียม", "ค่าบริการ", "Fee", "Charge"]);
const BALANCE_KW = anyKw(["ยอดเงินคงเหลือ", "คงเหลือ", "ยอดคงเหลือ", "Balance", "Available"]);

// 1,500.00 | 1500.00 | 1 500.00 ; not part of a date like 06.10.2569
const MONEY_RE = /(?<![\d.,])(\d{1,3}(?:[, ]\d{3})+|\d+)\s?[.,]\s?(\d{2})(?![\d.,]?\d)/g;

interface AmountCandidate {
  satang: number;
  score: number;
  index: number;
}

function moneyOnLine(line: string): { satang: number; pos: number }[] {
  const out: { satang: number; pos: number }[] = [];
  for (const m of line.matchAll(MONEY_RE)) {
    const intPart = m[1].replace(/[, ]/g, "");
    if (intPart.length > 9) continue; // > 1e9 THB is noise (ref numbers, phone numbers)
    out.push({ satang: Number(intPart) * 100 + Number(m[2]), pos: m.index ?? 0 });
  }
  return out;
}

export function extractAmount(text: string): number | null {
  const ls = lines(normalizeOcrText(text));
  const cands: AmountCandidate[] = [];
  ls.forEach((line, i) => {
    const prev = i > 0 ? ls[i - 1] : "";
    const isFee = FEE_KW.test(line) || (FEE_KW.test(prev) && !AMOUNT_KW.test(line) && moneyOnLine(prev).length === 0);
    const isBalance = BALANCE_KW.test(line) || (BALANCE_KW.test(prev) && moneyOnLine(prev).length === 0);
    if (isFee || isBalance) return;
    for (const m of moneyOnLine(line)) {
      let score = 0;
      if (AMOUNT_KW.test(line)) score += 3;
      else if (AMOUNT_KW.test(prev) && moneyOnLine(prev).length === 0) score += 3; // "จำนวน:" on its own line
      if (CURRENCY_KW.test(line)) score += 2;
      if (score > 0) cands.push({ satang: m.satang, score, index: i });
    }
  });
  if (cands.length === 0) return null;
  const best = Math.max(...cands.map((c) => c.score));
  const top = cands.filter((c) => c.score === best);
  const values = new Set(top.map((c) => c.satang));
  if (values.size === 1) return top[0].satang;
  // Conflicting top candidates: take the one on the earliest line only if it has the amount keyword.
  return null;
}

// ---------------------------------------------------------------------------
// Date / time (Asia/Bangkok, UTC+7, no DST)
// ---------------------------------------------------------------------------

const THAI_MONTHS_FULL = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];
// abbreviation parts, dots optional ("ต.ค.", "ต.ค", "ตค", "ต. ค.")
const THAI_MONTHS_ABBR: [string, string][] = [
  ["ม", "ค"],
  ["ก", "พ"],
  ["มี", "ค"],
  ["เม", "ย"],
  ["พ", "ค"],
  ["มิ", "ย"],
  ["ก", "ค"],
  ["ส", "ค"],
  ["ก", "ย"],
  ["ต", "ค"],
  ["พ", "ย"],
  ["ธ", "ค"],
];
const EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

interface MonthAlt {
  re: string;
  month: number; // 1..12
}

const MONTH_ALTS: MonthAlt[] = [
  ...THAI_MONTHS_FULL.map((m, i) => ({ re: kw(m), month: i + 1 })),
  ...THAI_MONTHS_ABBR.map(([a, b], i) => ({ re: `${kw(a)}\\s*\\.?\\s*${kw(b)}\\s*\\.?`, month: i + 1 })),
  ...EN_MONTHS.map((m, i) => ({ re: `${m}[a-z]*\\.?`, month: i + 1 })),
].sort((x, y) => y.re.length - x.re.length); // longest first so "มีค" wins over "มค"

const MONTH_GROUP = `(${MONTH_ALTS.map((m) => m.re).join("|")})`;

function monthFromText(s: string): number | null {
  for (const m of MONTH_ALTS) {
    if (new RegExp(`^(?:${m.re})$`, "i").test(s.trim())) return m.month;
  }
  return null;
}

/** dd MON yy(yy) */
const DATE_DMY_NAME = new RegExp(`(?<!\\d)(\\d{1,2})\\s*${MONTH_GROUP}\\s*,?\\s*(\\d{4}|\\d{2})(?!\\d)`, "i");
/** MON dd, yyyy */
const DATE_MDY_NAME = new RegExp(`(?<![a-z])${MONTH_GROUP}\\s*(\\d{1,2}),?\\s+(\\d{4}|\\d{2})(?!\\d)`, "i");
/** dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy */
const DATE_NUMERIC = /(?<![\d.,])(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4}|\d{2})(?![\d.,]?\d)/;
const TIME_RE = /(?<!\d)([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)(?:\s*[:.]\s*([0-5]\d))?(?!\d)(?:\s*น\.?)?/;

/** Convert a 2- or 4-digit year (BE or CE) to CE, choosing the reading closest to `now`. */
export function resolveYear(raw: string, now: Date): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (raw.length === 4) {
    if (n >= 2400 && n <= 2700) return n - 543;
    if (n >= 1900 && n <= 2200) return n;
    return null;
  }
  const nowY = now.getUTCFullYear();
  const be = 2500 + n - 543;
  const ce = 2000 + n;
  return Math.abs(be - nowY) <= Math.abs(ce - nowY) ? be : ce;
}

function bangkokDate(y: number, mo: number, d: number, h: number, mi: number, s: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  return new Date(Date.UTC(y, mo - 1, d, h - 7, mi, s));
}

interface DateHit {
  y: number;
  mo: number;
  d: number;
  line: number;
  end: number; // index in line after the date
}

function findDate(ls: string[], now: Date): DateHit | null {
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i];
    let m = DATE_DMY_NAME.exec(line);
    if (m) {
      const mo = monthFromText(m[2]);
      const y = resolveYear(m[3], now);
      if (mo && y) return { y, mo, d: Number(m[1]), line: i, end: m.index + m[0].length };
    }
    m = DATE_MDY_NAME.exec(line);
    if (m) {
      const mo = monthFromText(m[1]);
      const y = resolveYear(m[3], now);
      if (mo && y) return { y, mo, d: Number(m[2]), line: i, end: m.index + m[0].length };
    }
    m = DATE_NUMERIC.exec(line);
    if (m) {
      const y = resolveYear(m[3], now);
      const mo = Number(m[2]);
      if (y && mo >= 1 && mo <= 12) return { y, mo, d: Number(m[1]), line: i, end: m.index + m[0].length };
    }
  }
  return null;
}

export function extractDateTime(text: string, now: Date = new Date()): Date | null {
  const ls = lines(normalizeOcrText(text));
  const date = findDate(ls, now);
  if (!date) return null;
  // time: same line after the date, then same line before it, then the next 2 lines
  const sameAfter = ls[date.line].slice(date.end);
  const tries = [sameAfter, ls[date.line], ls[date.line + 1] ?? "", ls[date.line + 2] ?? "", ls[date.line - 1] ?? ""];
  for (const t of tries) {
    const m = TIME_RE.exec(t);
    if (!m) continue;
    return bangkokDate(date.y, date.mo, date.d, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0);
  }
  return null; // date without time is not precise enough for the time check
}

// ---------------------------------------------------------------------------
// Receiver
// ---------------------------------------------------------------------------

const RECEIVER_MARKER = new RegExp(
  `^\\s*(?:${["ไปยัง", "ถึง", "ผู้รับเงิน", "ผู้รับ", "บัญชีปลายทาง", "ไปที่", "โอนไปยัง"].map(kw).join("|")}|to|receiver|recipient|payee)(?=$|[\\s:：.\\-])[\\s:：.\\-]*`,
  "i",
);
const SENDER_MARKER = new RegExp(
  `^\\s*(?:${["จาก", "ผู้โอน", "บัญชีต้นทาง"].map(kw).join("|")}|from|sender|payer)(?=$|[\\s:：.\\-])[\\s:：.\\-]*`,
  "i",
);
const BANK_LINE = new RegExp(
  `(?:^\\s*ธ\\s*\\.|${["ธนาคาร", "พร้อมเพย์", "กสิกร", "ไทยพาณิชย์", "กรุงไทย", "กรุงเทพ", "กรุงศรี", "ทหารไทยธนชาต", "ออมสิน", "ธ.ก.ส"].map(kw).join("|")}|\\bbank\\b|prompt\\s*pay|\\b(?:kbank|scb|ktb|bbl|bay|ttb|gsb|baac|uob|cimb|kkp|lh\\s*bank|tisco)\\b|e-?wallet)`,
  "i",
);
const NON_NAME_LINE = new RegExp(
  `(?:${["จำนวน", "ค่าธรรมเนียม", "เลขที่รายการ", "รหัสอ้างอิง", "โอนเงินสำเร็จ", "ทำรายการ", "บันทึก", "สแกน", "ตรวจสอบ", "วันที่", "เวลา", "หมายเหตุ", "รายการ"].map(kw).join("|")}|\\b(?:amount|fee|ref(?:erence)?|transaction|successful|success|scan|verify|date|time|memo|note|balance)\\b)`,
  "i",
);
const REF_LINE = anyKw(["เลขที่รายการ", "รหัสอ้างอิง", "หมายเลขอ้างอิง", "อ้างอิง", "Ref", "Transaction", "เลขที่อ้างอิง"]);

// tokens like xxx-x-x5678-x, XXX-X-X1234-X, 08x-xxx-5678, xxxxxx5678, 123-4-56789-0
const ACCOUNT_TOKEN = /(?<![A-Za-z0-9])[0-9xX*•Oo]{1,6}(?:\s?-\s?[0-9xX*•Oo]{1,8}){1,4}(?![A-Za-z0-9])|(?<![A-Za-z0-9])[xX*•]{3,}[0-9]{3,}[0-9xX*•]*(?![A-Za-z0-9])/g;

interface AccountHit {
  value: string; // normalized e.g. "xxx-x-x5678-x"
  line: number;
}

function cleanAccountToken(tok: string): string | null {
  const v = tok
    .replace(/\s/g, "")
    .replace(/[X*•]/g, "x")
    .replace(/(?<=\d)[Oo]|[Oo](?=\d)/g, "0") // O next to a digit -> 0
    .replace(/[Oo]/g, "x"); // otherwise a mask char read as O
  const chars = v.replace(/-/g, "");
  const digits = (chars.match(/\d/g) ?? []).length;
  const masked = (chars.match(/x/g) ?? []).length;
  if (chars.length < 8 || chars.length > 16) return null;
  if (digits < 3) return null;
  if (masked === 0) {
    // fully visible numbers: only plausible account/phone/id lengths, never dates
    if (![10, 12, 13, 15].includes(chars.length)) return null;
  }
  return v;
}

function findAccounts(ls: string[]): AccountHit[] {
  const out: AccountHit[] = [];
  ls.forEach((line, i) => {
    if (REF_LINE.test(line)) return;
    for (const m of line.matchAll(ACCOUNT_TOKEN)) {
      const v = cleanAccountToken(m[0]);
      if (v) out.push({ value: v, line: i });
    }
  });
  return out;
}

function stripMarker(line: string): string {
  return line.replace(RECEIVER_MARKER, "").replace(SENDER_MARKER, "").trim();
}

function cleanName(raw: string): string | null {
  let s = raw
    .replace(ACCOUNT_TOKEN, " ")
    .replace(/[|_~^`"“”<>{}[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/^[\s:.\-]+|[\s:\-]+$/g, "");
  const letters = (s.match(/[A-Za-z\u0E01-\u0E2E]/g) ?? []).length;
  if (letters < 2) return null;
  if (s.length > 80) s = s.slice(0, 80);
  return s;
}

function isNameCandidate(line: string): boolean {
  const s = stripMarker(line);
  if (!s) return false;
  if (BANK_LINE.test(s) && !/(?:บริษัท|บจก|จำกัด|co\.?,?\s*ltd|company)/i.test(s)) return false;
  if (NON_NAME_LINE.test(s)) return false;
  if (moneyOnLine(s).length > 0) return false;
  if (/\d{1,2}\s*:\s*\d{2}/.test(s)) return false; // time
  if (DATE_DMY_NAME.test(s) || DATE_MDY_NAME.test(s) || DATE_NUMERIC.test(s)) return false;
  return cleanName(s) !== null;
}

export function extractReceiver(text: string): { name: string | null; account: string | null } {
  const ls = lines(normalizeOcrText(text));
  const accounts = findAccounts(ls);
  const markerIdx = ls.findIndex((l) => RECEIVER_MARKER.test(l));
  const senderIdx = ls.findIndex((l) => SENDER_MARKER.test(l));

  let account: AccountHit | null = null;
  let regionStart = -1; // first line that may hold the receiver name

  if (markerIdx >= 0) {
    account = accounts.find((a) => a.line >= markerIdx && a.line <= markerIdx + 5) ?? null;
    regionStart = markerIdx;
  } else if (accounts.length >= 2) {
    // No labels (e.g. K PLUS): sender block first, receiver block second.
    account = accounts[1];
    regionStart = accounts[0].line + 1;
  } else if (accounts.length === 1 && senderIdx < 0) {
    account = null; // a single unlabeled account could be the sender: unsure
  }

  let name: string | null = null;
  if (regionStart >= 0) {
    // the marker line itself may carry the name: "ไปยัง บจก. เทอมตี"
    const end = account ? account.line : Math.min(ls.length - 1, regionStart + 3);
    const sameLine = markerIdx >= 0 ? cleanName(stripMarker(ls[markerIdx]).replace(ACCOUNT_TOKEN, "")) : null;
    if (sameLine && isNameCandidate(ls[markerIdx])) {
      name = sameLine;
    } else {
      for (let i = regionStart + (markerIdx >= 0 ? 1 : 0); i <= end && i < ls.length; i++) {
        if (account && i === account.line) {
          // name and account on one line: "บจก. เทอมตี xxx-x-x5678-x"
          const n = cleanName(ls[i]);
          if (n && isNameCandidate(n)) name = n;
          break;
        }
        if (isNameCandidate(ls[i])) {
          name = cleanName(stripMarker(ls[i]));
          break;
        }
      }
    }
  }
  return { name, account: account?.value ?? null };
}

// ---------------------------------------------------------------------------

export function parseSlipText(text: string, opts: { now?: Date } = {}): ParsedSlipText {
  const { name, account } = extractReceiver(text);
  return {
    amountSatang: extractAmount(text),
    transferredAt: extractDateTime(text, opts.now ?? new Date()),
    receiverName: name,
    receiverAccount: account,
  };
}
