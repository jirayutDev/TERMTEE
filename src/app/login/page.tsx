import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { safeCallback } from "@/lib/safe-redirect";
import { CloseIcon, GoogleIcon, LogoMark } from "@/components/ui/icons";
import { signInWithGoogleAction } from "../auth-actions";

export const metadata: Metadata = { title: "เข้าสู่ระบบ", robots: { index: false } };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const callbackUrl = safeCallback(sp.callbackUrl);
  const hasError = !!sp.error;

  if (await currentUser()) redirect(callbackUrl);

  return (
    <div
      className="flex min-h-dvh flex-1 flex-col bg-bg"
      style={{
        backgroundImage:
          "radial-gradient(min(800px,120vw) 600px at 20% 20%, rgba(43,92,255,0.34), transparent 65%), radial-gradient(min(700px,110vw) 600px at 100% 60%, rgba(123,92,255,0.24), transparent 65%)",
      }}
    >
      <div className="mx-auto flex min-h-[60px] w-full max-w-[1200px] items-center px-3.5 sm:px-6">
        <Link href={callbackUrl} aria-label="ปิด" className="btn-icon">
          <CloseIcon size={22} />
        </Link>
      </div>
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-wrap content-center items-center gap-x-[clamp(24px,5vw,80px)] gap-y-8 px-[clamp(24px,4vw,48px)] pt-[clamp(8px,3vh,48px)] pb-[clamp(24px,5vh,56px)]">
        <div className="flex min-w-0 flex-[999_1_400px] flex-col gap-[clamp(14px,3vh,24px)]">
          <div className="flex items-center gap-3">
            <LogoMark size={48} hole="#0A1036" />
            <span className="font-brand text-[32px] font-bold tracking-[0.08em]">TERMTEE</span>
          </div>
          <h1 className="text-[clamp(28px,2vw+20px,52px)] leading-[1.3] font-bold text-balance">
            ดู live สด ดูย้อนหลังได้ ถูกลิขสิทธิ์
          </h1>
          <p className="max-w-[44ch] text-[clamp(15px,0.3vw+14px,18px)] leading-[1.6] text-soft">
            เข้าสู่ระบบเพื่อซื้อตั๋วและดูตั๋วของคุณได้ทุกเครื่องที่รองรับ
          </p>
        </div>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5">
          <form action={signInWithGoogleAction}>
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <button className="flex h-[54px] w-full items-center justify-center gap-3 rounded-[14px] bg-white text-base font-semibold text-[#1F1F1F] shadow-card hover:bg-[#EEF1FB]">
              <GoogleIcon />
              Login with Google
            </button>
          </form>
          {hasError && (
            <div
              role="alert"
              className="rounded-md border border-danger/40 bg-danger/10 px-3.5 py-3 text-sm text-[#FFC2CD]"
            >
              เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง
            </div>
          )}
          <p className="text-center text-xs leading-[18px] text-muted">
            ใช้บัญชี Google เดิมทุกครั้ง ตั๋วที่ซื้อไว้จะผูกกับบัญชีนี้
          </p>
        </div>
      </main>
    </div>
  );
}
