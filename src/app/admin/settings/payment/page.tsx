import { getSettingsSection } from "@/lib/settings";
import { pageUser } from "../../guard";
import { PaymentForm } from "../forms";

export default async function PaymentSettingsPage() {
  await pageUser("settings", "/admin/settings/payment");
  const values = await getSettingsSection("payment");
  return <PaymentForm values={values} />;
}
