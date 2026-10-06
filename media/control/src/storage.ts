import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { config, eventOutputDir, isSafeId, manifestUrl } from "./config.js";
import { sendCallback } from "./callback.js";
import { finalizeManifests } from "./manifest.js";

/** Delete an event's segments + manifests (replay expired). */
export async function deleteEventOutput(eventId: string): Promise<void> {
  await rm(eventOutputDir(eventId), { recursive: true, force: true });
}

/**
 * On boot, any manifest still "dynamic" belongs to a live that was interrupted by a restart
 * of this service. Finalize it into a replay of what was captured and tell the app.
 */
export async function recoverInterruptedEvents(): Promise<void> {
  const entries = await readdir(config.outputDir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory() || !isSafeId(e.name)) continue;
    const dir = path.join(config.outputDir, e.name);
    const mpd = await readFile(path.join(dir, "manifest.mpd"), "utf8").catch(() => undefined);
    if (!mpd || !/type="dynamic"/.test(mpd)) continue;
    console.warn(`[recover] finalizing interrupted event ${e.name}`);
    await finalizeManifests(dir);
    await sendCallback({
      type: "live.error",
      eventId: e.name,
      message: "Media server restarted during live; recording finalized up to the interruption",
    });
    // The finalized manifest is a valid replay, so move the event out of LIVE.
    await sendCallback({ type: "live.ended", eventId: e.name, manifestUrl: manifestUrl(e.name) });
  }
}
