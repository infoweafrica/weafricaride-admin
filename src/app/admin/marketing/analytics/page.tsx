"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BarChart3, MousePointerClick, RefreshCw, TrendingUp } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Analytics = { promo_usage: number; referral_signups: number; push_opens: number; banner_clicks: number; customer_retention: number; customer_acquisition: number; revenue_generated: number };
export default function MarketingAnalyticsPage() {
  const [data, setData] = useState<Analytics>({ promo_usage: 0, referral_signups: 0, push_opens: 0, banner_clicks: 0, customer_retention: 0, customer_acquisition: 0, revenue_generated: 0 }); const [loading, setLoading] = useState(true);
  const load = async () => { setLoading(true); try { const { data: rpc } = await supabase.rpc("get_marketing_analytics", { p_days: 30 }); if (rpc) setData(rpc as Analytics); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const cards = useMemo(() => [
    ["Promo usage", formatNumber(data.promo_usage), "Promo code redemptions"], ["Referral signups", formatNumber(data.referral_signups), "New referred riders"], ["Push opens", formatNumber(data.push_opens), "Notification opens"], ["Banner clicks", formatNumber(data.banner_clicks), "Home banner engagement"], ["Retention", `${data.customer_retention}%`, "Repeat riders"], ["Acquisition", formatNumber(data.customer_acquisition), "New riders"], ["Revenue generated", formatCurrency(data.revenue_generated), "Completed ride revenue"],
  ], [data]);
  return <div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-black text-zinc-900">Marketing Analytics</h1><p className="text-sm text-zinc-500">Promo usage, referrals, campaign performance, banner clicks, retention, acquisition and revenue.</p></div><button onClick={load} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}/>Refresh</button></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, sub], i) => <div key={label} className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between">{i % 2 === 0 ? <TrendingUp className="h-5 w-5 text-orange-600"/> : <MousePointerClick className="h-5 w-5 text-zinc-900"/>}<span className="text-xs font-bold uppercase text-zinc-400">30 days</span></div><p className="mt-5 text-xs font-bold uppercase text-zinc-400">{label}</p><p className="mt-1 text-2xl font-black text-zinc-900">{value}</p><p className="mt-1 text-sm text-zinc-500">{sub}</p></div>)}</div><div className="rounded-2xl border bg-white p-5"><h2 className="mb-3 flex items-center gap-2 font-black"><BarChart3 className="h-5 w-5 text-orange-600"/>Early growth scorecard</h2><p className="text-sm text-zinc-500">Use this dashboard to compare campaign engagement against bookings and focus budget on channels producing repeat rides.</p></div></div>;
}
