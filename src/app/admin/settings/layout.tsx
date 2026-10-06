import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { can } from "@/lib/roles";
import { loginUrl } from "@/lib/safe-redirect";
import SettingsTabs, { type SettingsTab } from "./settings-tabs";

export const metadata = { title: "ตั้งค่าร้าน" };

export default async function SettingsLayout({ children }: LayoutProps<"/admin/settings">) {
  const user = await currentUser();
  if (!user) redirect(loginUrl("/admin/settings"));
  const settings = can(user.role, "settings");
  const team = can(user.role, "team");
  if (!settings && !team) notFound();

  const tabs: SettingsTab[] = [
    ...(settings
      ? [
          { href: "/admin/settings", label: "ข้อมูลร้าน" },
          { href: "/admin/settings/payment", label: "รับเงินและตรวจสลิป" },
          { href: "/admin/settings/receipt", label: "ใบเสร็จและภาษี" },
          { href: "/admin/settings/protection", label: "การดูและการป้องกัน" },
          { href: "/admin/settings/policies", label: "นโยบาย" },
        ]
      : []),
    ...(team ? [{ href: "/admin/settings/team", label: "ทีมงาน" }] : []),
    ...(user.role === "ADMIN" ? [{ href: "/admin/settings/audit", label: "บันทึกการแก้ไข" }] : []),
  ];

  return (
    <>
      <div className="flex flex-col">
        <h1 className="text-[28px] leading-[38px] font-bold">ตั้งค่าร้าน</h1>
        <span className="text-sm text-muted">ข้อมูลที่ลูกค้าเห็น การรับเงิน ใบเสร็จ การป้องกัน และทีมงาน</span>
      </div>
      <SettingsTabs tabs={tabs} />
      <div className="flex max-w-[960px] flex-col gap-5">{children}</div>
    </>
  );
}
