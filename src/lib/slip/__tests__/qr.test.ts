import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crc16ccitt, parseSlipQr, parseTlv } from "../qr";

function tlv(tag: string, value: string): string {
  return tag + String(value.length).padStart(2, "0") + value;
}

/** Independent reference CRC-16/CCITT-FALSE (table-driven) to cross-check the implementation. */
const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n << 8;
  for (let k = 0; k < 8; k++) c = c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1;
  return c & 0xffff;
});
function refCrc(s: string): string {
  let crc = 0xffff;
  for (const b of Buffer.from(s, "utf8")) crc = ((crc << 8) ^ TABLE[((crc >> 8) ^ b) & 0xff]) & 0xffff;
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function slipPayload(opts: { api?: string; bank?: string; ref: string; country?: string; badCrc?: boolean }): string {
  const t00 = tlv("00", opts.api ?? "000001") + tlv("01", opts.bank ?? "004") + tlv("02", opts.ref);
  const body = tlv("00", t00) + tlv("51", opts.country ?? "TH") + "9104";
  let crc = refCrc(body);
  if (opts.badCrc) crc = crc === "0000" ? "0001" : "0000";
  return body + crc;
}

describe("crc16ccitt", () => {
  it("matches the standard check value", () => {
    assert.equal(crc16ccitt("123456789"), "29B1");
    assert.equal(refCrc("123456789"), "29B1");
  });
  it("matches the reference on random strings", () => {
    for (const s of ["", "A", "0041000600000101030040220TH9104", "hello world"]) {
      assert.equal(crc16ccitt(s), refCrc(s));
    }
  });
});

describe("parseTlv", () => {
  it("parses flat TLV", () => {
    assert.deepEqual(parseTlv("0002AB5102TH"), [
      { tag: "00", value: "AB" },
      { tag: "51", value: "TH" },
    ]);
  });
  it("rejects malformed input", () => {
    assert.equal(parseTlv("00XXAB"), null);
    assert.equal(parseTlv("0005AB"), null);
    assert.equal(parseTlv("005"), null);
  });
});

describe("parseSlipQr", () => {
  it("parses a valid KBank-style slip QR", () => {
    const p = slipPayload({ bank: "004", ref: "016279103512ABC12345" });
    const r = parseSlipQr(p);
    assert.equal(r.isSlip, true);
    assert.equal(r.crcValid, true);
    assert.equal(r.apiId, "000001");
    assert.equal(r.sendingBank, "004");
    assert.equal(r.transRef, "016279103512ABC12345");
    assert.equal(r.countryCode, "TH");
  });

  it("parses an SCB-style 25-char ref and lowercase CRC", () => {
    const p = slipPayload({ bank: "014", ref: "2026100612345678ABCDE1234" });
    const lower = p.slice(0, -4) + p.slice(-4).toLowerCase();
    const r = parseSlipQr(lower);
    assert.equal(r.transRef, "2026100612345678ABCDE1234");
    assert.equal(r.sendingBank, "014");
  });

  it("tolerates surrounding whitespace", () => {
    const p = slipPayload({ ref: "REF0001" });
    assert.equal(parseSlipQr(`  ${p}\n`).transRef, "REF0001");
  });

  it("returns payload info but transRef=null when CRC is wrong", () => {
    const r = parseSlipQr(slipPayload({ ref: "016279103512ABC12345", badCrc: true }));
    assert.equal(r.isSlip, true);
    assert.equal(r.crcValid, false);
    assert.equal(r.transRef, null);
    assert.equal(r.sendingBank, "004");
  });

  it("detects tampering of the ref (CRC mismatch)", () => {
    const p = slipPayload({ ref: "016279103512ABC12345" }).replace("ABC12345", "ABC12346");
    assert.equal(parseSlipQr(p).transRef, null);
  });

  it("treats missing CRC as invalid", () => {
    const t00 = tlv("00", "000001") + tlv("01", "004") + tlv("02", "X1");
    const r = parseSlipQr(tlv("00", t00) + tlv("51", "TH"));
    assert.equal(r.isSlip, true);
    assert.equal(r.transRef, null);
  });

  it("ignores PromptPay payment QRs (tag 29)", () => {
    const merchant = tlv("00", "A000000677010111") + tlv("01", "0066812345678");
    const body = tlv("00", "01") + tlv("01", "12") + tlv("29", merchant) + tlv("53", "764") + tlv("54", "1500.00") + tlv("58", "TH") + "6304";
    const p = body + refCrc(body);
    const r = parseSlipQr(p);
    assert.equal(r.isSlip, false);
    assert.equal(r.transRef, null);
  });

  it("ignores bill payment QRs (tag 30)", () => {
    const bill = tlv("00", "A000000677010112") + tlv("01", "010555512345601") + tlv("02", "ORDER1");
    const body = tlv("00", "01") + tlv("01", "12") + tlv("30", bill) + tlv("58", "TH") + "6304";
    assert.equal(parseSlipQr(body + refCrc(body)).isSlip, false);
  });

  it("rejects garbage and URLs", () => {
    assert.equal(parseSlipQr("https://example.com/x").isSlip, false);
    assert.equal(parseSlipQr("").isSlip, false);
    assert.equal(parseSlipQr("hello").isSlip, false);
  });

  it("drops a non-numeric bank code", () => {
    const r = parseSlipQr(slipPayload({ bank: "ABC", ref: "R1" }));
    assert.equal(r.sendingBank, null);
    assert.equal(r.transRef, "R1");
  });
});
