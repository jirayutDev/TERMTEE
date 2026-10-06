import { getSettingsSection } from "@/lib/settings";
import { pageUser } from "../../guard";
import { ProtectionForm } from "../forms";

export default async function ProtectionSettingsPage() {
  await pageUser("settings", "/admin/settings/protection");
  const values = await getSettingsSection("protection");
  return <ProtectionForm values={values} />;
}
