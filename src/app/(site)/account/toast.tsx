"use client";

import { useEffect, useState } from "react";

export type ToastMsg = { text: string; tone: "ok" | "error"; at: number };

/** Bottom-centre status toast that hides itself after a few seconds. */
export function Toast({ toast }: { toast: ToastMsg | null }) {
  const [hidden, setHidden] = useState<number | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setHidden(toast.at), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const show = toast && hidden !== toast.at;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      {show && (
        <div className="flex items-center gap-3 rounded-[14px] border border-white/10 bg-toast px-4 py-3 shadow-[0_20px_40px_-12px_rgb(0_0_0/0.6)]">
          <span className={`size-2 rounded-full ${toast.tone === "ok" ? "bg-success" : "bg-danger"}`} aria-hidden />
          <span className="text-sm">{toast.text}</span>
        </div>
      )}
    </div>
  );
}
