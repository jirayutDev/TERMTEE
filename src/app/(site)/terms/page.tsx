import type { Metadata } from "next";
import { getSettings, settingsUpdatedAt } from "@/lib/settings";
import PolicyDoc from "../policy-doc";

export const metadata: Metadata = { title: "เงื่อนไขการใช้งาน" };

export default async function TermsPage() {
  const [settings, updated] = await Promise.all([getSettings(), settingsUpdatedAt()]);
  return (
    <PolicyDoc
      title="เงื่อนไขการใช้งาน"
      text={settings.policies.terms}
      updatedAt={updated.policies ?? null}
      shopName={settings.shop.name}
    />
  );
}
