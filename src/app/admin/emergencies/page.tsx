import { redirect } from "next/navigation";

export default function EmergenciesLegacyRedirectPage() {
  redirect("/admin/safety/emergencies");
}
