"use client";

import { useId, useState } from "react";
import { CopyButton } from "@/components/ui/copy-button";
import { EyeIcon } from "@/components/ui/icons";

/** Read-only secret (stream key) with show/hide and copy. */
export default function SecretField({ label, value }: { label: string; value: string }) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        {label}
      </label>
      <div className="flex gap-1.5">
        <input
          id={id}
          type={show ? "text" : "password"}
          readOnly
          value={value}
          className="field min-w-0 flex-1 font-mono text-[13px] text-soft"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? `ซ่อน ${label}` : `แสดง ${label}`}
          aria-pressed={show}
          className="grid size-11 shrink-0 place-items-center rounded-[10px] border border-white/12 text-soft hover:bg-white/6"
        >
          <EyeIcon size={18} />
        </button>
        <CopyButton value={value} label={label} iconOnly />
      </div>
    </div>
  );
}
