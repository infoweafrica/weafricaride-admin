import { redirect } from "next/navigation";

export default function TicketsLegacyRedirectPage() {
  redirect("/admin/support/tickets");
}
