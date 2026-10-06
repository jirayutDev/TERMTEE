"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type shakaNs from "shaka-player/dist/shaka-player.compiled";
import type { DrmSystem } from "@/lib/drm/types";
import { detectDrmSupport } from "./drm-support";
import Watermark from "./Watermark";
import {
  ClockIcon,
  DevicesIcon,
  ExitFullscreenIcon,
  FullscreenIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  ShieldAlertIcon,
  VolumeIcon,
  WarningIcon,
} from "@/components/ui/icons";

type ShakaPlayer = shakaNs.Player;

export interface PlayerProps {
  eventId: string;
  mode: "live" | "replay";
  /** DASH manifest (.mpd). HLS for FairPlay is derived by swapping the extension. */
  manifestUrl: string;
  viewerEmail: string;
  viewerId: string;
  /** Display-only: "ดูได้ถึง …" chip on replays. */
  replayUntil?: string | null;
}

type Phase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "kicked" }
  | { kind: "denied"; reason?: string }
  | { kind: "error"; message: string };

interface TokenResponse {
  token: string;
  licenseUrl: string;
  fairplayCertUrl?: string;
}

const HEARTBEAT_MS = 30_000;
const DEVICE_KEY = "termtee.deviceId";
const PALLYCON_HEADER = "pallycon-customdata-v2";

const SHAKA_KEY_SYSTEM: Record<DrmSystem, string> = {
  Widevine: "com.widevine.alpha",
  PlayReady: "com.microsoft.playready.recommendation.3000",
  FairPlay: "com.apple.fps",
};

let memoryDeviceId: string | null = null;
function getDeviceId(): string {
  const make = () =>
    (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(
      /[^A-Za-z0-9_-]/g,
      "",
    );
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = make();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    memoryDeviceId ??= make();
    return memoryDeviceId;
  }
}

function hlsUrl(dashUrl: string) {
  return dashUrl.replace(/\.mpd(\?|#|$)/i, ".m3u8$1");
}

class KickedError extends Error {}

function fmtTime(sec: number) {
  if (!Number.isFinite(sec)) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const DENIED_TEXT: Record<string, string> = {
  no_ticket: "คุณยังไม่มีบัตรสำหรับรายการนี้",
  revoked: "บัตรของคุณถูกยกเลิก",
  not_started: "รายการยังไม่เริ่มถ่ายทอดสด",
  replay_expired: "หมดเวลาดูย้อนหลังแล้ว",
  archived: "รายการนี้ถูกนำออกแล้ว",
};

export default function Player({ eventId, mode, manifestUrl, viewerEmail, viewerId, replayUntil = null }: PlayerProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);

  // ---- Playback / DRM / heartbeat lifecycle ----
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let disposed = false;
    let player: ShakaPlayer | null = null;
    let hbTimer: ReturnType<typeof setInterval> | undefined;
    const deviceId = getDeviceId();

    let stopped = false;
    // First terminal state wins (e.g. "kicked" must not be overwritten by the
    // license error Shaka raises right after).
    const teardown = async (next: Phase) => {
      if (stopped) return;
      stopped = true;
      if (hbTimer) clearInterval(hbTimer);
      hbTimer = undefined;
      video.pause();
      const p = player;
      player = null;
      try {
        await p?.destroy();
      } catch {
        /* ignore */
      }
      video.removeAttribute("src");
      if (!disposed) setPhase(next);
    };

    /** Returns false if playback must stop. */
    const heartbeat = async (claim: boolean): Promise<boolean> => {
      try {
        const res = await fetch("/api/playback/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, deviceId, claim }),
          cache: "no-store",
        });
        if (res.status === 409) {
          await teardown({ kind: "kicked" });
          return false;
        }
        if (res.status === 401 || res.status === 403) {
          const body = (await res.json().catch(() => ({}))) as { reason?: string };
          await teardown({ kind: "denied", reason: body.reason });
          return false;
        }
        return res.ok || !claim; // transient errors on regular beats are tolerated
      } catch {
        return !claim; // network blip: keep playing, next beat will retry
      }
    };

    let drmSystem: DrmSystem = "Widevine";
    const fetchToken = async (): Promise<TokenResponse> => {
      const res = await fetch("/api/drm/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, drmSystem, deviceId }),
        cache: "no-store",
      });
      if (res.status === 409) {
        await teardown({ kind: "kicked" });
        throw new KickedError();
      }
      if (!res.ok) throw new Error(`token ${res.status}`);
      return (await res.json()) as TokenResponse;
    };

    (async () => {
      const support = await detectDrmSupport();
      if (disposed) return;
      if (!support) {
        router.replace("/unsupported");
        return;
      }
      drmSystem = support.system;

      // 1) Claim the single-device session (newest device wins).
      if (!(await heartbeat(true)) || disposed) return;
      hbTimer = setInterval(() => void heartbeat(false), HEARTBEAT_MS);

      // 2) Load the UI-less Shaka build on the client only.
      const shaka = (await import("shaka-player/dist/shaka-player.compiled")).default;
      if (disposed) return;
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        router.replace("/unsupported");
        return;
      }

      // 3) First token (also tells us license/cert URLs).
      let pendingToken: TokenResponse | null = await fetchToken();
      if (disposed) return;
      const { licenseUrl, fairplayCertUrl } = pendingToken;

      player = new shaka.Player();
      await player.attach(video);
      if (disposed) return;

      const keySystem = SHAKA_KEY_SYSTEM[drmSystem];
      player.configure({
        drm: {
          servers: {
            [keySystem]: licenseUrl,
            ...(drmSystem === "PlayReady" && {
              "com.microsoft.playready": licenseUrl,
              "com.microsoft.playready.recommendation": licenseUrl,
            }),
          },
          // Force PlayReady to SL3000 hardware key system.
          keySystemsMapping:
            drmSystem === "PlayReady"
              ? {
                  "com.microsoft.playready": keySystem,
                  "com.microsoft.playready.recommendation": keySystem,
                }
              : {},
          preferredKeySystems: [keySystem],
          defaultVideoRobustnessForWidevine: "HW_SECURE_ALL",
          advanced: {
            [keySystem]: {
              ...(drmSystem === "Widevine" && {
                videoRobustness: ["HW_SECURE_ALL"],
                audioRobustness: ["SW_SECURE_CRYPTO"],
              }),
              ...(drmSystem === "FairPlay" && fairplayCertUrl && { serverCertificateUri: fairplayCertUrl }),
              persistentStateRequired: false,
              sessionType: "temporary",
            },
          },
        },
        // Never downgrade quality: ABR off and no size-based restrictions.
        abr: { enabled: false, restrictToElementSize: false, restrictToScreenSize: false },
        streaming: { lowLatencyMode: false },
      });

      const net = player.getNetworkingEngine();
      const RequestType = shaka.net.NetworkingEngine.RequestType;
      net?.registerRequestFilter(async (type, request) => {
        if (type !== RequestType.LICENSE) return;
        // Fresh, short-lived token per license request (re-checks access + device lock).
        const tok = pendingToken ?? (await fetchToken());
        pendingToken = null;
        request.headers[PALLYCON_HEADER] = tok.token;
        if (drmSystem === "FairPlay" && request.body) {
          // PallyCon FairPlay expects form-encoded base64 SPC (verify with PallyCon docs).
          const spc = shaka.util.Uint8ArrayUtils.toStandardBase64(request.body);
          request.body = shaka.util.StringUtils.toUTF8(`spc=${encodeURIComponent(spc)}`);
          request.headers["Content-Type"] = "application/x-www-form-urlencoded";
        }
      });
      if (drmSystem === "FairPlay") {
        net?.registerResponseFilter((type, response, context) => {
          shaka.drm.FairPlay.commonFairPlayResponse(type, response, context);
        });
      }

      const pinHighest = () => {
        if (!player) return;
        const tracks = player.getVariantTracks();
        if (!tracks.length) return;
        const best = [...tracks].sort(
          (a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth,
        )[0];
        if (!best.active) player.selectVariantTrack(best, true);
      };

      player.addEventListener("error", (ev) => {
        const code = (ev as unknown as { detail?: { code?: number } }).detail?.code ?? 0;
        // 4012 = RESTRICTIONS_CANNOT_BE_MET (e.g. HDCP / output-restricted keys).
        const message =
          code === 4012 || code === 6014 || code === 6018
            ? "จอภาพหรือสายเชื่อมต่อไม่รองรับการป้องกัน HDCP — กรุณาถอดจอภายนอก/อุปกรณ์บันทึกหน้าจอ แล้วลองใหม่"
            : `ไม่สามารถเล่นวิดีโอได้ (รหัส ${code})`;
        void teardown({ kind: "error", message });
      });
      player.addEventListener("trackschanged", pinHighest);

      const url = drmSystem === "FairPlay" ? hlsUrl(manifestUrl) : manifestUrl;
      await player.load(url);
      if (disposed) return;
      pinHighest();
      setPhase({ kind: "ready" });
      video.play().catch(() => {
        /* autoplay blocked: user presses play */
      });
    })().catch((err: unknown) => {
      if (disposed || err instanceof KickedError) return;
      const code = (err as { code?: number })?.code;
      void teardown({
        kind: "error",
        message: `ไม่สามารถเริ่มเล่นวิดีโอได้${code ? ` (รหัส ${code})` : ""} กรุณาลองใหม่อีกครั้ง`,
      });
    });

    return () => {
      disposed = true;
      if (hbTimer) clearInterval(hbTimer);
      void player?.destroy();
      player = null;
    };
  }, [eventId, manifestUrl, router]);

  // ---- Video element state + anti-PiP ----
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onTime = () => setTime(v.currentTime);
    const onDur = () => setDuration(v.duration);
    const onVol = () => {
      setMuted(v.muted);
      setVolume(v.volume);
    };
    const onPip = () => {
      if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("volumechange", onVol);
    v.addEventListener("enterpictureinpicture", onPip);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("volumechange", onVol);
      v.removeEventListener("enterpictureinpicture", onPip);
    };
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    // Element fullscreen keeps the watermark; iPhone only supports native video
    // fullscreen (which would drop the overlay), so the button is hidden there.
    const t = setTimeout(() => setCanFullscreen(Boolean(document.fullscreenEnabled)), 0);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      clearTimeout(t);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || phase.kind !== "ready") return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, [phase.kind]);

  const toggleMute = () => {
    const v = videoRef.current;
    if (v) v.muted = !v.muted;
  };

  const changeVolume = (val: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = val;
    v.muted = val === 0;
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => {});
  };

  const seek = (val: number) => {
    const v = videoRef.current;
    if (v && mode === "replay") v.currentTime = val;
  };

  const overlay = (() => {
    switch (phase.kind) {
      case "loading":
        return (
          <div className="flex flex-col items-center gap-3.5">
            <span className="spin size-10 rounded-full border-[3px] border-white/14 border-t-accent-hover" aria-hidden />
            <p className="text-[15px] font-semibold">กำลังเช็กเครื่องและเตรียมวิดีโอ…</p>
          </div>
        );
      case "kicked":
        return (
          <div className="flex flex-col items-center gap-2.5">
            <DevicesIcon size={34} className="text-warning" />
            <p className="text-base font-bold">หยุดเล่นบนเครื่องนี้แล้ว</p>
            <p className="text-[13px] text-muted">
              ตั๋วนี้ถูกเปิดดูที่เครื่องอื่น หรือถูกนำออกโดยผู้ดูแล · 1 ตั๋วดูได้ทีละ 1 เครื่อง
            </p>
            <button onClick={() => window.location.reload()} className="btn btn-primary shadow-none">
              ดูที่เครื่องนี้แทน
            </button>
          </div>
        );
      case "denied":
        return (
          <div className="flex flex-col items-center gap-2.5">
            {phase.reason === "revoked" ? (
              <span className="badge badge-danger">ถูกยกเลิก</span>
            ) : phase.reason === "replay_expired" || phase.reason === "archived" ? (
              <ClockIcon size={34} className="text-muted" />
            ) : (
              <ShieldAlertIcon size={34} className="text-warning" />
            )}
            <p className="text-base font-bold">
              {(phase.reason && DENIED_TEXT[phase.reason]) ?? "คุณไม่มีสิทธิ์รับชมรายการนี้"}
            </p>
            <Link href="/library" className="btn btn-outline">
              กลับไปตั๋วของฉัน
            </Link>
          </div>
        );
      case "error":
        return (
          <div className="flex max-w-md flex-col items-center gap-2.5">
            <WarningIcon size={34} className="text-warning" />
            <p className="text-[13px] leading-5 text-danger-fg">{phase.message}</p>
            <button onClick={() => window.location.reload()} className="btn btn-secondary">
              ลองอีกครั้ง
            </button>
          </div>
        );
      default:
        return null;
    }
  })();

  const ctrl =
    "grid size-11 shrink-0 place-items-center rounded-md text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-link";

  return (
    <div
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      className="group relative aspect-video w-full overflow-hidden bg-black text-white select-none"
    >
      <video
        ref={videoRef}
        className="h-full w-full bg-black"
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
        onClick={togglePlay}
      />

      <Watermark email={viewerEmail} userId={viewerId} />

      {mode === "replay" && replayUntil && phase.kind === "ready" && (
        <span className="pointer-events-none absolute top-2 right-2 z-30 inline-flex h-6 items-center rounded-full bg-stage/60 px-2.5 text-xs text-[#E3E8FF]">
          ดูได้ถึง {replayUntil}
        </span>
      )}

      {overlay && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-stage/78 p-4 text-center backdrop-blur-sm">
          {overlay}
        </div>
      )}

      {phase.kind === "ready" && (
        <div
          className={`absolute inset-x-0 bottom-0 z-30 flex flex-col bg-linear-to-t from-stage/88 to-transparent px-[clamp(4px,1vw,12px)] pt-6 pb-0.5 transition-opacity ${
            paused ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
          }`}
        >
          {mode === "replay" && (
            <input
              type="range"
              aria-label="ตำแหน่งวิดีโอ"
              min={0}
              max={Number.isFinite(duration) ? duration : 0}
              step={1}
              value={time}
              onChange={(e) => seek(Number(e.target.value))}
              className="mx-2.5 h-6 accent-accent-hover"
            />
          )}
          <div className="flex items-center gap-0.5 text-sm">
            <button onClick={togglePlay} aria-label={paused ? "เล่น" : "หยุดชั่วคราว"} className={ctrl}>
              {paused ? <PlayIcon size={22} /> : <PauseIcon size={22} />}
            </button>
            <button onClick={toggleMute} aria-label={muted ? "เปิดเสียง" : "ปิดเสียง"} className={ctrl}>
              {muted || volume === 0 ? <MuteIcon size={22} /> : <VolumeIcon size={22} />}
            </button>
            <input
              type="range"
              aria-label="ระดับเสียง"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              className="hidden w-24 accent-white sm:block"
            />
            {mode === "live" ? (
              <span className="ml-1 inline-flex h-[22px] items-center gap-[5px] rounded-full bg-live px-2 text-[11px] font-bold tracking-[0.08em]">
                <span className="size-[5px] animate-live-pulse rounded-full bg-white" aria-hidden />
                LIVE
              </span>
            ) : (
              <span className="tabular ml-1 text-[13px] text-[#E3E8FF]">
                {fmtTime(time)} / {fmtTime(duration)}
              </span>
            )}
            <div className="flex-1" />
            {canFullscreen && (
              <button onClick={toggleFullscreen} aria-label={isFullscreen ? "ออกจากเต็มจอ" : "เต็มจอ"} className={ctrl}>
                {isFullscreen ? <ExitFullscreenIcon size={22} /> : <FullscreenIcon size={22} />}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
