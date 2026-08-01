"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * This page used to edit a `pricing_rules` table that no longer exists
 * (confirmed 2026-08-01 — every fetch silently fell back to hardcoded
 * mock data, every save silently failed). The fare engine
 * (compute_fare_estimate) reads `pricing_config`, which is what
 * /admin/finance/pricing actually edits. Redirect rather than delete
 * the route outright, in case anything still links here.
 */
export default function PricingRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/finance/pricing");
  }, [router]);

  return null;
}
