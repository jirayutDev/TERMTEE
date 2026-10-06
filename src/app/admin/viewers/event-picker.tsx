"use client";

import { useRouter } from "next/navigation";
import { useId } from "react";

/** Event selector for the viewers page (navigates on change). */
export default function EventPicker({ value, options }: { value: string; options: { id: string; label: string }[] }) {
  const router = useRouter();
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        event
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => router.push(`/admin/viewers?event=${encodeURIComponent(e.target.value)}`)}
        className="field min-w-[260px] max-w-full text-sm font-medium"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
