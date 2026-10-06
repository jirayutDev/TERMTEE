"use client";

import { useEffect, useState } from "react";
import { CopyIcon, ShareIcon } from "./icons";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copy a value. `label` names what is copied (for screen readers / icon-only mode). */
export function CopyButton({
  value,
  label,
  iconOnly = false,
  className = "",
}: {
  value: string;
  label: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => setCopied(await writeClipboard(value))}
      aria-label={iconOnly ? `คัดลอก ${label}` : undefined}
      className={
        iconOnly
          ? `grid size-11 shrink-0 place-items-center rounded-[10px] border border-white/12 text-soft hover:bg-white/6 ${className}`
          : `btn btn-secondary shrink-0 rounded-[10px] text-sm ${className}`
      }
    >
      {iconOnly ? <CopyIcon size={18} /> : copied ? "คัดลอกแล้ว" : "คัดลอก"}
      <span role="status" className="sr-only">
        {copied ? `คัดลอก ${label} แล้ว` : ""}
      </span>
    </button>
  );
}

/** Native share sheet, falling back to copying the page URL. */
export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <span className="relative">
      <button
        type="button"
        aria-label="แชร์"
        onClick={async () => {
          const url = window.location.href;
          if (navigator.share) {
            try {
              await navigator.share({ title, url });
              return;
            } catch {
              // cancelled or unsupported: fall through to copy
            }
          }
          setCopied(await writeClipboard(url));
        }}
        className="grid size-11 place-items-center rounded-md border border-white/12 bg-white/[0.04] text-fg hover:bg-white/8"
      >
        <ShareIcon size={18} />
      </button>
      <span
        role="status"
        className={`absolute top-full right-0 mt-2 rounded-[14px] border border-white/10 bg-toast px-3 py-2 text-sm whitespace-nowrap shadow-card ${copied ? "" : "sr-only"}`}
      >
        {copied ? "คัดลอกลิงก์แล้ว" : ""}
      </span>
    </span>
  );
}
