"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

/** "live จะเริ่มใน" countdown for a ticket holder waiting for the show. */
export default function Countdown({ startsAt, label }: { startsAt: string; label: string }) {
  const router = useRouter();
  const target = new Date(startsAt).getTime();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  const left = now === null ? null : target - now;
  const p = parts(left ?? 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const units =
    p.d > 0
      ? [
          [p.d, "วัน"],
          [p.h, "ชั่วโมง"],
          [p.m, "นาที"],
        ]
      : [
          [p.h, "ชั่วโมง"],
          [p.m, "นาที"],
          [p.s, "วินาที"],
        ];

  return (
    <div className="flex flex-col items-center gap-2.5 text-center">
      {left !== null && left > 0 ? (
        <>
          <span className="text-[13px] text-muted">live จะเริ่มใน</span>
          <div className="flex items-start gap-2.5" role="timer" aria-live="off">
            {units.map(([v, u], i) => (
              <div key={u} className="flex items-start gap-2.5">
                {i > 0 && <span className="text-[clamp(24px,4vw,36px)] leading-[1.15] text-subtle">:</span>}
                <div className="flex flex-col items-center">
                  <span className="tabular text-[clamp(24px,4vw,36px)] leading-[1.15] font-bold">{pad(v as number)}</span>
                  <span className="text-[11px] text-muted">{u}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <span className="text-base font-bold">{left === null ? "" : "ใกล้ถึงเวลาเริ่มแล้ว"}</span>
      )}
      <span className="tabular text-[13px] text-soft">{label}</span>
      {left !== null && left <= 0 && (
        <button type="button" onClick={() => router.refresh()} className="btn btn-sm btn-secondary">
          รีเฟรชเพื่อเข้าดู
        </button>
      )}
    </div>
  );
}
