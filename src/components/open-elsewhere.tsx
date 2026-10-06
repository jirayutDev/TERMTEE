"use client";

import { useSyncExternalStore } from "react";
import { CopyButton } from "@/components/ui/copy-button";

const subscribe = () => () => {};

/** Shows the full URL of `path` on this site so it can be opened on another device. */
export default function OpenElsewhere({ path }: { path: string }) {
  const origin = useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => "",
  );
  const url = `${origin}${path}`;

  return (
    <section className="glass-strong flex flex-col gap-2.5 rounded-xl p-[clamp(16px,2vw,24px)]">
      <label htmlFor="open-link" className="text-[15px] font-semibold">
        เปิดลิงก์นี้ในเครื่องอื่น
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="open-link"
          type="text"
          readOnly
          value={url}
          className="field min-h-12 min-w-0 flex-[999_1_220px] rounded-md font-mono text-[13px] text-soft"
        />
        <CopyButton value={url} label="ลิงก์" className="min-h-12 flex-[1_0_auto]" />
      </div>
      <span className="text-xs text-muted">login ด้วย Google บัญชีเดิม ตั๋วจะขึ้นให้อัตโนมัติ</span>
    </section>
  );
}
