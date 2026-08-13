"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * This page used to show a hardcoded mock list of fake companies — no
 * Supabase calls, no create/edit/delete. Corporate accounts are a real
 * billing feature now and live under Finance instead of Marketing.
 * Redirect rather than delete the route outright, in case anything still
 * links here.
 */
export default function CorporateAccountsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/finance/corporate-accounts");
  }, [router]);

  return null;
}
