"use client";

import { useEffect, useId, useMemo } from "react";
import { UploadIcon, XMarkIcon } from "@/components/ui/icons";

export const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024; // matches UPLOAD_MAX_BYTES in src/lib/uploads.ts
const ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Up to 3 JPEG/PNG/WebP images, <= 5 MB each (checked again on the server by magic bytes).
 * Controlled: the parent owns `files` and appends them to its FormData as "files".
 */
export default function AttachmentInput({
  files,
  onChange,
  onError,
  disabled = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  onError: (message: string | null) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function add(list: FileList | null) {
    onError(null);
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!ACCEPT.split(",").includes(f.type)) {
        onError("รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP");
        continue;
      }
      if (f.size > MAX_BYTES) {
        onError(`ไฟล์ ${f.name} ใหญ่เกิน 5 MB`);
        continue;
      }
      if (next.length >= MAX_FILES) {
        onError(`แนบรูปได้สูงสุด ${MAX_FILES} รูป`);
        break;
      }
      next.push(f);
    }
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`} className="relative size-[72px] overflow-hidden rounded-md border border-white/12 bg-bg/60">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previews[i]} alt={f.name} className="h-full w-full object-cover" />
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(files.filter((_, j) => j !== i))}
            aria-label={`นำ ${f.name} ออก`}
            className="absolute top-0.5 right-0.5 grid size-7 place-items-center rounded-full bg-black/70 text-white hover:bg-black"
          >
            <XMarkIcon size={14} />
          </button>
        </div>
      ))}
      {files.length < MAX_FILES && (
        <label
          htmlFor={inputId}
          className="flex size-[72px] cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-[1.5px] border-dashed border-link/50 bg-accent/6 text-[11px] text-link focus-within:outline-2 focus-within:outline-link"
        >
          <UploadIcon size={20} />
          แนบรูป
          <input
            id={inputId}
            type="file"
            accept={ACCEPT}
            multiple
            disabled={disabled}
            className="sr-only"
            onChange={(e) => {
              add(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      )}
      <span className="text-xs text-muted">
        สูงสุด {MAX_FILES} รูป · JPG/PNG/WebP · รูปละไม่เกิน 5 MB
      </span>
    </div>
  );
}
