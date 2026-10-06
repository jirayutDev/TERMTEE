import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateSlip, matchMaskedAccount, matchName, normalizeName } from "../evaluate";
import { expectedFromEnv } from "../config";
import type { ExpectedPayment, SlipData } from "../types";

const NOW = new Date("2026-10-06T04:00:00Z");
const MIN = 60_000;

const expected: ExpectedPayment = {
  amountSatang: 150000,
  orderCreatedAt: new Date(NOW.getTime() - 30 * MIN),
  receiverAccounts: ["123-4-55678-9", "0812345678"],
  receiverNames: ["บริษัท เทอมตี เอ็นเตอร์เทนเมนต์ จำกัด", "TERMTEE ENTERTAINMENT CO., LTD."],
};

function slip(over: Partial<SlipData> = {}): SlipData {
  return {
    qrPayload: "0041...",
    transRef: "016279103512ABC12345",
    sendingBank: "004",
    amountSatang: 150000,
    transferredAt: new Date(NOW.getTime() - 20 * MIN),
    receiverName: "บจก. เทอมตี เอ็นเ",
    receiverAccount: "xxx-x-x5678-x",
    ocrText: "",
    ...over,
  };
}

const check = (ev: ReturnType<typeof evaluateSlip>, name: string) => ev.checks.find((c) => c.name === name)!;

describe("matchMaskedAccount", () => {
  it("matches visible digits from the right", () => {
    assert.equal(matchMaskedAccount("xxx-x-x5678-x", "123-4-55678-9"), "match");
    assert.equal(matchMaskedAccount("XXX-X-X5678-X", "1234556789"), "match");
    assert.equal(matchMaskedAccount("xxx-xxx567-8", "123-4-55678-9"), "mismatch");
    assert.equal(matchMaskedAccount("xxx-x-x5679-x", "123-4-55678-9"), "mismatch");
  });
  it("PromptPay phone, with +66 configured", () => {
    assert.equal(matchMaskedAccount("08x-xxx-5678", "+66812345678"), "match");
    assert.equal(matchMaskedAccount("08x-xxx-5679", "0812345678"), "mismatch");
  });
  it("too few visible digits -> unknown", () => {
    assert.equal(matchMaskedAccount("xxx-x-xxx78-x", "1234556789"), "unknown");
  });
  it("longer masked id with visible extra digits -> mismatch", () => {
    assert.equal(matchMaskedAccount("1234-xxxx-xxx5678", "0812345678"), "mismatch");
  });
});

describe("matchName", () => {
  it("strips titles and handles truncation", () => {
    assert.equal(matchName("บจก. เทอมตี เอ็นเ", "บริษัท เทอมตี เอ็นเตอร์เทนเมนต์ จำกัด"), "match");
    assert.equal(matchName("TERMTEE ENTERTAIN", "TERMTEE ENTERTAINMENT CO., LTD."), "match");
    assert.equal(matchName("termtee co.,ltd.", "TERMTEE ENTERTAINMENT CO., LTD."), "match");
    assert.equal(matchName("นาย สมชาย ใ***", "นาย สมชาย ใจดี"), "match");
    assert.equal(matchName("MR. SOMCHAI JAIDEE", "Somchai Jaidee"), "match");
  });
  it("tolerates light OCR noise", () => {
    assert.equal(matchName("TERMTEF ENTERTAINMENT", "TERMTEE ENTERTAINMENT CO., LTD."), "match");
  });
  it("detects a different name", () => {
    assert.equal(matchName("บจก. ร้านค้าอื่น", "บริษัท เทอมตี เอ็นเตอร์เทนเมนต์ จำกัด"), "mismatch");
    assert.equal(matchName("MR. JOHN DOE", "TERMTEE ENTERTAINMENT CO., LTD."), "mismatch");
  });
  it("too short -> unknown", () => assert.equal(matchName("นาย ก", "นาย กข"), "unknown"));
  it("normalizeName", () => {
    assert.equal(normalizeName("น.ส. สมหญิง  รักดี"), "สมหญิงรักดี");
    assert.equal(normalizeName("TERMTEE Co., Ltd."), "termtee");
    assert.equal(normalizeName("Mrs Smith"), "smith");
  });
});

describe("evaluateSlip", () => {
  it("VERIFIED when everything passes", () => {
    const ev = evaluateSlip(slip(), expected, { now: NOW });
    assert.equal(ev.decision, "VERIFIED");
    assert.equal(ev.rejectReason, null);
    for (const n of ["amount", "time", "receiver", "qr", "duplicate"]) assert.equal(check(ev, n).result, "pass", n);
  });

  it("REJECTED on duplicate transRef", () => {
    const ev = evaluateSlip(slip(), expected, { now: NOW, duplicateTransRef: true });
    assert.equal(ev.decision, "REJECTED");
    assert.equal(ev.rejectReason, "สลิปนี้ถูกใช้ไปแล้ว");
  });

  it("REJECTED on wrong amount, NEEDS_REVIEW on unreadable amount", () => {
    const bad = evaluateSlip(slip({ amountSatang: 100000 }), expected, { now: NOW });
    assert.equal(bad.decision, "REJECTED");
    assert.match(bad.rejectReason!, /1,000\.00/);
    assert.match(bad.rejectReason!, /1,500\.00/);
    const unk = evaluateSlip(slip({ amountSatang: null }), expected, { now: NOW });
    assert.equal(unk.decision, "NEEDS_REVIEW");
    assert.equal(check(unk, "amount").result, "unknown");
  });

  it("time rules", () => {
    const before = evaluateSlip(slip({ transferredAt: new Date(expected.orderCreatedAt.getTime() - 11 * MIN) }), expected, { now: NOW });
    assert.equal(before.decision, "REJECTED");
    assert.equal(check(before, "time").result, "fail");

    const skewOk = evaluateSlip(slip({ transferredAt: new Date(expected.orderCreatedAt.getTime() - 9 * MIN) }), expected, { now: NOW });
    assert.equal(check(skewOk, "time").result, "pass");

    const future = evaluateSlip(slip({ transferredAt: new Date(NOW.getTime() + 6 * MIN) }), expected, { now: NOW });
    assert.equal(check(future, "time").result, "fail");

    const nearFuture = evaluateSlip(slip({ transferredAt: new Date(NOW.getTime() + 4 * MIN) }), expected, { now: NOW });
    assert.equal(check(nearFuture, "time").result, "pass");

    const oldOrder = { ...expected, orderCreatedAt: new Date(NOW.getTime() - 48 * 60 * MIN) };
    const old = evaluateSlip(slip({ transferredAt: new Date(NOW.getTime() - 25 * 60 * MIN) }), oldOrder, { now: NOW });
    assert.equal(check(old, "time").result, "fail");
    assert.match(check(old, "time").detail, /24/);

    const unk = evaluateSlip(slip({ transferredAt: null }), expected, { now: NOW });
    assert.equal(check(unk, "time").result, "unknown");
    assert.equal(unk.decision, "NEEDS_REVIEW");
  });

  it("receiver: wrong account + wrong name -> REJECTED", () => {
    const ev = evaluateSlip(slip({ receiverAccount: "xxx-x-x9999-x", receiverName: "นาย มิจฉาชีพ" }), expected, { now: NOW });
    assert.equal(ev.decision, "REJECTED");
    assert.equal(check(ev, "receiver").result, "fail");
  });

  it("receiver: wrong account, name unreadable -> REJECTED", () => {
    const ev = evaluateSlip(slip({ receiverAccount: "xxx-x-x9999-x", receiverName: null }), expected, { now: NOW });
    assert.equal(ev.decision, "REJECTED");
  });

  it("receiver: name matches but account contradicts -> NEEDS_REVIEW", () => {
    const ev = evaluateSlip(slip({ receiverAccount: "xxx-x-x5679-x" }), expected, { now: NOW });
    assert.equal(check(ev, "receiver").result, "unknown");
    assert.equal(ev.decision, "NEEDS_REVIEW");
  });

  it("receiver: only account readable and matches -> pass", () => {
    const ev = evaluateSlip(slip({ receiverName: null }), expected, { now: NOW });
    assert.equal(check(ev, "receiver").result, "pass");
    assert.equal(ev.decision, "VERIFIED");
  });

  it("receiver: PromptPay phone", () => {
    const ev = evaluateSlip(slip({ receiverAccount: "08x-xxx-5678", receiverName: null }), expected, { now: NOW });
    assert.equal(check(ev, "receiver").result, "pass");
  });

  it("receiver: nothing readable -> unknown", () => {
    const ev = evaluateSlip(slip({ receiverAccount: null, receiverName: null }), expected, { now: NOW });
    assert.equal(check(ev, "receiver").result, "unknown");
    assert.equal(ev.decision, "NEEDS_REVIEW");
  });

  it("receiver: not configured -> unknown", () => {
    const ev = evaluateSlip(slip(), { ...expected, receiverAccounts: [], receiverNames: [] }, { now: NOW });
    assert.equal(check(ev, "receiver").result, "unknown");
    assert.equal(ev.decision, "NEEDS_REVIEW");
  });

  it("missing QR -> NEEDS_REVIEW, not rejected", () => {
    const ev = evaluateSlip(slip({ qrPayload: null, transRef: null }), expected, { now: NOW });
    assert.equal(check(ev, "qr").result, "unknown");
    assert.equal(ev.decision, "NEEDS_REVIEW");
    const promptpay = evaluateSlip(slip({ qrPayload: "000201...", transRef: null }), expected, { now: NOW });
    assert.equal(check(promptpay, "qr").result, "unknown");
  });

  it("first failure is the reject reason", () => {
    const ev = evaluateSlip(slip({ amountSatang: 1, transferredAt: new Date(0) }), expected, { now: NOW });
    assert.equal(ev.decision, "REJECTED");
    assert.equal(ev.rejectReason, check(ev, "amount").detail);
  });
});

describe("expectedFromEnv", () => {
  it("reads comma-separated env", () => {
    process.env.PAYMENT_ACCOUNTS = " 123-4-55678-9 , 0812345678,";
    process.env.PAYMENT_NAMES = "บจก. เทอมตี,TERMTEE CO., LTD.";
    const createdAt = new Date();
    const e = expectedFromEnv({ amountSatang: 5000, createdAt });
    assert.deepEqual(e.receiverAccounts, ["123-4-55678-9", "0812345678"]);
    // note: a comma inside a name splits it; "CO., LTD." becomes its own entry, which is harmless
    assert.deepEqual(e.receiverNames, ["บจก. เทอมตี", "TERMTEE CO.", "LTD."]);
    assert.equal(e.amountSatang, 5000);
    assert.equal(e.orderCreatedAt, createdAt);
  });
});
