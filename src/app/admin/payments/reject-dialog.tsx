"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/ui/confirm-dialog";

/** Fallback when settings have no presets (normally settings.payment.rejectReasons). */
const DEFAULT_PRESETS = ["ยอดในสลิปไม่ตรง", "สลิปไม่ชัด อ่านยอดหรือเลขอ้างอิงไม่ได้", "สลิปนี้เคยใช้แล้ว", "โอนไปผิดบัญชี"];
const OTHER = "__other";

/** Reject a slip with a customer-visible reason (posted as the `reason` field). */
export default function RejectDialog({
  action,
  email,
  wasVerified,
  presets: presetsProp,
}: {
  action: (formData: FormData) => Promise<void>;
  email: string;
  wasVerified: boolean;
  /** Reason presets from /admin/settings (payment.rejectReasons). */
  presets?: string[];
}) {
  const PRESETS = presetsProp?.length ? presetsProp : DEFAULT_PRESETS;
  const [preset, setPreset] = useState(PRESETS[0]);
  const [custom, setCustom] = useState("");
  const reason = preset === OTHER ? custom : preset;

  return (
    <ConfirmDialog
      action={action}
      trigger={wasVerified ? "ปฏิเสธ และยกเลิกตั๋ว…" : "ปฏิเสธสลิป…"}
      triggerClassName="btn btn-danger-outline w-full text-sm"
      title={`ปฏิเสธสลิปของ ${email}?`}
      body={
        wasVerified
          ? "ตั๋วจะถูกยกเลิกและคนดูถูกตัดออกจาก player ทันที คำสั่งซื้อจะกลับไปรอชำระ ลูกค้าแนบสลิปใหม่ได้"
          : "ลูกค้าจะเห็นเหตุผลในหน้าชำระเงิน และแนบสลิปใหม่ได้"
      }
      confirmLabel="ปฏิเสธสลิป"
    >
      <fieldset className="m-0 flex flex-col gap-0.5 border-0 p-0">
        <legend className="mb-1.5 text-[13px] font-semibold text-soft">เหตุผล (ลูกค้าจะเห็น)</legend>
        {[...PRESETS, OTHER].map((p) => (
          <label key={p} className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="radio"
              name="reasonPreset"
              checked={preset === p}
              onChange={() => setPreset(p)}
              className="size-[18px] accent-danger-fill"
            />
            {p === OTHER ? "อื่นๆ" : p}
          </label>
        ))}
      </fieldset>
      {preset === OTHER && (
        <input
          aria-label="เหตุผลอื่นๆ"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          maxLength={500}
          placeholder="พิมพ์เหตุผล"
          className="field"
        />
      )}
      <input type="hidden" name="reason" value={reason} />
    </ConfirmDialog>
  );
}
