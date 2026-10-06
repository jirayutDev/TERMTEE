import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { SlipImageError, inspectSlipFile, sha256Hex, sniffImageFormat, toOcrPng, toRgba, validateSlipFile } from "../image";
import { failoverProvider, getSlipProvider, mapEasySlipResponse, mapSlip2GoResponse } from "../provider";
import type { SlipProvider } from "../types";

async function img(w: number, h: number, fmt: "jpeg" | "png" | "webp" | "gif") {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .toFormat(fmt)
    .toBuffer();
}

async function rejects(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof SlipImageError && e.code === code);
}

describe("image validation", () => {
  it("accepts JPEG/PNG/WebP", async () => {
    for (const f of ["jpeg", "png", "webp"] as const) {
      const b = await img(400, 800, f);
      assert.equal(sniffImageFormat(b), f);
      const v = await inspectSlipFile(b);
      assert.equal(v.format, f);
      assert.equal(v.width, 400);
      assert.ok((await validateSlipFile(b)).equals(b));
    }
  });
  it("accepts a File", async () => {
    const b = await img(300, 300, "png");
    const f = new File([new Uint8Array(b)], "slip.png", { type: "image/png" });
    assert.ok((await validateSlipFile(f)).equals(b));
  });
  it("rejects GIF, text with image MIME, empty, corrupt", async () => {
    await rejects(validateSlipFile(await img(300, 300, "gif")), "BAD_FORMAT");
    await rejects(validateSlipFile(new File(["<svg/>"], "x.png", { type: "image/png" })), "BAD_FORMAT");
    await rejects(validateSlipFile(Buffer.alloc(0)), "EMPTY");
    const png = await img(300, 300, "png");
    await rejects(validateSlipFile(png.subarray(0, 60)), "CORRUPT");
  });
  it("rejects too small / too large dimensions and bytes", async () => {
    await rejects(validateSlipFile(await img(150, 600, "png")), "TOO_SMALL_DIM");
    await rejects(validateSlipFile(await img(300, 4100, "jpeg")), "TOO_LARGE_DIM");
    const big = Buffer.concat([await img(300, 300, "png"), Buffer.alloc(5 * 1024 * 1024)]);
    await rejects(validateSlipFile(big), "TOO_LARGE");
  });
  it("sha256Hex", () => {
    assert.equal(sha256Hex(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("produces RGBA and an OCR png", async () => {
    const b = await img(400, 800, "jpeg");
    const rgba = await toRgba(b);
    assert.equal(rgba.data.length, rgba.width * rgba.height * 4);
    const png = await toOcrPng(b);
    const meta = await sharp(png).metadata();
    assert.equal(meta.format, "png");
    assert.ok((meta.width ?? 0) >= 1400);
  });
});

describe("provider", () => {
  it("defaults to none", () => {
    delete process.env.SLIP_PROVIDER;
    assert.equal(getSlipProvider(), null);
    process.env.SLIP_PROVIDER = "none";
    assert.equal(getSlipProvider(), null);
  });
  it("easyslip requires an api key", () => {
    process.env.SLIP_PROVIDER = "easyslip";
    delete process.env.EASYSLIP_API_KEY;
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.equal(getSlipProvider(), null);
    } finally {
      console.warn = warn;
    }
    process.env.EASYSLIP_API_KEY = "k";
    assert.equal(getSlipProvider()?.name, "easyslip");
    delete process.env.SLIP_PROVIDER;
  });
  it("maps an EasySlip v2 success response", () => {
    const r = mapEasySlipResponse(
      {
        success: true,
        data: {
          rawSlip: {
            transRef: "68370160657749I376388B35",
            date: "2024-01-15T14:30:00+07:00",
            amount: { amount: 1500.0 },
            receiver: { account: { name: { th: "นาย รับเงิน ทดสอบ" }, bank: { type: "BANKAC", account: "xxx-x-x5678-x" } } },
          },
        },
      },
      200,
    );
    assert.deepEqual(r, {
      ok: true,
      transRef: "68370160657749I376388B35",
      amountSatang: 150000,
      transferredAt: new Date("2024-01-15T07:30:00Z"),
      receiverAccount: "xxx-x-x5678-x",
      receiverName: "นาย รับเงิน ทดสอบ",
    });
  });
  it("maps an EasySlip error", () => {
    const r = mapEasySlipResponse({ success: false, error: { code: "SLIP_NOT_FOUND", message: "nope" } }, 404);
    assert.deepEqual(r, { ok: false, reason: "ไม่พบรายการโอนนี้ในระบบธนาคาร" });
    // Thunder v2 uses the same shape; isDuplicate is a verdict, quota/validation are not.
    assert.equal(mapEasySlipResponse({ success: true, data: { isDuplicate: true } }, 200).ok, false);
    assert.throws(() => mapEasySlipResponse({ success: false, error: { code: "QUOTA_EXCEEDED" } }, 403));
    assert.throws(() => mapEasySlipResponse({ success: false, error: { code: "VALIDATION_ERROR" } }, 400));
    // Outages are not a verdict on the slip: throw so the caller falls back to local checks.
    assert.throws(() => mapEasySlipResponse(null, 502));
    assert.throws(() => mapEasySlipResponse({ success: false, error: { code: "QUOTA_EXCEEDED" } }, 429));
  });
});

describe("slip2go response mapping", () => {
  const ok = {
    code: "200000",
    message: "Slip found.",
    data: {
      transRef: "015073144041ATF00999",
      dateTime: "2025-10-05T14:48:00.000Z",
      amount: 1500.5,
      receiver: {
        account: {
          name: "บริษัท สลิปทูโก จำกัด",
          bank: { account: "xxx-x-x5366-x" },
          proxy: { type: "NATID", account: "xxx-x-x5366-x" },
        },
        bank: { id: "004", name: "ธนาคารกสิกรไทย" },
      },
    },
  };

  it("maps a found slip", () => {
    const r = mapSlip2GoResponse(ok, 200);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.transRef, "015073144041ATF00999");
    assert.equal(r.amountSatang, 150050);
    assert.equal(r.transferredAt.toISOString(), "2025-10-05T14:48:00.000Z");
    assert.equal(r.receiverAccount, "xxx-x-x5366-x");
    assert.equal(r.receiverName, "บริษัท สลิปทูโก จำกัด");
  });

  it("returns a verdict for bad slips", () => {
    for (const code of ["200404", "200500", "200501"]) {
      const r = mapSlip2GoResponse({ code, message: "x" }, 200);
      assert.equal(r.ok, false);
    }
  });

  it("throws on non-verdict errors so the caller falls back", () => {
    for (const [code, status] of [["401005", 401], ["401007", 401], ["429000", 429], ["500500", 500], ["400001", 400]] as const) {
      assert.throws(() => mapSlip2GoResponse({ code, message: "x" }, status));
    }
    assert.throws(() => mapSlip2GoResponse(null, 502));
  });
});

describe("provider failover", () => {
  const input = { image: Buffer.alloc(0), qrPayload: "x" };
  const verdict = { ok: true as const, transRef: "T1", amountSatang: 100, transferredAt: new Date(0), receiverAccount: null, receiverName: null };
  function fake(name: string, behave: () => Promise<Awaited<ReturnType<SlipProvider["verify"]>>>) {
    let calls = 0;
    const p: SlipProvider = { name, verify: () => { calls++; return behave(); } };
    return { p, calls: () => calls };
  }

  it("uses the first provider when it answers", async () => {
    const a = fake("fo-a1", async () => verdict);
    const b = fake("fo-b1", async () => verdict);
    const r = await failoverProvider([a.p, b.p]).verify(input);
    assert.equal(r.via, "fo-a1");
    assert.equal(b.calls(), 0);
  });

  it("falls over when the first throws, then skips it during cooldown", async () => {
    let t = 1_000;
    const a = fake("fo-a2", async () => { throw new Error("down"); });
    const b = fake("fo-b2", async () => verdict);
    const fo = failoverProvider([a.p, b.p], () => t);
    assert.equal((await fo.verify(input)).via, "fo-b2");
    assert.equal((await fo.verify(input)).via, "fo-b2");
    assert.equal(a.calls(), 1); // skipped while cooling down
    t += 61_000;
    await fo.verify(input);
    assert.equal(a.calls(), 2); // retried after cooldown
  });

  it("a negative verdict does not fail over", async () => {
    const a = fake("fo-a3", async () => ({ ok: false, reason: "fake" }));
    const b = fake("fo-b3", async () => verdict);
    const r = await failoverProvider([a.p, b.p]).verify(input);
    assert.equal(r.ok, false);
    assert.equal(b.calls(), 0);
  });

  it("throws when every provider fails", async () => {
    const a = fake("fo-a4", async () => { throw new Error("x"); });
    const b = fake("fo-b4", async () => { throw new Error("y"); });
    await assert.rejects(failoverProvider([a.p, b.p]).verify(input));
  });

  it("builds a failover chain from SLIP_PROVIDER", () => {
    const saved = { ...process.env };
    Object.assign(process.env, { SLIP_PROVIDER: "slip2go, thunder", SLIP2GO_API_URL: "https://x", SLIP2GO_SECRET_KEY: "k", THUNDER_API_KEY: "t" });
    try {
      assert.equal(getSlipProvider()?.name, "slip2go>thunder");
      delete process.env.THUNDER_API_KEY;
      assert.equal(getSlipProvider()?.name, "slip2go");
    } finally {
      process.env = saved;
    }
  });
});
