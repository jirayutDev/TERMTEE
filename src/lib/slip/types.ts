/**
 * Contract between the slip reader/verifier (src/lib/slip/*) and the payment API/UI.
 *
 * Flow: file -> validate -> sha256 -> duplicate check (hash) -> readSlip (QR + OCR)
 *       -> duplicate check (transRef) -> evaluateSlip (compare with order) -> optional SlipProvider
 */

/** Data extracted from a slip image. Every field is untrusted until a provider confirms it. */
export interface SlipData {
  qrPayload: string | null;
  transRef: string | null; // from Thai bank slip mini-QR (tag 00 / sub 02)
  sendingBank: string | null; // 3-digit bank code (tag 00 / sub 01)
  amountSatang: number | null;
  transferredAt: Date | null;
  receiverName: string | null;
  receiverAccount: string | null; // as printed, usually masked e.g. "xxx-x-x5678-x"
  ocrText: string;
}

export type SlipCheckName = "qr" | "amount" | "time" | "receiver" | "duplicate" | "provider";

export interface SlipCheckResult {
  name: SlipCheckName;
  result: "pass" | "fail" | "unknown"; // unknown = could not read, not a contradiction
  detail: string; // Thai, shown to admin; to customer only for "fail"
}

export interface ExpectedPayment {
  amountSatang: number;
  orderCreatedAt: Date;
  receiverAccounts: string[]; // full account numbers / PromptPay IDs from env
  receiverNames: string[]; // accepted names (Thai/English) from env
}

export type SlipDecision = "VERIFIED" | "NEEDS_REVIEW" | "REJECTED";

export interface SlipEvaluation {
  decision: SlipDecision;
  checks: SlipCheckResult[];
  rejectReason: string | null; // Thai, customer-facing
}

/** Optional paid verifier that confirms the transfer with the bank (SlipOK, EasySlip, ...). */
export interface SlipProvider {
  name: string;
  /** Resolves with a verdict on the slip; throws when the provider can't give one (outage, quota, ...). */
  verify(input: { image: Buffer; qrPayload: string | null }): Promise<
    | { ok: true; transRef: string; amountSatang: number; transferredAt: Date; receiverAccount: string | null; receiverName: string | null; via?: string }
    | { ok: false; reason: string; via?: string }
  >;
}
