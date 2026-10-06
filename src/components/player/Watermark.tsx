"use client";

import { useEffect, useState } from "react";

interface Props {
  /** Empty string hides the email line (settings.protection.watermarkShowEmail = false). */
  email: string;
  userId: string;
}

function format(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}:${p(d.getSeconds())}`;
}

function randomPos() {
  // Keep within 5–75% so the text never leaves the frame.
  return { top: 5 + Math.random() * 70, left: 5 + Math.random() * 60 };
}

/**
 * Forensic visible watermark. Must be rendered INSIDE the element that goes
 * fullscreen, otherwise it disappears in fullscreen mode.
 */
export default function Watermark({ email, userId }: Props) {
  const [pos, setPos] = useState({ top: 10, left: 10 });
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const move = () => {
      setPos(randomPos());
      setNow(new Date());
      timer = setTimeout(move, 5000 + Math.random() * 5000);
    };
    timer = setTimeout(move, 0);
    return () => clearTimeout(timer);
  }, []);

  const shortId = userId.slice(-8);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20 font-mono text-[11px] leading-[1.4] whitespace-nowrap text-white/30 select-none sm:text-[13px]"
      style={{ top: `${pos.top}%`, left: `${pos.left}%`, textShadow: "0 1px 2px rgba(0,0,0,0.55)" }}
    >
      {email && <div>{email}</div>}
      <div>
        #{shortId} · {now ? format(now) : ""}
      </div>
    </div>
  );
}
