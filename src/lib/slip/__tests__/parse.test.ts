import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractAmount, extractDateTime, extractReceiver, normalizeOcrText, parseSlipText, resolveYear } from "../parse";

const NOW = new Date("2026-10-06T04:00:00Z"); // 11:00 Bangkok
const T1035 = new Date("2026-10-06T03:35:00Z"); // 10:35 Bangkok

// --- Realistic OCR outputs (hand-written, with typical tesseract noise) ---------------------

const KPLUS = `
โอนเงินสำเร็จ
6 ต.ค. 69 10:35 น.
นาย สมชาย ใจดี
ธ.กสิกรไทย
xxx-x-x1234-x
↓
บจก. เทอมตี
ธ.ไทยพาณิชย์
xxx-x-x5678-x
เลขที่รายการ:
016279103512ABC12345
จำนวน:
1,500.00 บาท
ค่าธรรมเนียม:
0.00 บาท
สแกนตรวจสอบสลิป
`;

const SCB = `
โอนเงินสำเร็จ
06 ต.ค. 2569 - 10:35
รหัสอ้างอิง: 2026100612345678ABCDE1234
จาก
นาย สมชาย ใจดี
xxx-xxx123-4
ไปยัง
บริษัท เทอมตี จำกัด
xxx-xxx567-8
จำนวนเงิน
1,500.00
`;

// Krungthai NEXT: spaces inserted inside Thai words, decomposed sara am, O/0 noise
const KTB = `
กรุงไทย
โอนเงิน สำเร็จ
รหัสอ้างอิง 2026100610350001
จาก นาย สมชาย ใจดี
XXX-X-XX123-4
ไปยัง บจก. เทอมตี
XXX-X-X5678-X
จ ํา น วน เงิน 1,5OO.OO บาท
ค่าธรรมเนียม 0.00 บาท
วันที่ทำรายการ 06 ต.ค. 2569 - 10:35
`;

// Bangkok Bank English
const BBL = `
Transfer successful
From
MR. SOMCHAI JAIDEE
Bangkok Bank
123-x-xx456-7
To
TERMTEE CO., LTD.
SCB
XXX-X-X5678-X
Amount 1,500.00 THB
Fee 0.00 THB
06 Oct 26, 10:35
Transaction Ref. 0012345678901234
`;

// Krungsri with Thai digits and full month name
const KRUNGSRI = `
กรุงศรี โอนเงินสำเร็จ
๖ ตุลาคม ๒๕๖๙ ๑๐:๓๕ น.
จาก
น.ส. สมหญิง รักดี
xxx-x-xx789-0
ถึง
บริษัท เทอมตี เอ็นเตอร์เทนเมนต์ จำกัด
xxx-x-x5678-x
จำนวนเงิน ๑,๕๐๐.๐๐ บาท
`;

// ttb with amount + "บาท" on separate lines and l/1 confusion in time
const TTB = `
ttb touch
โอนเงินสำเร็จ
06 ต.ค. 69, l0:35
จาก นาย สมชาย ใจดี
xxx-x-x2222-x
ไปที่ บจก. เทอมตี
xxx-x-x5678-x
จำนวนเงิน
1,500.00
บาท
ยอดเงินคงเหลือ 12,345.67 บาท
`;

// PromptPay to a phone number (GSB MyMo)
const GSB_PROMPTPAY = `
MyMo
ทำรายการสำเร็จ
ผู้โอน นาง มาลี ศรีสุข
xxx-x-xx333-4
ผู้รับ
นาย ทีม เทอมตี
พร้อมเพย์
08x-xxx-5678
จำนวน 1,500.00 บาท
ค่าธรรมเนียม 0.00 บาท
วันที่ 06/10/2569 เวลา 10:35:12
`;

// Gregorian numeric date, English month after day
const ENGLISH_GREG = `
Payment completed
6 Oct 2026 10:35
To: TERMTEE CO., LTD. XXX-X-X5678-X
Amount: 1,500.00 THB
`;

describe("normalizeOcrText", () => {
  it("converts Thai digits", () => {
    assert.equal(normalizeOcrText("๑,๕๐๐.๐๐"), "1,500.00");
  });
  it("fixes O/0 and l/1 confusion inside numbers only", () => {
    assert.equal(normalizeOcrText("1,5OO.OO บาท"), "1,500.00 บาท");
    assert.equal(normalizeOcrText("l0:35"), "10:35");
    assert.equal(normalizeOcrText("Oct OK"), "Oct OK");
  });
  it("recomposes sara am", () => {
    assert.equal(normalizeOcrText("จํานวน"), "จำนวน");
  });
});

describe("extractAmount", () => {
  it("K PLUS (label on previous line, ignores fee)", () => assert.equal(extractAmount(KPLUS), 150000));
  it("SCB (no currency)", () => assert.equal(extractAmount(SCB), 150000));
  it("Krungthai (spaced Thai, O->0)", () => assert.equal(extractAmount(KTB), 150000));
  it("Bangkok Bank (THB)", () => assert.equal(extractAmount(BBL), 150000));
  it("Krungsri (Thai digits)", () => assert.equal(extractAmount(KRUNGSRI), 150000));
  it("ttb (ignores balance)", () => assert.equal(extractAmount(TTB), 150000));
  it("GSB PromptPay", () => assert.equal(extractAmount(GSB_PROMPTPAY), 150000));
  it("plain '1,500.00 บาท'", () => assert.equal(extractAmount("โอนเงิน\n1,500.00 บาท"), 150000));
  it("฿ prefix and decimals", () => assert.equal(extractAmount("Amount ฿99.50"), 9950));
  it("no date confusion", () => assert.equal(extractAmount("06.10.2569 10:35"), null));
  it("fee only -> null", () => assert.equal(extractAmount("ค่าธรรมเนียม 0.00 บาท"), null));
  it("conflicting amounts -> null", () => assert.equal(extractAmount("จำนวน 100.00 บาท\nจำนวน 200.00 บาท"), null));
  it("unlabeled number -> null", () => assert.equal(extractAmount("ref 1500.00"), null));
});

describe("extractDateTime", () => {
  it("K PLUS short BE year", () => assert.deepEqual(extractDateTime(KPLUS, NOW), T1035));
  it("SCB full BE year with dash", () => assert.deepEqual(extractDateTime(SCB, NOW), T1035));
  it("Krungthai", () => assert.deepEqual(extractDateTime(KTB, NOW), T1035));
  it("Bangkok Bank '06 Oct 26, 10:35' (CE 2-digit)", () => assert.deepEqual(extractDateTime(BBL, NOW), T1035));
  it("Krungsri Thai digits + full month", () => assert.deepEqual(extractDateTime(KRUNGSRI, NOW), T1035));
  it("ttb 'l0:35'", () => assert.deepEqual(extractDateTime(TTB, NOW), T1035));
  it("numeric dd/mm/BE with seconds", () =>
    assert.deepEqual(extractDateTime(GSB_PROMPTPAY, NOW), new Date("2026-10-06T03:35:12Z")));
  it("Gregorian '6 Oct 2026 10:35'", () => assert.deepEqual(extractDateTime(ENGLISH_GREG, NOW), T1035));
  it("abbreviation without dots 'ตค'", () => assert.deepEqual(extractDateTime("6 ตค 69 10:35", NOW), T1035));
  it("abbreviation with spaces 'ต. ค.'", () => assert.deepEqual(extractDateTime("6 ต. ค. 2569 10:35 น.", NOW), T1035));
  it("มี.ค. is March, not ม.ค.", () =>
    assert.deepEqual(extractDateTime("1 มี.ค. 69 08:00", NOW), new Date("2026-03-01T01:00:00Z")));
  it("Month-first English 'Oct 6, 2026 10:35'", () => assert.deepEqual(extractDateTime("Oct 6, 2026 10:35", NOW), T1035));
  it("crosses midnight UTC correctly (01:15 Bangkok)", () =>
    assert.deepEqual(extractDateTime("6 ต.ค. 69 01:15", NOW), new Date("2026-10-05T18:15:00Z")));
  it("date without time -> null", () => assert.equal(extractDateTime("6 ต.ค. 2569", NOW), null));
  it("invalid day -> null", () => assert.equal(extractDateTime("31 ก.พ. 2569 10:00", NOW), null));
  it("no date -> null", () => assert.equal(extractDateTime("10:35", NOW), null));
});

describe("resolveYear", () => {
  it("handles BE/CE", () => {
    assert.equal(resolveYear("2569", NOW), 2026);
    assert.equal(resolveYear("2026", NOW), 2026);
    assert.equal(resolveYear("69", NOW), 2026);
    assert.equal(resolveYear("26", NOW), 2026);
    assert.equal(resolveYear("1234", NOW), null);
  });
});

describe("extractReceiver", () => {
  it("K PLUS (no labels: second block)", () =>
    assert.deepEqual(extractReceiver(KPLUS), { name: "บจก. เทอมตี", account: "xxx-x-x5678-x" }));
  it("SCB (ไปยัง on own line)", () =>
    assert.deepEqual(extractReceiver(SCB), { name: "บริษัท เทอมตี จำกัด", account: "xxx-xxx567-8" }));
  it("Krungthai (marker + name same line, uppercase X)", () =>
    assert.deepEqual(extractReceiver(KTB), { name: "บจก. เทอมตี", account: "xxx-x-x5678-x" }));
  it("Bangkok Bank (To, skips bank line)", () =>
    assert.deepEqual(extractReceiver(BBL), { name: "TERMTEE CO., LTD.", account: "xxx-x-x5678-x" }));
  it("Krungsri (ถึง)", () =>
    assert.deepEqual(extractReceiver(KRUNGSRI), {
      name: "บริษัท เทอมตี เอ็นเตอร์เทนเมนต์ จำกัด",
      account: "xxx-x-x5678-x",
    }));
  it("ttb (ไปที่)", () => assert.deepEqual(extractReceiver(TTB), { name: "บจก. เทอมตี", account: "xxx-x-x5678-x" }));
  it("PromptPay phone (ผู้รับ, skips พร้อมเพย์)", () =>
    assert.deepEqual(extractReceiver(GSB_PROMPTPAY), { name: "นาย ทีม เทอมตี", account: "08x-xxx-5678" }));
  it("name and account on the marker line", () =>
    assert.deepEqual(extractReceiver(ENGLISH_GREG), { name: "TERMTEE CO., LTD.", account: "xxx-x-x5678-x" }));
  it("O inside masked account -> 0", () =>
    assert.equal(extractReceiver("ไปยัง\nบจก. เทอมตี\nxxx-x-x5O78-x").account, "xxx-x-x5078-x"));
  it("single unlabeled account -> unsure", () =>
    assert.deepEqual(extractReceiver("โอนเงินสำเร็จ\nนาย ก ข\nxxx-x-x1234-x"), { name: null, account: null }));
  it("does not take the reference number or date as account", () =>
    assert.equal(extractReceiver("ไปยัง\nรหัสอ้างอิง 2026-1006-1035\n06-10-2569\nบจก. เทอมตี").account, null));
  it("empty text", () => assert.deepEqual(extractReceiver(""), { name: null, account: null }));
});

describe("parseSlipText", () => {
  it("combines all fields", () => {
    assert.deepEqual(parseSlipText(SCB, { now: NOW }), {
      amountSatang: 150000,
      transferredAt: T1035,
      receiverName: "บริษัท เทอมตี จำกัด",
      receiverAccount: "xxx-xxx567-8",
    });
  });
  it("garbage gives nulls", () => {
    assert.deepEqual(parseSlipText("@@ ### lorem ipsum", { now: NOW }), {
      amountSatang: null,
      transferredAt: null,
      receiverName: null,
      receiverAccount: null,
    });
  });
});
