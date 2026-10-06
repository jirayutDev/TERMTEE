# TERMTEE media server

Ingest → DRM packaging → CDN origin for live events, and the same encrypted segments as the replay.

```
rights holder ──SRT/RTMP──► MediaMTX ──RTSP (internal)──► ffmpeg ─┐
rights holder ──HLS / DASH / RTSP URL (pull)─────────────► ffmpeg ─┤ MPEG-TS via FIFO
web page ──► capture (Chromium + Xvfb + ffmpeg) ──HTTP TS─► ffmpeg ─┤   (BROWSER)
                                                                    ▼
             PallyCon KMS ──CPIX key──► control ──► Shaka Packager (CMAF, CENC cbcs,
                                                    Widevine + PlayReady + FairPlay)
                                                                    ▼
                                    data/output/<eventId>/manifest.mpd + manifest.m3u8 + video/ audio/
                                                                    ▼
                                                     nginx origin (CORS) ──► CDN ──► player
```

- **No quality reduction.** H.264/AAC sources (push, HLS, DASH, RTSP) pass through with `-c copy`, at native resolution. Only a non-H.264 video source is re-encoded (H.264, CRF 18, capped at 1080p); non-AAC audio becomes AAC. One rendition only. `TRANSCODE=auto|always|never`.
- **One set of segments for all DRMs.** Shaka Packager uses CENC `cbcs` with raw keys from PallyCon KMS (`control/src/kms.ts`), and writes DASH (`manifest.mpd`) and HLS (`manifest.m3u8`) side by side. Segments are about 2 s long (`SEGMENT_SECONDS`), so keep the encoder's keyframe interval at 2 s.
- **Replay.** On stop, the control service turns the live manifests into VOD (static MPD, `#EXT-X-ENDLIST`) that point at the same segments. `DELETE /events/:id` (or `npm run cleanup -- <id>`) removes the folder when the replay expires.
- **Reconnects.** The packager runs once per event and keeps the FIFO open, so if the publisher drops and comes back, packaging continues with continuous segment numbering. The gap shows up as a gap in the timeline.
- **Auth.** MediaMTX asks `control` about every publish and read (`/mediamtx/auth`). A publish only succeeds for a started event whose stream key and protocol match. Reads are limited to the internal RTSP user.

## Control API (contract: `src/lib/media/types.ts`, mirrored in `control/src/contract.ts`)

All calls need `Authorization: Bearer $MEDIA_CONTROL_SECRET`.

| Call | Result |
| --- | --- |
| `POST /events/:eventId/start` `StartEventRequest` | `200 { ingestUrl? }` (idempotent). Fetches the DRM key; pull inputs start right away (BROWSER: Chromium is launched before the call returns) |
| `POST /events/:eventId/stop` | `202`, then the `live.ended` callback (manifest is now VOD) |
| `DELETE /events/:eventId` | `204`, segments deleted |

Callbacks go to `POST ${APP_URL}/api/media/callback` with the same Bearer token:
- `live.started`: sent when the first segment and manifest exist.
- `live.ended`: sent after stop, once finalized.
- `live.error`: sent when packaging fails, or on boot when an interrupted live gets finalized.

`manifestUrl = ${CDN_BASE_URL}/<eventId>/manifest.mpd`. To get the HLS URL, replace `.mpd` with `.m3u8`.

### Input types

| `inputType` | `inputUrl` | How it works | Quality |
| --- | --- | --- | --- |
| `SRT` | none | Source pushes to MediaMTX (`ingestUrl` returned) | Passthrough |
| `RTMP` | none | Source pushes to MediaMTX (`ingestUrl` returned) | Passthrough |
| `HLS` | `http(s)://…m3u8` | ffmpeg pulls; highest-resolution variant. Event stops when the playlist ends | Passthrough |
| `DASH` | `http(s)://…mpd` | ffmpeg pulls; highest video representation. Event stops when the MPD ends | Passthrough |
| `RTSP` | `rtsp://` or `rtsps://` (credentials in the URL are fine) | ffmpeg pulls over TCP (`-rtsp_transport tcp`); reconnects when the source drops | Passthrough |
| `BROWSER` | `http(s)://` page | Chromium renders the page in the `capture` container; screen + audio are encoded | **Re-encoded** H.264 high 1080p30 (CRF 18, max 8 Mbps) + AAC 192k |

"Passthrough" = `-c copy` when the source is H.264/AAC, never downscaled; other codecs are transcoded as described above. Pull types retry when the source hiccups and fail the event (`live.error`) after about 10 failed probe rounds in a row.

**URL guard (all pull types).** The scheme must match the type, and the host must not resolve to a private, loopback, link-local, CGNAT or other reserved address (blocks SSRF into the compose network, the LAN or `169.254.169.254`). `ALLOW_PRIVATE_INPUT_HOSTS=true` turns the address check off for local testing; never set it in production. The check covers the URL given at start only: redirects, HLS/DASH segment hosts and anything a captured page loads are not re-checked, so use an egress firewall if that matters.

## Run locally

```bash
cd media
cp .env.example .env     # set MEDIA_CONTROL_SECRET (same as the app), tokens, PALLYCON_KMS_TOKEN
docker compose up -d --build
curl localhost:8080/healthz
```

Without a PallyCon token you can set `DRM_DEV_KEY_ID` / `DRM_DEV_KEY` (32 hex characters each) to test packaging. The output is encrypted, but no license server knows that key.

| Port | Service |
| --- | --- |
| 8890/udp | SRT ingest (MediaMTX) |
| 1935/tcp | RTMP ingest (MediaMTX) |
| 8080/tcp | control API (keep it private: only the app should reach it) |
| 8081/tcp | nginx origin for segments and manifests (put a CDN in front of it) |

Code checks without Docker: `cd control && npm install && npx tsc --noEmit`.

## Test

Start an event as the app would (or use the admin UI):

```bash
curl -X POST localhost:8080/events/evt1/start -H "Authorization: Bearer $MEDIA_CONTROL_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"evt1","contentId":"cid1","inputType":"SRT","streamKey":"key123"}'
# -> {"ingestUrl":"srt://localhost:8890?streamid=publish:key123"}
```

**OBS, SRT:** Settings → Stream → Service *Custom*, Server `srt://<host>:8890?streamid=publish:<streamKey>&latency=2000000`, leave Stream Key empty.
**OBS, RTMP** (start with `"inputType":"RTMP"`): Server `rtmp://<host>:1935/live`, Stream Key `<streamKey>`.
In OBS Output, use x264 or NVENC H.264, AAC, keyframe interval 2 s, 1080p, CBR.

**DASH pull:** `"inputType":"DASH","inputUrl":"https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd"` (a VOD MPD is pulled as fast as the network allows, then the event stops).
**RTSP pull:** `"inputType":"RTSP","inputUrl":"rtsp://user:pass@camera.example.com:554/stream1"`.
**BROWSER:** `"inputType":"BROWSER","inputUrl":"https://example.com/live-page"` (needs the capture container, see below).

**HLS pull:** start with `"inputType":"HLS","inputUrl":"https://…/master.m3u8"`. Pulling begins immediately, and the highest-resolution variant is used. When the source playlist ends, the event stops automatically.

**ffmpeg as a stand-in encoder:**

```bash
ffmpeg -re -f lavfi -i testsrc2=size=1920x1080:rate=30 -f lavfi -i sine=frequency=440 \
  -c:v libx264 -preset veryfast -b:v 6M -g 60 -pix_fmt yuv420p -c:a aac \
  -f mpegts "srt://localhost:8890?streamid=publish:key123&pkt_size=1316"
```

Then fetch `http://localhost:8081/evt1/manifest.mpd` and stop the event with `POST /events/evt1/stop`.

## BROWSER input (page capture)

Runs in its own `capture` container (`control/Dockerfile.capture`, code in `control/src/capture.ts`), enabled with `COMPOSE_PROFILES=browser` and a `CAPTURE_TOKEN` in `.env`. Per event it starts a fresh Xvfb display (1920x1080x24) with a minimal window manager, a PulseAudio null sink, Chromium in kiosk/app mode (`--autoplay-policy=no-user-gesture-required`, no infobars or scrollbars, throwaway profile) and ffmpeg (`x11grab` 30 fps + `pulse` → libx264 high, CRF 18, maxrate 8M, keyframe every `SEGMENT_SECONDS` + AAC 48 kHz 192k). control pulls the result as MPEG-TS from `GET /sessions/<eventId>/stream` and packages it like any other input.

Why a separate container rather than inside control: Chromium renders untrusted pages and, under Docker's default seccomp profile, runs with `--no-sandbox`. Keeping it out of control means a compromised renderer never shares a container with the DRM content keys or `MEDIA_CONTROL_SECRET`. The capture container holds only `CAPTURE_TOKEN`, runs as non-root with all capabilities dropped and `no-new-privileges`, and sits on its own `capture` network that only control joins. A managed Chromium policy also blocks `file://`, `chrome://`, localhost, metadata endpoints and the compose service names. It also gets its own CPU and memory budget (`CAPTURE_CPUS`, `CAPTURE_MEM_LIMIT`).

Stop, `DELETE` and failures kill the session's whole process groups (Chromium, the window manager, PulseAudio, Xvfb, ffmpeg), then sweep `/proc` for anything still using the session folder, then delete the profile. If control restarts, it finalizes the interrupted event as usual and sends `DELETE /sessions` to drop orphaned captures. Sessions nobody reads for `CAPTURE_IDLE_SECONDS` (90 s) are reaped as well. If the capture container restarts, control recreates the session and continues; the timeline shows a gap. If Chromium crashes, it is restarted up to 5 times.

Limits, read before selling this:
- **Re-encoded.** Quality is at best that of the page's own player: if the page plays a 720p stream, you get 720p upscaled into 1080p. Page UI (controls, overlays, cookie banners) is captured as-is.
- **No DRM sources.** This Chromium has no Widevine CDM, and nothing is added to obtain or bypass DRM. Pages that play Widevine/PlayReady/FairPlay-protected video show black (or an error). If the first `BROWSER_BLACK_CHECK_SECONDS` (30 s) are black, control sends a `live.error` explaining this. The live keeps running so you can decide.
- **No login in v1.** Each event starts from an empty profile: no cookies, no saved sessions, no extensions. Only public pages work.
- **Autoplay only.** Nothing clicks anything. The page must start playback by itself (muted-autoplay rules are lifted, so sound plays).
- **CPU cost.** Measured on a 12-thread desktop: about 2.2–2.5 cores for an animated 1080p30 page (x264 `veryfast` about 2 cores, Chromium software rendering about 0.5 core) and about 0.9–1 GB RAM. Plan about 4 dedicated cores per concurrent BROWSER event (`CAPTURE_MAX_SESSIONS`, default 1). Pages playing high-bitrate video in software decode cost more. control also decodes the first 30 s once, for the black check.

## Notes / limits

- PallyCon CPIX request/response details are marked `TODO(verify)` in `control/src/kms.ts`. Check them against the current PallyCon docs before production, in particular the FairPlay `skd://` URI and whether PallyCon PSSH is required.
- Job state lives in memory. If `control` restarts during a live, that live is finalized up to the interruption and reported as `live.error`.
- In tests, MediaMTX SRT dropped a publisher bursting about 30 Mbps or more at connect. Use CBR at a sane bitrate (6–15 Mbps for 1080p).
