"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Plus, RefreshCw } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Campaign = { id: string; name: string; campaign_type: string; trigger_rule: string | null; reward_amount: number; status: string; target_segment: string | null; starts_at: string | null; ends_at: string | null; sent_count: number; redeemed_count: number; created_at: string };
const inputClass = "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-orange-400";

export default function MarketingCampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [name, setName] = useState("Inactive 30 days coupon"); const [type, setType] = useState("re_engagement"); const [rule, setRule] = useState("Inactive for 30 days");
  const [amount, setAmount] = useState("25"); const [segment, setSegment] = useState("inactive_30_days"); const [startsAt, setStartsAt] = useState(""); const [endsAt, setEndsAt] = useState("");
  const load = async () => { setLoading(true); const { data } = await supabase.from("marketing_campaigns").select("*").order("created_at", { ascending: false }); setItems((data || []) as Campaign[]); setLoading(false); };
  useEffect(() => { load(); }, []);
  const save = async () => { if (!name.trim()) return; setSaving(true); const { error } = await supabase.from("marketing_campaigns").insert({ name, campaign_type: type, trigger_rule: rule || null, reward_amount: Number(amount) || 0, target_segment: segment || null, status: "active", starts_at: startsAt ? new Date(startsAt).toISOString() : null, ends_at: endsAt ? new Date(endsAt).toISOString() : null }); setSaving(false); if (error) return alert(error.message); load(); };
  const toggle = async (c: Campaign) => { await supabase.from("marketing_campaigns").update({ status: c.status === "active" ? "paused" : "active", updated_at: new Date().toISOString() }).eq("id", c.id); load(); };

  return <div className="space-y-6">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-black text-zinc-900">Ride Coupon Campaigns</h1><p className="text-sm text-zinc-500">Birthday, welcome, loyalty and re-engagement coupons for targeted riders.</p></div><button onClick={load} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold"><RefreshCw className="h-4 w-4"/>Refresh</button></div>
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <div className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="mb-4 flex items-center gap-2 font-black"><Plus className="h-4 w-4 text-orange-600"/>Create Coupon Campaign</h2><div className="space-y-3">
        <Field label="Campaign name"><input className={inputClass} value={name} onChange={(e)=>setName(e.target.value)}/></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Type"><select className={inputClass} value={type} onChange={(e)=>setType(e.target.value)}><option value="welcome">Welcome</option><option value="birthday">Birthday</option><option value="loyalty">Loyalty</option><option value="re_engagement">Re-engagement</option></select></Field><Field label="Reward amount"><input type="number" className={inputClass} value={amount} onChange={(e)=>setAmount(e.target.value)}/></Field></div>
        <Field label="Target segment"><input className={inputClass} value={segment} onChange={(e)=>setSegment(e.target.value)} placeholder="inactive_30_days"/></Field><Field label="Rule"><textarea rows={3} className={inputClass} value={rule} onChange={(e)=>setRule(e.target.value)}/></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Start"><input type="datetime-local" className={inputClass} value={startsAt} onChange={(e)=>setStartsAt(e.target.value)}/></Field><Field label="End"><input type="datetime-local" className={inputClass} value={endsAt} onChange={(e)=>setEndsAt(e.target.value)}/></Field></div>
        <button onClick={save} disabled={saving || !name.trim()} className="w-full rounded-xl bg-orange-600 py-3 text-sm font-black text-white disabled:opacity-50">{saving ? "Saving..." : "Create Campaign"}</button>
      </div></div>
      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm"><table className="w-full text-sm"><thead className="bg-zinc-50 text-left text-zinc-500"><tr><th className="px-4 py-3">Campaign</th><th className="px-4 py-3">Type</th><th className="px-4 py-3 text-right">Reward</th><th className="px-4 py-3 text-right">Sent</th><th className="px-4 py-3 text-right">Redeemed</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody>{loading ? <tr><td colSpan={7} className="p-8 text-center text-zinc-400">Loading...</td></tr> : items.map(c => <tr key={c.id} className="border-t"><td className="px-4 py-3"><div className="font-bold">{c.name}</div><div className="text-xs text-zinc-400">{c.trigger_rule || c.target_segment}</div></td><td className="px-4 py-3 capitalize">{c.campaign_type.replace(/_/g," ")}</td><td className="px-4 py-3 text-right">{formatCurrency(c.reward_amount)}</td><td className="px-4 py-3 text-right">{formatNumber(c.sent_count || 0)}</td><td className="px-4 py-3 text-right">{formatNumber(c.redeemed_count || 0)}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${c.status === "active" ? "bg-orange-100 text-orange-700" : "bg-zinc-100 text-zinc-500"}`}>{c.status}</span></td><td className="px-4 py-3 text-right"><button onClick={()=>toggle(c)} className="rounded-lg bg-zinc-100 px-3 py-1 text-xs font-bold">{c.status === "active" ? "Pause" : "Activate"}</button></td></tr>)}</tbody></table></div>
    </div>
  </div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1 block text-xs font-bold text-zinc-600">{label}</span>{children}</label>; }
