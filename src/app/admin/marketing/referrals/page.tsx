"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  Search, CheckCircle, XCircle, DollarSign, Users, TrendingUp,
  AlertTriangle, Clock, RefreshCw, Ban, Flag, Plus, Edit3,
  Settings, BarChart3, Eye, Shield, CreditCard, Zap,
} from "lucide-react";
import { formatCurrency, formatNumber, timeAgo } from "@/lib/utils";
import type { DriverReferral, RiderReferral, ReferralCampaign, ReferralReward, ReferralSettings, TopReferrer, ReferralFraudCheck } from "@/lib/types";
import {
  fetchDriverReferrals, fetchRiderReferrals, approveDriverReferralBonus,
  approveRiderReferralCredit, rejectReferral, payReferralBonus, suspendReferral,
  flagReferralFraud, fetchCampaigns, createCampaign, updateCampaign, toggleCampaign,
  fetchReferralRewards, approveReward, markRewardPaid, fetchFraudChecks,
} from "@/lib/api/referrals";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700", signed_up: "bg-blue-100 text-blue-700",
  documents_submitted: "bg-indigo-100 text-indigo-700", under_review: "bg-purple-100 text-purple-700",
  documents_approved: "bg-teal-100 text-teal-700", first_trip_completed: "bg-cyan-100 text-cyan-700",
  first_ride_completed: "bg-sky-100 text-sky-700", bonus_approved: "bg-amber-100 text-amber-700",
  credit_approved: "bg-orange-100 text-orange-700", bonus_paid: "bg-green-100 text-green-700",
  credit_issued: "bg-emerald-100 text-emerald-700", fraud_review: "bg-red-100 text-red-700",
  rejected: "bg-red-100 text-red-700", suspended: "bg-gray-200 text-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending", signed_up: "Signed Up", documents_submitted: "Docs Submitted",
  under_review: "Under Review", documents_approved: "Docs Approved",
  first_trip_completed: "First Trip Done", first_ride_completed: "First Ride Done",
  bonus_approved: "Bonus Approved", credit_approved: "Credit Approved",
  bonus_paid: "Bonus Paid", credit_issued: "Credit Issued",
  fraud_review: "Fraud Review", rejected: "Rejected", suspended: "Suspended",
};

export default function ReferralsPage() {
  const [tab, setTab] = useState<"overview"|"programs"|"drivers"|"riders"|"payouts"|"fraud"|"settings">("overview");
  const [loading, setLoading] = useState(true);

  // Shared state
  const [driverReferrals, setDriverReferrals] = useState<DriverReferral[]>([]);
  const [riderReferrals, setRiderReferrals] = useState<RiderReferral[]>([]);
  const [campaigns, setCampaigns] = useState<ReferralCampaign[]>([]);
  const [rewards, setRewards] = useState<ReferralReward[]>([]);
  const [fraudChecks, setFraudChecks] = useState<ReferralFraudCheck[]>([]);
  const [settings, setSettings] = useState<ReferralSettings>({ defaults: { driver_bonus: 5000, rider_credit: 1000, currency: "MWK" }, rules: { min_trips_for_bonus: 1, require_verified_docs: true, max_referrals_per_user: null, expiry_days: null }, fraud: { same_phone_block: true, max_daily_referrals: 50, self_referral_block: true } });
  const [analytics, setAnalytics] = useState<{ day: string; driver_referrals: number; rider_referrals: number }[]>([]);
  const [topReferrers, setTopReferrers] = useState<TopReferrer[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 20;

  const tabs = [
    { id: "overview" as const, label: "📊 Overview", icon: BarChart3 },
    { id: "programs" as const, label: "🎯 Programs", icon: Zap },
    { id: "drivers" as const, label: "🧑‍✈️ Driver Referrals", icon: Users },
    { id: "riders" as const, label: "🧑‍🤝‍🧑 Rider Referrals", icon: Eye },
    { id: "payouts" as const, label: "💸 Payouts", icon: CreditCard },
    { id: "fraud" as const, label: "🛡️ Fraud Center", icon: Shield },
    { id: "settings" as const, label: "⚙️ Settings", icon: Settings },
  ];

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [drRes, riRes, cRes, rRes, fRes] = await Promise.all([
        fetchDriverReferrals(1, 100),
        fetchRiderReferrals(1, 100),
        fetchCampaigns(1, 50),
        fetchReferralRewards(1, 100),
        fetchFraudChecks(1, 100),
      ]);
      setDriverReferrals(drRes.data);
      setRiderReferrals(riRes.data);
      setCampaigns(cRes.data);
      setRewards(rRes.data);
      setFraudChecks(fRes.data);

      // Settings
      const { data: s } = await supabase.rpc("get_referral_settings");
      if (s) setSettings(s as unknown as ReferralSettings);

      // Analytics
      const { data: a } = await supabase.rpc("get_referral_analytics", { p_days: 30 });
      setAnalytics((a || []) as typeof analytics);

      // Top referrers
      const { data: t } = await supabase.rpc("get_top_referrers", { p_referral_type: "driver", p_limit: 10 });
      setTopReferrers((t || []) as TopReferrer[]);
    } catch { /* silent */ } finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleApproveBonus = async (id: string) => { await approveDriverReferralBonus(id); fetchAll(); };
  const handlePay = async (id: string) => { await payReferralBonus(id); fetchAll(); };
  const handleReject = async (id: string, type: "driver"|"rider") => { await rejectReferral(id, type, "Rejected"); fetchAll(); };
  const handleFraud = async (id: string, type: "driver"|"rider") => { await flagReferralFraud(id, type); fetchAll(); };
  const handleSuspend = async (id: string, type: "driver"|"rider") => { await suspendReferral(id, type); fetchAll(); };

  // Stats
  const stats = {
    total: driverReferrals.length + riderReferrals.length,
    pending: driverReferrals.filter(r => ["first_trip_completed","bonus_approved"].includes(r.status)).length,
    paid: driverReferrals.filter(r => r.status === "bonus_paid").length,
    fraud: fraudChecks.filter(f => f.result !== "pass").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Referral System</h1><p className="text-gray-500 mt-1">Programs, referrals, payouts & fraud detection</p></div>
        <button onClick={fetchAll} className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"><RefreshCw className="h-4 w-4"/>Refresh</button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 ${tab===t.id?"border-green-600 text-green-600":"border-transparent text-gray-500 hover:text-gray-700"}`}>{t.label}</button>
        ))}
      </div>

      {/* ======================================== OVERVIEW ======================================== */}
      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {[{l:"Total",v:stats.total,c:"blue"},{l:"Pending",v:stats.pending,c:"amber"},{l:"Paid",v:stats.paid,c:"green"},{l:"Fraud",v:stats.fraud,c:"red"},{l:"Drivers",v:driverReferrals.length,c:"indigo"},{l:"Riders",v:riderReferrals.length,c:"purple"}].map(s=>(
              <div key={s.l} className="bg-white rounded-xl border p-3 text-center"><p className="text-xs text-gray-400">{s.l}</p><p className={`text-xl font-bold text-${s.c}-600`}>{formatNumber(s.v)}</p></div>
            ))}
          </div>

          {/* Top Referrers */}
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50"><h3 className="text-sm font-semibold">Top Referrers</h3></div>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 bg-gray-50 border-b"><th className="px-4 py-2">#</th><th className="px-4 py-2">Name</th><th className="px-4 py-2 text-right">Referrals</th><th className="px-4 py-2 text-right">Successful</th><th className="px-4 py-2 text-right">Bonus</th><th className="px-4 py-2 text-right">Conv.</th></tr></thead>
              <tbody>{topReferrers.map((t,i)=>(
                <tr key={t.referrer_id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs font-bold text-gray-400">{i+1}</td>
                  <td className="px-4 py-2 text-xs font-medium">{t.referrer_name}</td>
                  <td className="px-4 py-2 text-xs text-right">{t.total_referrals}</td>
                  <td className="px-4 py-2 text-xs text-right">{t.successful_referrals}</td>
                  <td className="px-4 py-2 text-xs text-right text-green-600">{formatCurrency(t.total_bonus)}</td>
                  <td className="px-4 py-2 text-xs text-right">{t.conversion_rate}%</td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        </div>
      )}

      {/* ======================================== PROGRAMS ======================================== */}
      {tab === "programs" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button onClick={()=>{/*modal*/}} className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-medium"><Plus className="h-3 w-3"/>New Program</button>
          </div>
          <div className="grid gap-3">
            {campaigns.map(c=>(
              <div key={c.id} className="bg-white rounded-xl border p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2"><h3 className="font-semibold text-sm">{c.name}</h3><span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${c.is_active?"bg-green-100 text-green-700":"bg-gray-100 text-gray-500"}`}>{c.is_active?"Active":"Inactive"}</span></div>
                  <p className="text-xs text-gray-500 mt-1">{c.campaign_type === "both" ? "Drivers & Riders" : c.campaign_type}</p>
                  <div className="flex gap-3 mt-2 text-xs text-gray-600">
                    {c.driver_bonus_amount>0&&<span>Driver: {formatCurrency(c.driver_bonus_amount)}</span>}
                    {c.rider_credit_amount>0&&<span>Rider: {formatCurrency(c.rider_credit_amount)}</span>}
                    <span>Ends: {new Date(c.ends_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <button onClick={()=>toggleCampaign(c.id,!c.is_active).then(fetchAll)} className={`px-3 py-1 rounded text-xs font-medium ${c.is_active?"bg-red-50 text-red-600":"bg-green-50 text-green-600"}`}>{c.is_active?"Deactivate":"Activate"}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ======================================== DRIVER REFERRALS ======================================== */}
      {tab === "drivers" && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"/><input type="text" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"/></div>
            <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="px-4 py-2 border rounded-lg text-sm"><option value="all">All</option><option value="first_trip_completed">First Trip Done</option><option value="bonus_approved">Bonus Approved</option><option value="bonus_paid">Bonus Paid</option><option value="fraud_review">Fraud Review</option><option value="rejected">Rejected</option></select>
          </div>
          <div className="bg-white rounded-xl border overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 bg-gray-50 border-b"><th className="px-4 py-3">Referrer</th><th className="px-4 py-3">Referred</th><th className="px-4 py-3">Code</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Bonus</th><th className="px-4 py-3">Date</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
            <tbody>{driverReferrals.filter(r=>!search||r.referral_code?.toLowerCase().includes(search.toLowerCase())||(r.referrer as any)?.user?.full_name?.toLowerCase().includes(search.toLowerCase())).filter(r=>statusFilter==="all"||r.status===statusFilter).slice(0,50).map(ref=>{
              const rn = (ref.referrer as any)?.user?.full_name || "Unknown";
              const dn = (ref.referred_driver as any)?.user?.full_name || "Unregistered";
              return (<tr key={ref.id} className="border-b border-gray-50 hover:bg-gray-50"><td className="px-4 py-3 text-xs font-medium">{rn}</td><td className="px-4 py-3 text-xs text-gray-500">{dn}</td><td className="px-4 py-3 text-xs font-mono text-gray-400">{ref.referral_code}</td><td className="px-4 py-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[ref.status]||"bg-gray-100"}`}>{STATUS_LABELS[ref.status]||ref.status}</span></td><td className="px-4 py-3 text-right text-xs font-medium">{ref.bonus_amount>0?formatCurrency(ref.bonus_amount):"—"}</td><td className="px-4 py-3 text-xs text-gray-400">{timeAgo(ref.created_at)}</td><td className="px-4 py-3 text-right"><div className="flex items-center justify-end gap-1">
                {ref.status==="first_trip_completed"&&<><button onClick={()=>handleApproveBonus(ref.id)} className="p-1 bg-green-100 text-green-700 rounded hover:bg-green-200"><CheckCircle className="h-3 w-3"/></button><button onClick={()=>handleReject(ref.id,"driver")} className="p-1 bg-red-100 text-red-700 rounded hover:bg-red-200"><XCircle className="h-3 w-3"/></button></>}
                {ref.status==="bonus_approved"&&<button onClick={()=>handlePay(ref.id)} className="p-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"><DollarSign className="h-3 w-3"/></button>}
                {!["bonus_paid","rejected","suspended","fraud_review"].includes(ref.status)&&<><button onClick={()=>handleFraud(ref.id,"driver")} className="p-1 bg-orange-100 text-orange-700 rounded hover:bg-orange-200"><Flag className="h-3 w-3"/></button><button onClick={()=>handleSuspend(ref.id,"driver")} className="p-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"><Ban className="h-3 w-3"/></button></>}
              </div></td></tr>);
            })}</tbody>
          </table></div></div>
        </div>
      )}

      {/* ======================================== RIDER REFERRALS ======================================== */}
      {tab === "riders" && (
        <div className="bg-white rounded-xl border overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-gray-500 bg-gray-50 border-b"><th className="px-4 py-3">Referrer</th><th className="px-4 py-3">Referred</th><th className="px-4 py-3">Code</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Credit</th><th className="px-4 py-3">Date</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
          <tbody>{riderReferrals.slice(0,50).map(ref=>{
            const rn = (ref.referrer as any)?.user?.full_name || "Unknown";
            const dn = (ref.referred_rider as any)?.user?.full_name || "Unregistered";
            return (<tr key={ref.id} className="border-b border-gray-50 hover:bg-gray-50"><td className="px-4 py-3 text-xs font-medium">{rn}</td><td className="px-4 py-3 text-xs text-gray-500">{dn}</td><td className="px-4 py-3 text-xs font-mono text-gray-400">{ref.referral_code}</td><td className="px-4 py-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[ref.status]||"bg-gray-100"}`}>{STATUS_LABELS[ref.status]||ref.status}</span></td><td className="px-4 py-3 text-right text-xs font-medium">{ref.credit_amount>0?formatCurrency(ref.credit_amount):"—"}</td><td className="px-4 py-3 text-xs text-gray-400">{timeAgo(ref.created_at)}</td><td className="px-4 py-3 text-right"><div className="flex items-center justify-end gap-1">
              {ref.status==="first_ride_completed"&&<><button onClick={()=>{approveRiderReferralCredit(ref.id);fetchAll();}} className="p-1 bg-green-100 text-green-700 rounded hover:bg-green-200"><CheckCircle className="h-3 w-3"/></button><button onClick={()=>handleReject(ref.id,"rider")} className="p-1 bg-red-100 text-red-700 rounded hover:bg-red-200"><XCircle className="h-3 w-3"/></button></>}
              {!["credit_issued","rejected","suspended","fraud_review"].includes(ref.status)&&<><button onClick={()=>handleFraud(ref.id,"rider")} className="p-1 bg-orange-100 text-orange-700 rounded hover:bg-orange-200"><Flag className="h-3 w-3"/></button><button onClick={()=>handleSuspend(ref.id,"rider")} className="p-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"><Ban className="h-3 w-3"/></button></>}
            </div></td></tr>);
          })}</tbody>
        </table></div></div>
      )}

      {/* ======================================== PAYOUTS ======================================== */}
      {tab === "payouts" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[{l:"Pending",v:rewards.filter(r=>r.status==="pending"||r.status==="approved").length,c:"amber"},{l:"Paid",v:rewards.filter(r=>r.status==="paid").length,c:"green"},{l:"Total",v:formatCurrency(rewards.reduce((s,r)=>s+r.amount,0)),c:"blue"}].map(s=>(
              <div key={s.l} className="bg-white rounded-xl border p-3 text-center"><p className="text-xs text-gray-400">{s.l}</p><p className="text-xl font-bold">{s.v}</p></div>
            ))}
          </div>
          <div className="bg-white rounded-xl border overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 bg-gray-50 border-b"><th className="px-4 py-3">ID</th><th className="px-4 py-3">Type</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3">Date</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
            <tbody>{rewards.map(r=>(
              <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 text-xs font-mono text-gray-400">{r.id.slice(0,8)}</td>
                <td className="px-4 py-3 text-xs">{r.referral_type} {r.reward_type}</td>
                <td className="px-4 py-3 text-right text-xs font-medium">{formatCurrency(r.amount)}</td>
                <td className="px-4 py-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${r.status==="paid"?"bg-green-100 text-green-700":r.status==="approved"?"bg-blue-100 text-blue-700":"bg-amber-100 text-amber-700"}`}>{r.status}</span></td>
                <td className="px-4 py-3 text-xs text-gray-400">{r.transaction_reference||"—"}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{timeAgo(r.created_at)}</td>
                <td className="px-4 py-3 text-right">{r.status!=="paid"&&<button onClick={()=>markRewardPaid(r.id,"manual-"+Date.now()).then(fetchAll)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">Pay Now</button>}</td>
              </tr>
            ))}</tbody>
          </table></div></div>
        </div>
      )}

      {/* ======================================== FRAUD CENTER ======================================== */}
      {tab === "fraud" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 bg-gray-50 border-b"><th className="px-4 py-3">Referral</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Check</th><th className="px-4 py-3">Result</th><th className="px-4 py-3">Details</th><th className="px-4 py-3">Date</th></tr></thead>
            <tbody>{fraudChecks.map(f=>(
              <tr key={f.id} className="border-b border-gray-50">
                <td className="px-4 py-3 text-xs font-mono text-gray-400">{f.referral_id?.slice(0,8)}</td>
                <td className="px-4 py-3 text-xs">{f.referral_type}</td>
                <td className="px-4 py-3 text-xs">{f.check_type.replace(/_/g," ")}</td>
                <td className="px-4 py-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${f.result==="pass"?"bg-green-100 text-green-700":f.result==="fail"?"bg-red-100 text-red-700":"bg-amber-100 text-amber-700"}`}>{f.result}</span></td>
                <td className="px-4 py-3 text-xs text-gray-500">{JSON.stringify(f.details).slice(0,60)}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{timeAgo(f.checked_at)}</td>
              </tr>
            ))}</tbody>
          </table></div></div>
        </div>
      )}

      {/* ======================================== SETTINGS ======================================== */}
      {tab === "settings" && (
        <div className="grid gap-4 max-w-2xl">
          <div className="bg-white rounded-xl border p-4">
            <h3 className="text-sm font-semibold mb-3">Default Rewards</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500">Driver Bonus (MKW)</label>
                <input type="number" value={settings.defaults.driver_bonus} onChange={e=>setSettings({...settings,defaults:{...settings.defaults,driver_bonus:Number(e.target.value)}})} className="w-full px-3 py-2 border rounded-lg text-sm mt-1"/>
              </div>
              <div><label className="text-xs text-gray-500">Rider Credit (MKW)</label>
                <input type="number" value={settings.defaults.rider_credit} onChange={e=>setSettings({...settings,defaults:{...settings.defaults,rider_credit:Number(e.target.value)}})} className="w-full px-3 py-2 border rounded-lg text-sm mt-1"/>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <h3 className="text-sm font-semibold mb-3">Rules</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between"><span className="text-xs">Minimum trips for bonus</span><input type="number" value={settings.rules.min_trips_for_bonus} onChange={e=>setSettings({...settings,rules:{...settings.rules,min_trips_for_bonus:Number(e.target.value)}})} className="px-2 py-1 border rounded text-xs w-20 text-right"/></div>
              <div className="flex items-center justify-between"><span className="text-xs">Max referrals per user</span><input type="number" value={settings.rules.max_referrals_per_user||""} onChange={e=>setSettings({...settings,rules:{...settings.rules,max_referrals_per_user:e.target.value?Number(e.target.value):null}})} className="px-2 py-1 border rounded text-xs w-20 text-right" placeholder="∞"/></div>
              <div className="flex items-center justify-between"><span className="text-xs">Expiry (days)</span><input type="number" value={settings.rules.expiry_days||""} onChange={e=>setSettings({...settings,rules:{...settings.rules,expiry_days:e.target.value?Number(e.target.value):null}})} className="px-2 py-1 border rounded text-xs w-20 text-right" placeholder="∞"/></div>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={settings.rules.require_verified_docs} onChange={e=>setSettings({...settings,rules:{...settings.rules,require_verified_docs:e.target.checked}})}/>Require verified documents</label>
            </div>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <h3 className="text-sm font-semibold mb-3">Fraud Detection</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between"><span className="text-xs">Max daily referrals</span><input type="number" value={settings.fraud.max_daily_referrals} onChange={e=>setSettings({...settings,fraud:{...settings.fraud,max_daily_referrals:Number(e.target.value)}})} className="px-2 py-1 border rounded text-xs w-20 text-right"/></div>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={settings.fraud.same_phone_block} onChange={e=>setSettings({...settings,fraud:{...settings.fraud,same_phone_block:e.target.checked}})}/>Block same-phone referrals</label>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={settings.fraud.self_referral_block} onChange={e=>setSettings({...settings,fraud:{...settings.fraud,self_referral_block:e.target.checked}})}/>Block self-referrals</label>
            </div>
          </div>
          <button onClick={async()=>{
            await supabase.rpc("set_referral_setting",{p_key:"defaults",p_value:settings.defaults});
            await supabase.rpc("set_referral_setting",{p_key:"rules",p_value:settings.rules});
            await supabase.rpc("set_referral_setting",{p_key:"fraud",p_value:settings.fraud});
            fetchAll();
          }} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium">Save Settings</button>
        </div>
      )}
    </div>
  );
}