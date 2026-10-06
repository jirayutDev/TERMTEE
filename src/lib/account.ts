/**
 * Account settings: shared constants and pure validators (safe to import from client components).
 */

/** Thai bank codes (Bank of Thailand / ITMX 3-digit codes) used for refund transfers. */
export const THAI_BANKS = [
  { code: "002", name: "ธนาคารกรุงเทพ", short: "BBL" },
  { code: "004", name: "ธนาคารกสิกรไทย", short: "KBANK" },
  { code: "006", name: "ธนาคารกรุงไทย", short: "KTB" },
  { code: "011", name: "ธนาคารทหารไทยธนชาต", short: "ttb" },
  { code: "014", name: "ธนาคารไทยพาณิชย์", short: "SCB" },
  { code: "025", name: "ธนาคารกรุงศรีอยุธยา", short: "BAY" },
  { code: "022", name: "ธนาคารซีไอเอ็มบี ไทย", short: "CIMBT" },
  { code: "024", name: "ธนาคารยูโอบี", short: "UOB" },
  { code: "069", name: "ธนาคารเกียรตินาคินภัทร", short: "KKP" },
  { code: "067", name: "ธนาคารทิสโก้", short: "TISCO" },
  { code: "071", name: "ธนาคารไทยเครดิต", short: "TCRB" },
  { code: "073", name: "ธนาคารแลนด์ แอนด์ เฮ้าส์", short: "LH Bank" },
  { code: "070", name: "ธนาคารไอซีบีซี (ไทย)", short: "ICBC" },
  { code: "030", name: "ธนาคารออมสิน", short: "GSB" },
  { code: "033", name: "ธนาคารอาคารสงเคราะห์", short: "GHB" },
  { code: "034", name: "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร", short: "ธ.ก.ส." },
  { code: "066", name: "ธนาคารอิสลามแห่งประเทศไทย", short: "IBANK" },
] as const;

export type ThaiBankCode = (typeof THAI_BANKS)[number]["code"];

export function bankName(code: string | null | undefined): string | null {
  return THAI_BANKS.find((b) => b.code === code)?.name ?? null;
}

export function isThaiBankCode(code: string): code is ThaiBankCode {
  return THAI_BANKS.some((b) => b.code === code);
}

/** Strip spaces, dashes, dots and parentheses. */
export function digitsOnly(v: string): string {
  return v.replace(/[\s\-.()]/g, "");
}

/**
 * Normalise a Thai phone number to local digits ("0812345678"), or null when invalid.
 * Accepts mobile (0[689] + 8 digits), landline (0[2-7] + 7 digits) and the +66 / 66 prefix.
 */
export function normalizeThaiPhone(raw: string): string | null {
  let v = digitsOnly(raw.trim());
  if (v.startsWith("+66")) v = "0" + v.slice(3);
  else if (/^66\d{8,9}$/.test(v)) v = "0" + v.slice(2);
  if (/^0[689]\d{8}$/.test(v)) return v;
  if (/^0[2-7]\d{7}$/.test(v)) return v;
  return null;
}

/** "0812345678" -> "081-234-5678", "021234567" -> "02-123-4567". */
export function formatThaiPhone(v: string | null | undefined): string {
  if (!v) return "";
  if (/^0[689]\d{8}$/.test(v)) return `${v.slice(0, 3)}-${v.slice(3, 6)}-${v.slice(6)}`;
  if (/^02\d{7}$/.test(v)) return `${v.slice(0, 2)}-${v.slice(2, 5)}-${v.slice(5)}`;
  if (/^0[3-7]\d{7}$/.test(v)) return `${v.slice(0, 3)}-${v.slice(3, 6)}-${v.slice(6)}`;
  return v;
}

/** Thai 13-digit tax ID / national ID checksum (mod 11). */
export function isValidThaiTaxId(v: string): boolean {
  if (!/^\d{13}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(v[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(v[12]);
}

export const HEAD_OFFICE_BRANCH = "00000";

export function branchLabel(branch: string | null | undefined): string {
  if (!branch) return "";
  return branch === HEAD_OFFICE_BRANCH ? "สำนักงานใหญ่" : `สาขาที่ ${branch}`;
}

/** Refund account numbers: 10-15 digits (most banks 10, GSB / BAAC / GHB 12+). */
export function isValidBankAccountNo(v: string): boolean {
  return /^\d{10,15}$/.test(v);
}

/** Text the user must type to confirm account deletion. */
export function deleteConfirmMatches(typed: string, email: string): boolean {
  return typed.trim().toLowerCase() === email.trim().toLowerCase();
}
