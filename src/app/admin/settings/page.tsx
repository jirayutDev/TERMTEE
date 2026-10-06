import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { can } from "@/lib/roles";
import { getSettingsSection } from "@/lib/settings";
import { pageUser } from "../guard";
import { ShopForm } from "./forms";

export default async function ShopSettingsPage() {
  // Team-only staff (no "settings") land on the team tab.
  const me = await currentUser();
  if (me && !can(me.role, "settings") && can(me.role, "team")) redirect("/admin/settings/team");
  await pageUser("settings", "/admin/settings");
  const values = await getSettingsSection("shop");
  return <ShopForm values={values} />;
}
