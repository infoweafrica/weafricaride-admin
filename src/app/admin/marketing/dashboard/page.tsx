"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BarChart3, Bell, Gift, Image as ImageIcon, RefreshCw, Ticket, Users } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Summary = {
  promoCount: number;
  activePromos: number;
  promoUses: number;
  referralCount: number;
  pushCount: number;
  pushDelivered: number;
  banners: number;
  rewardsBalance: number;
};

const quickLinks = [
  { href: "/admin/marketing/promos", label: "Promo Codes", icon: Ticket, color: "bg-orange-50 text-orange-700", description: "FIRST50, AIRPORT20, WEEKEND10" },
  { href: "/admin/marketing/referrals", label: "Referrals", icon: Users, color: "bg-orange-50 text-orange-700", description: "Invite friends and earn rewards" },
  { href: "/admin/marketing/notifications", label: "Push Campaigns", icon: Bell, color: "bg-zinc-100 text-zinc-700", description: "Send rider announcements" },
  { href: "/admin/marketing/banners", label: "Home Banners", icon: ImageIcon, color: "bg-zinc-100 text-zinc-700", description: "Customer home-screen promotions" },
  { href: "/admin/marketing/analytics", label: "Analytics", icon: BarChart3, color: "bg-zinc-100 text-zinc-700", description: "Growth and retention KPIs" },
];

export default function MarketingDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary>({ promoCount: 0, activePromos: 0, promoUses: 0, referralCount: 0, pushCount: 0, pushDelivered: 0, banners: 0, rewardsBalance: 0 });

  const load = async () => {
    setLoading(true);
    try {
      const [promos, referrals, pushes, banners, wallets] = await Promise.all([
        supabase.from("promo_codes").select("id,status,current_uses", { count: "exact" }).limit(500),
        supabase.from("rider_referrals").select("id", { count: "exact", head: true }),
        supabase.from("push_notifications").select("id,delivered_count", { count: "exact" }).limit(500),
        supabase.from("marketing_banners").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("wallets").select("ride_credits,promo_balance,refund_balance").limit(500),
      ]);

      const promoRows = (promos.data || []) as Array<{ status: string; current_uses: number | null }>;
      const pushRows = (pushes.data || []) as Array<{ delivered_count: number | null }>;
      const walletRows = (wallets.data || []) as Array<{ ride_credits?: number; promo_balance?: number; refund_balance?: number }>;
      setSummary({
        promoCount: promos.count || promoRows.length,
        activePromos: promoRows.filter((p) => p.status === "active").length,
        promoUses: promoRows.reduce((sum, p) => sum + Number(p.current_uses || 0), 0),
        referralCount: referrals.count || 0,
        pushCount: pushes.count || pushRows.length,
        pushDelivered: pushRows.reduce((sum, p) => sum + Number(p.delivered_count || 0), 0),
        banners: banners.count || 0,
        rewardsBalance: walletRows.reduce((sum, w) => sum + Number(w.ride_credits || 0) + Number(w.promo_balance || 0) + Number(w.refund_balance || 0), 0),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const cards = useMemo(() => [
    { label: "Promo Codes", value: summary.promoCount, sub: `${summary.activePromos} active · ${summary.promoUses} uses`, icon: Ticket, color: "text-orange-600" },
    { label: "Referral Signups", value: summary.referralCount, sub: "Rider referral records", icon: Users, color: "text-orange-600" },
    { label: "Push Delivered", value: summary.pushDelivered, sub: `${summary.pushCount} campaigns`, icon: Bell, color: "text-zinc-900" },
    { label: "Active Banners", value: summary.banners, sub: "Visible in customer app", icon: ImageIcon, color: "text-zinc-700" },
    { label: "Reward Credits", value: formatCurrency(summary.rewardsBalance), sub: "Wallet credits issued", icon: Gift, color: "text-orange-600" },
  ], [summary]);

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] bg-gradient-to-r from-zinc-950 via-zinc-900 to-orange-600 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-orange-200">Customer Growth</p>
            <h1 className="mt-2 text-3xl font-black">Marketing Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-300">Create rider growth campaigns without shipping a new app release: promo codes, referrals, push campaigns, home banners, rewards, loyalty and analytics.</p>
          </div>
          <button onClick={load} className="inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white ring-1 ring-white/20 hover:bg-white/20">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between"><card.icon className={`h-5 w-5 ${card.color}`} /><span className="text-xs font-bold uppercase text-zinc-400">Live</span></div>
            <p className="mt-4 text-xs font-bold uppercase tracking-wide text-zinc-400">{card.label}</p>
            <p className="mt-1 text-2xl font-black text-zinc-900">{typeof card.value === "number" ? formatNumber(card.value) : card.value}</p>
            <p className="mt-1 text-xs text-zinc-500">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {quickLinks.map((link) => (
          <Link key={link.href} href={link.href} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className={`mb-4 inline-flex rounded-2xl p-3 ${link.color}`}><link.icon className="h-5 w-5" /></div>
            <h2 className="font-black text-zinc-900">{link.label}</h2>
            <p className="mt-1 text-sm text-zinc-500">{link.description}</p>
          </Link>
        ))}
      </div>

      <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5 text-sm text-orange-900">
        <span className="font-black">Recommended early-growth priority:</span> Promo Codes → Referral Program → Push Notifications → Home Screen Banners → Marketing Analytics.
      </div>
    </div>
  );
}
