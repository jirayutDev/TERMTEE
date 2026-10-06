import type { Metadata } from "next";
import { getSettings, settingsUpdatedAt } from "@/lib/settings";
import PolicyDoc from "../policy-doc";

export const metadata: Metadata = { title: "นโยบายความเป็นส่วนตัว" };

export default async function PrivacyPage() {
  const [settings, updated] = await Promise.all([getSettings(), settingsUpdatedAt()]);
  return (
    <PolicyDoc
      title="นโยบายความเป็นส่วนตัว"
      text={settings.policies.privacy}
      updatedAt={updated.policies ?? null}
      shopName={settings.shop.name}
    />
  );
}
