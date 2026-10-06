import { getSettingsSection } from "@/lib/settings";
import { pageUser } from "../../guard";
import { PoliciesForm } from "../forms";

export default async function PoliciesSettingsPage() {
  await pageUser("settings", "/admin/settings/policies");
  const values = await getSettingsSection("policies");
  return <PoliciesForm values={values} />;
}
