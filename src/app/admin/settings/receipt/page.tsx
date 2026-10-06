import { getSettingsSection } from "@/lib/settings";
import { pageUser } from "../../guard";
import { ReceiptForm } from "../forms";

export default async function ReceiptSettingsPage() {
  await pageUser("settings", "/admin/settings/receipt");
  const values = await getSettingsSection("receipt");
  return <ReceiptForm values={values} />;
}
