import { config } from "./config.js";
import type { MediaCallback } from "./contract.js";

/** POST a MediaCallback to the app, retrying a few times (the app may be redeploying). */
export async function sendCallback(cb: MediaCallback): Promise<void> {
  const url = `${config.appUrl}/api/media/callback`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.secret}` },
        body: JSON.stringify(cb),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        console.log(`[callback] ${cb.type} ${cb.eventId} -> ${res.status}`);
        return;
      }
      console.warn(`[callback] ${cb.type} ${cb.eventId} -> ${res.status} (attempt ${attempt})`);
      if (res.status >= 400 && res.status < 500) return; // not retryable
    } catch (err) {
      console.warn(`[callback] ${cb.type} ${cb.eventId} failed (attempt ${attempt}):`, (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  console.error(`[callback] giving up on ${cb.type} ${cb.eventId}`);
}
