"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { PaymentStatus } from "@/generated/prisma/enums";

const POLL_MS = 5000;

/** Polls a slip that is still being checked and refreshes the page when its status changes. */
export default function PaymentPoller({ paymentId, status }: { paymentId: string; status: PaymentStatus }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/payment/${paymentId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const next = (await res.json()) as { status: PaymentStatus };
        if (next.status !== status) router.refresh();
      } catch {
        // network blip; try again next tick
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [paymentId, status, router]);

  return null;
}
