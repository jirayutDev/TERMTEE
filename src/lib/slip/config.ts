import type { ExpectedPayment } from "./types";

function csv(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** PAYMENT_ACCOUNTS: comma-separated bank account numbers / PromptPay ids (phone or tax id). */
export function paymentAccountsFromEnv(): string[] {
  return csv(process.env.PAYMENT_ACCOUNTS);
}

/** PAYMENT_NAMES: comma-separated accepted receiver names (Thai and/or English). */
export function paymentNamesFromEnv(): string[] {
  return csv(process.env.PAYMENT_NAMES);
}

type OrderLike = { amountSatang: number; createdAt: Date };

/** Pure: expected payment for an order given the accepted receiver accounts / names. */
export function expectedWith(order: OrderLike, receiver: { accounts: string[]; names: string[] }): ExpectedPayment {
  return {
    amountSatang: order.amountSatang,
    orderCreatedAt: order.createdAt,
    receiverAccounts: receiver.accounts,
    receiverNames: receiver.names,
  };
}

/**
 * Expected payment using the receiver accounts / names from shop settings
 * (/admin/settings → payment; falls back to PAYMENT_ACCOUNTS / PAYMENT_NAMES until saved).
 */
export async function expectedForOrder(order: OrderLike): Promise<ExpectedPayment> {
  // Imported lazily: settings is server-only + DB, and this module is also used by plain node tests.
  const { getSettingsSection } = await import("../settings");
  const payment = await getSettingsSection("payment");
  return expectedWith(order, payment);
}

/** @deprecated env only; ignores /admin/settings. Use `expectedForOrder`. Kept for scripts/tests. */
export function expectedFromEnv(order: OrderLike): ExpectedPayment {
  return expectedWith(order, { accounts: paymentAccountsFromEnv(), names: paymentNamesFromEnv() });
}
