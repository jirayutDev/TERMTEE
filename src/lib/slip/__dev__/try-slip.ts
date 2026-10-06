/**
 * Manual test: read a slip image and print what was extracted.
 *
 *   npx tsx src/lib/slip/__dev__/try-slip.ts path/to/slip.jpg [amountBaht]
 *
 * First run downloads OCR traineddata (network required), cached in SLIP_OCR_CACHE_DIR.
 * Uses PAYMENT_ACCOUNTS / PAYMENT_NAMES from the environment for the evaluation part.
 */
import { readFile } from "node:fs/promises";
import { expectedFromEnv } from "../config";
import { evaluateSlip } from "../evaluate";
import { inspectSlipFile, sha256Hex } from "../image";
import { resetOcrWorker } from "../ocr";
import { parseSlipQr } from "../qr";
import { readSlip } from "../read";

async function main() {
  const [file, amount] = process.argv.slice(2);
  if (!file) {
    console.error("usage: tsx src/lib/slip/__dev__/try-slip.ts <image> [amountBaht]");
    process.exit(2);
  }
  const info = await inspectSlipFile(await readFile(file));
  console.log("file:", info.format, `${info.width}x${info.height}`, "sha256", sha256Hex(info.buffer));

  const t0 = Date.now();
  const data = await readSlip(info.buffer);
  console.log(`read in ${Date.now() - t0} ms`);
  console.log("---- OCR text ----\n" + data.ocrText + "\n------------------");
  if (data.qrPayload) console.log("qr:", parseSlipQr(data.qrPayload));
  console.log({ ...data, ocrText: undefined });

  if (amount) {
    const exp = expectedFromEnv({ amountSatang: Math.round(Number(amount) * 100), createdAt: new Date(Date.now() - 30 * 60_000) });
    console.log(JSON.stringify(evaluateSlip(data, exp), null, 2));
  }
  await resetOcrWorker();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
