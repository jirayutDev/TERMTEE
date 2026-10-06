"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { loginUrl } from "@/lib/safe-redirect";

const ERROR_TEXT: Record<string, string> = {
  not_on_sale: "อีเวนต์นี้ยังไม่เปิดขายหรือปิดการขายแล้ว",
  event_not_found: "ไม่พบอีเวนต์นี้",
};

export default function BuyButton({
  eventId,
  label,
  disabled = false,
}: {
  eventId: string;
  label: string;
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [owned, setOwned] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  async function buy() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      });

      if (res.status === 401) {
        router.push(loginUrl(pathname));
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { orderId?: string; error?: string };
      if (res.ok && data.orderId) {
        router.push(`/pay/${data.orderId}`);
        return;
      }
      if (data.error === "already_owned") {
        setOwned(true);
      } else {
        setError(ERROR_TEXT[data.error ?? ""] ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
      }
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }
    setLoading(false);
  }

  if (owned) {
    return (
      <div className="rounded-[14px] border border-success/40 bg-success/10 p-4 text-sm text-success-fg">
        คุณมีตั๋วสำหรับอีเวนต์นี้แล้ว{" "}
        <Link href="/library" className="font-semibold underline underline-offset-2">
          ไปที่ตั๋วของฉัน
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={buy} disabled={disabled || loading} className="btn btn-lg btn-primary w-full">
        {loading ? (
          <>
            <span className="spin size-4 rounded-full border-2 border-white/35 border-t-white" aria-hidden />
            กำลังไปหน้าชำระเงิน…
          </>
        ) : (
          label
        )}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}
