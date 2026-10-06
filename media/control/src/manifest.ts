/**
 * Turn the live (dynamic) manifests written by Shaka Packager into VOD (static) manifests that
 * reference the very same encrypted segments, so the live recording becomes the replay.
 * Idempotent: running it twice is harmless.
 */
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function finalizeManifests(dir: string): Promise<void> {
  const files = await readdir(dir).catch(() => [] as string[]);
  for (const f of files) {
    const p = path.join(dir, f);
    if (f.endsWith(".mpd")) await rewrite(p, finalizeMpd);
    else if (f.endsWith(".m3u8")) await rewrite(p, finalizeHlsPlaylist);
  }
}

async function rewrite(file: string, fn: (s: string) => string): Promise<void> {
  const src = await readFile(file, "utf8");
  const out = fn(src);
  if (out === src) return;
  const tmp = `${file}.tmp`;
  await writeFile(tmp, out);
  await rename(tmp, file);
}

export function finalizeMpd(mpd: string): string {
  if (!/\btype="dynamic"/.test(mpd)) return mpd;

  // Media-time range (seconds) of every SegmentTimeline.
  const TEMPLATE = /<SegmentTemplate\b([^>]*)>([\s\S]*?)<\/SegmentTemplate>/g;
  const timeline = (attrs: string, inner: string) => {
    const timescale = Number(/\btimescale="(\d+)"/.exec(attrs)?.[1] ?? "1");
    let t0: number | undefined;
    let end = 0;
    for (const m of inner.matchAll(/<S\b([^>]*)\/>/g)) {
      const a = m[1] ?? "";
      const t = /\bt="(\d+)"/.exec(a)?.[1];
      const d = Number(/\bd="(\d+)"/.exec(a)?.[1] ?? "0");
      const r = Number(/\br="(-?\d+)"/.exec(a)?.[1] ?? "0");
      const start = t !== undefined ? Number(t) : end;
      if (t0 === undefined) t0 = start;
      end = start + d * (Math.max(r, 0) + 1);
    }
    return t0 === undefined ? undefined : { timescale, start: t0 / timescale, end: end / timescale };
  };

  let start = Infinity;
  let end = 0;
  for (const m of mpd.matchAll(TEMPLATE)) {
    const tl = timeline(m[1] ?? "", m[2] ?? "");
    if (tl) {
      start = Math.min(start, tl.start);
      end = Math.max(end, tl.end);
    }
  }
  if (!Number.isFinite(start)) start = 0;

  // One common presentationTimeOffset (earliest track start) keeps audio and video in sync.
  mpd = mpd.replace(TEMPLATE, (whole, attrs: string, inner: string) => {
    const tl = timeline(attrs, inner);
    if (!tl) return whole;
    const cleaned = attrs.replace(/\s+presentationTimeOffset="\d+"/, "");
    const pto = Math.round(start * tl.timescale);
    return `<SegmentTemplate${cleaned} presentationTimeOffset="${pto}">${inner}</SegmentTemplate>`;
  });

  const duration = `PT${Math.max(0, end - start).toFixed(3)}S`;
  mpd = mpd
    .replace(/<MPD\b[^>]*>/, (tagStr) =>
      tagStr
        .replace(/\btype="dynamic"/, 'type="static"')
        .replace(/\s+(minimumUpdatePeriod|timeShiftBufferDepth|availabilityStartTime|publishTime|suggestedPresentationDelay|mediaPresentationDuration)="[^"]*"/g, "")
        .replace(/\s*>$/, ` mediaPresentationDuration="${duration}">`),
    )
    .replace(/<UTCTiming\b[^>]*\/>\s*/g, "")
    .replace(/<UTCTiming\b[^>]*>[\s\S]*?<\/UTCTiming>\s*/g, "")
    .replace(/<Period\b([^>]*)>/g, (_m, a: string) => `<Period${a.replace(/\s+start="[^"]*"/, "")} start="PT0S">`);
  return mpd;
}

export function finalizeHlsPlaylist(m3u8: string): string {
  if (m3u8.includes("#EXT-X-STREAM-INF")) return m3u8; // master playlist, nothing to do
  let out = m3u8.replace(/#EXT-X-PLAYLIST-TYPE:EVENT/, "#EXT-X-PLAYLIST-TYPE:VOD");
  if (!out.includes("#EXT-X-PLAYLIST-TYPE")) out = out.replace("#EXTM3U\n", "#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n");
  if (!out.includes("#EXT-X-ENDLIST")) out = `${out.trimEnd()}\n#EXT-X-ENDLIST\n`;
  return out;
}
