"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  RefreshCw, Search, Download, Filter, X, Eye, Shield, AlertTriangle,
  CheckCircle, XCircle, Clock, UserCheck, CreditCard, Ban, Flag,
  MessageSquare, FileText, MapPin, Car, Users, ChevronLeft, ChevronRight,
  DollarSign, RotateCw, Zap,
} from "lucide-react";
import { formatCurrency, formatNumber, timeAgo } from "@/lib/utils";

interface Dispute {
  id: string; dispute_number: string; ride_id: string | null;
  opened_by: string; dispute_type: string; priority: string; status: string;
  rider_id: string | null; driver_id: string | null;
  rider?: { full_name?: string; phone?: string } | null;
  driver?: { full_name?: string; phone?: string } | null;
  city: string | null; description: string;
  ride_fare: number; ride_payment_method: string | null;
  refund_amount: number; penalty_amount: number;
  resolution: string | null; assigned_admin_id: string | null;
  created_at: string; updated_at: string; resolved_at: string | null;
}

interface DisputeMessage {
  id: string; dispute_id: string; sender_type: string;
  sender_id: string | null; message: string; is_internal: boolean;
  created_at: string;
}

const DISPUTE_TYPES: Record<string, string> = {
  fare: "Fare Dispute", driver_cancelled: "Driver Cancelled Wrongly",
  rider_no_show: "Rider No-Show", safety: "Safety Issue",
  wrong_location: "Wrong Pickup/Dropoff", payment_failed: "Payment Failed",
  double_charge: "Double Charge", driver_behaviour: "Driver Behaviour",
  rider_behaviour: "Rider Behaviour", lost_item: "Lost Item",
  accident: "Accident/Incident", fraud: "Fraud/Fake Trip", other: "Other",
};

const PRIORITY_MAP: Record<string, { color: string; label: string }> = {
  critical: { color: "bg-red-100 text-red-700 border-red-200", label: "Critical" },
  high: { color: "bg-orange-100 text-orange-700 border-orange-200", label: "High" },
  medium: { color: "bg-amber-100 text-amber-700 border-amber-200", label: "Medium" },
  low: { color: "bg-blue-100 text-blue-700 border-blue-200", label: "Low" },
};

const STATUS_MAP: Record<string, string> = {
  open: "bg-blue-100 text-blue-700",
  under_review: "bg-purple-100 text-purple-700",
  waiting_rider: "bg-amber-100 text-amber-700",
  waiting_driver: "bg-amber-100 text-amber-700",
  escalated: "bg-red-100 text-red-700",
  resolved: "bg-green-100 text-green-700",
  closed: "bg-gray-100 text-gray-500",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
  fraud_confirmed: "bg-red-200 text-red-800",
};

const PAGE_SIZES = [20, 50, 100];

export default function DisputesPage() {
  const [loading, setLoading] = useState(true);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [filteredDisputes, setFilteredDisputes] = useState<Dispute[]>([]);
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [messages, setMessages] = useState<DisputeMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [adminNote, setAdminNote] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);

  // Stats
  const [stats, setStats] = useState({
    total: 0, open: 0, under_review: 0, escalated: 0,
    resolved: 0, refunded: 0, driver_penalized: 0, rider_penalized: 0,
  });

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("ride_disputes")
        .select("*, rider:rider_id(full_name,phone), driver:driver_id(full_name,phone)", { count: "exact" });

      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (typeFilter !== "all") query = query.eq("dispute_type", typeFilter);
      if (priorityFilter !== "all") query = query.eq("priority", priorityFilter);
      if (search.trim()) {
        const s = `%${search.toLowerCase()}%`;
        query = query.or(`dispute_number.ilike.${s},description.ilike.${s}`);
      }

      const { count } = await query;
      setTotalCount(count || 0);

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const { data } = await query.order("created_at", { ascending: false }).range(from, to);

      const all = (data || []) as Dispute[];
      setDisputes(all);
      setFilteredDisputes(all);

      // Stats
      const { data: allData } = await supabase.from("ride_disputes").select("status,refund_amount,penalty_amount");
      const allStats = (allData || []) as Dispute[];
      setStats({
        total: allStats.length,
        open: allStats.filter(d => d.status === "open").length,
        under_review: allStats.filter(d => d.status === "under_review" || d.status === "waiting_rider" || d.status === "waiting_driver").length,
        escalated: allStats.filter(d => d.status === "escalated").length,
        resolved: allStats.filter(d => d.status === "resolved" || d.status === "closed").length,
        refunded: allStats.reduce((s, d) => s + (d.refund_amount || 0), 0),
        driver_penalized: allStats.filter(d => d.penalty_amount > 0 && d.opened_by === "rider").length,
        rider_penalized: allStats.filter(d => d.penalty_amount > 0 && d.opened_by === "driver").length,
      });
    } catch { /* */ } finally { setLoading(false); }
  }, [page, pageSize, statusFilter, typeFilter, priorityFilter, search]);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  const fetchMessages = async (disputeId: string) => {
    setMessagesLoading(true);
    try {
      const { data } = await supabase
        .from("dispute_messages")
        .select("*").eq("dispute_id", disputeId)
        .order("created_at", { ascending: true });
      setMessages((data || []) as DisputeMessage[]);
    } catch { /* */ } finally { setMessagesLoading(false); }
  };

  const selectDispute = (d: Dispute) => { setSelectedDispute(d); fetchMessages(d.id); };

  // ─── ACTIONS ───
  const handleStatusChange = async (id: string, newStatus: string) => {
    setActionLoading(id);
    await supabase.from("ride_disputes").update({ status: newStatus, updated_at: new Date().toISOString(), resolved_at: newStatus === "resolved" || newStatus === "closed" ? new Date().toISOString() : null }).eq("id", id);

    // Log to status history
    await supabase.from("dispute_status_history").insert({
      dispute_id: id, new_status: newStatus,
      old_status: selectedDispute?.status || null, notes: `Status changed to ${newStatus}`,
    });

    setActionLoading(null);
    fetchDisputes();
    if (selectedDispute?.id === id) setSelectedDispute({ ...selectedDispute!, status: newStatus });
  };

  const handleRefund = async (id: string, amount: number) => {
    setActionLoading(id);
    const dispute = disputes.find(d => d.id === id);
    await supabase.from("ride_disputes").update({
      refund_amount: amount, status: "resolved", resolution: `Refunded MWK ${amount}`,
      updated_at: new Date().toISOString(), resolved_at: new Date().toISOString(),
    }).eq("id", id);

    await supabase.from("dispute_status_history").insert({
      dispute_id: id, new_status: "resolved",
      old_status: dispute?.status || null, notes: `Refunded MWK ${amount}`,
    });

    // Add internal note
    if (adminNote.trim()) {
      await supabase.from("dispute_messages").insert({
        dispute_id: id, sender_type: "admin", message: `[Resolution] Refunded MWK ${amount}. ${adminNote}`,
        is_internal: true,
      });
      setAdminNote("");
    }
    setActionLoading(null);
    fetchDisputes();
  };

  const handlePenalize = async (id: string, target: "driver" | "rider", amount: number) => {
    setActionLoading(id);
    const dispute = disputes.find(d => d.id === id);
    await supabase.from("ride_disputes").update({
      penalty_amount: amount, status: "resolved",
      resolution: `${target === "driver" ? "Driver" : "Rider"} penalized MWK ${amount}`,
      updated_at: new Date().toISOString(), resolved_at: new Date().toISOString(),
    }).eq("id", id);

    await supabase.from("dispute_status_history").insert({
      dispute_id: id, new_status: "resolved",
      old_status: dispute?.status || null, notes: `${target} penalized MWK ${amount}`,
    });
    setActionLoading(null);
    fetchDisputes();
  };

  const handleAddNote = async (id: string) => {
    if (!adminNote.trim()) return;
    await supabase.from("dispute_messages").insert({
      dispute_id: id, sender_type: "admin", message: adminNote, is_internal: true,
    });
    setAdminNote("");
    if (selectedDispute) fetchMessages(selectedDispute.id);
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="space-y-6">
      {/* ─── HEADER ─── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ride Disputes</h1>
          <p className="text-sm text-gray-500 mt-1">Investigate and resolve rider/driver disputes with full resolution tools.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchDisputes} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50"><RefreshCw className="h-4 w-4"/> Refresh</button>
          <button className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700"><Download className="h-4 w-4"/> Export</button>
        </div>
      </div>

      {/* ─── STATS CARDS ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label:"Total Disputes", value:stats.total, icon:FileText, color:"bg-blue-50 text-blue-600" },
          { label:"Open", value:stats.open, icon:AlertTriangle, color:"bg-red-50 text-red-600" },
          { label:"Under Review", value:stats.under_review, icon:Clock, color:"bg-purple-50 text-purple-600" },
          { label:"Escalated", value:stats.escalated, icon:Zap, color:"bg-orange-50 text-orange-600" },
          { label:"Resolved", value:stats.resolved, icon:CheckCircle, color:"bg-green-50 text-green-600" },
          { label:"Refunded Amount", value:formatCurrency(stats.refunded), icon:CreditCard, color:"bg-emerald-50 text-emerald-600" },
          { label:"Driver Penalized", value:stats.driver_penalized, icon:Ban, color:"bg-amber-50 text-amber-600" },
          { label:"Rider Penalized", value:stats.rider_penalized, icon:UserCheck, color:"bg-indigo-50 text-indigo-600" },
        ].map(s=>(
          <div key={s.label} className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 p-4" style={{minHeight:120}}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color} mb-2`}><s.icon className="h-5 w-5"/></div>
            <p className="text-xl font-bold text-gray-900">{s.value}</p>
            <p className="text-[10px] text-gray-400">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ─── FILTER BAR ─── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"/>
          <input type="text" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}
            placeholder="Search by ID, rider, driver, description..." className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-xs"/>
        </div>
        <select value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setPage(1);}} className="px-3 py-2.5 border border-gray-200 rounded-xl text-xs">
          <option value="all">All Status</option>
          {Object.entries(STATUS_MAP).map(([k])=><option key={k} value={k}>{k.replace(/_/g," ")}</option>)}
        </select>
        <select value={typeFilter} onChange={e=>{setTypeFilter(e.target.value);setPage(1);}} className="px-3 py-2.5 border border-gray-200 rounded-xl text-xs">
          <option value="all">All Types</option>
          {Object.entries(DISPUTE_TYPES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select>
        <select value={priorityFilter} onChange={e=>{setPriorityFilter(e.target.value);setPage(1);}} className="px-3 py-2.5 border border-gray-200 rounded-xl text-xs">
          <option value="all">All Priority</option>
          <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        {(search||statusFilter!=="all"||typeFilter!=="all"||priorityFilter!=="all")&&(
          <button onClick={()=>{setSearch("");setStatusFilter("all");setTypeFilter("all");setPriorityFilter("all");setPage(1);}} className="flex items-center gap-1 px-3 py-2.5 text-xs text-red-600 hover:bg-red-50 rounded-xl"><X className="h-3 w-3"/> Clear</button>
        )}
      </div>

      {/* ─── DISPUTES TABLE ─── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200" style={{height:52}}>
                <th className="px-3 py-3 text-xs font-medium">Dispute ID</th>
                <th className="px-3 py-3 text-xs font-medium">Rider</th>
                <th className="px-3 py-3 text-xs font-medium">Driver</th>
                <th className="px-3 py-3 text-xs font-medium">Type</th>
                <th className="px-3 py-3 text-xs font-medium text-right">Amount</th>
                <th className="px-3 py-3 text-xs font-medium">Priority</th>
                <th className="px-3 py-3 text-xs font-medium">Status</th>
                <th className="px-3 py-3 text-xs font-medium">Created</th>
                <th className="px-3 py-3 text-xs font-medium text-right">View</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="py-12 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto"/></td></tr>
              ) : filteredDisputes.length === 0 ? (
                <tr><td colSpan={9} className="py-16 text-center">
                  <Search className="h-10 w-10 mx-auto mb-3 opacity-20"/>
                  <p className="text-sm text-gray-500 font-medium">No disputes found</p>
                  <p className="text-xs text-gray-400 mt-1">Disputes will appear here when riders or drivers submit them.</p>
                </td></tr>
              ) : (
                filteredDisputes.map(d => (
                  <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={()=>selectDispute(d)} style={{height:64}}>
                    <td className="px-3 py-3 text-xs font-mono text-gray-600">{d.dispute_number}</td>
                    <td className="px-3 py-3 text-xs font-medium">{d.rider?.full_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-500">{d.driver?.full_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-500">{DISPUTE_TYPES[d.dispute_type] || d.dispute_type}</td>
                    <td className="px-3 py-3 text-right text-xs font-medium">{d.ride_fare > 0 ? formatCurrency(d.ride_fare) : "—"}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${PRIORITY_MAP[d.priority]?.color || ""}`}>{d.priority}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_MAP[d.status] || "bg-gray-100 text-gray-600"}`}>{d.status?.replace(/_/g," ")}</span>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-400">{timeAgo(d.created_at)}</td>
                    <td className="px-3 py-3 text-right">
                      <button onClick={(e)=>{e.stopPropagation();selectDispute(d);}} className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-500"><Eye className="h-3.5 w-3.5"/></button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">{formatNumber(totalCount)} results</span>
              <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1);}} className="text-xs border rounded px-2 py-1">
                {PAGE_SIZES.map(s=><option key={s} value={s}>{s}/page</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page<=1} className="px-2 py-1 border rounded text-xs disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5"/></button>
              {Array.from({length:Math.min(totalPages,5)},(_,i)=>{
                let pg:number; if(totalPages<=5)pg=i+1; else if(page<=3)pg=i+1; else if(page>=totalPages-2)pg=totalPages-4+i; else pg=page-2+i;
                if(pg<1||pg>totalPages)return null;
                return <button key={pg} onClick={()=>setPage(pg)} className={`px-2.5 py-1 rounded text-xs font-medium ${pg===page?"bg-green-600 text-white":"border hover:bg-gray-50"}`}>{pg}</button>;
              })}
              <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page>=totalPages} className="px-2 py-1 border rounded text-xs disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5"/></button>
            </div>
          </div>
        )}
      </div>

      {/* ─── DISPUTE DETAIL ─── */}
      {selectedDispute && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Dispute Detail — {selectedDispute.dispute_number}</h3>
            <button onClick={()=>setSelectedDispute(null)} className="p-1.5 hover:bg-gray-100 rounded-lg"><XCircle className="h-5 w-5 text-gray-400"/></button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* LEFT: Ride + Dispute info */}
            <div className="lg:col-span-2 space-y-4">
              {/* Ride Information */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><Car className="h-4 w-4 text-gray-400"/>Ride Information</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[{l:"Ride ID",v:selectedDispute.ride_id?.slice(0,8)||"—"},{l:"Fare",v:formatCurrency(selectedDispute.ride_fare)},{l:"Payment",v:selectedDispute.ride_payment_method||"—"},{l:"City",v:selectedDispute.city||"—"},{l:"Opened By",v:selectedDispute.opened_by},{l:"Type",v:DISPUTE_TYPES[selectedDispute.dispute_type]},{l:"Priority",v:selectedDispute.priority},{l:"Refund",v:selectedDispute.refund_amount>0?formatCurrency(selectedDispute.refund_amount):"—"},{l:"Penalty",v:selectedDispute.penalty_amount>0?formatCurrency(selectedDispute.penalty_amount):"—"}].map(f=>(<div key={f.l} className="flex justify-between"><span className="text-gray-400 text-xs">{f.l}</span><span className="text-xs font-medium text-gray-700">{f.v}</span></div>))}
                </div>
              </div>

              {/* Rider Info */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><Users className="h-4 w-4 text-blue-400"/>Rider</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[{l:"Name",v:selectedDispute.rider?.full_name||"—"},{l:"Phone",v:selectedDispute.rider?.phone||"—"},{l:"Status",v:"Active"}].map(f=>(<div key={f.l} className="flex justify-between"><span className="text-gray-400 text-xs">{f.l}</span><span className="text-xs font-medium text-gray-700">{f.v}</span></div>))}
                </div>
              </div>

              {/* Driver Info */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><Car className="h-4 w-4 text-green-400"/>Driver</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[{l:"Name",v:selectedDispute.driver?.full_name||"—"},{l:"Phone",v:selectedDispute.driver?.phone||"—"},{l:"Status",v:"Active"}].map(f=>(<div key={f.l} className="flex justify-between"><span className="text-gray-400 text-xs">{f.l}</span><span className="text-xs font-medium text-gray-700">{f.v}</span></div>))}
                </div>
              </div>

              {/* Description */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Dispute Description</h4>
                <p className="text-sm text-gray-700">{selectedDispute.description}</p>
                {selectedDispute.resolution && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs text-gray-400 mb-1">Resolution</p>
                    <p className="text-sm text-green-700 font-medium">{selectedDispute.resolution}</p>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: Actions + Messages */}
            <div className="space-y-4">
              {/* Status Change */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-2">Investigation Tools</h4>
                <div className="grid grid-cols-2 gap-1">
                  {["under_review","waiting_rider","waiting_driver","escalated"].map(s=>(
                    <button key={s} onClick={()=>handleStatusChange(selectedDispute.id,s)} disabled={actionLoading===selectedDispute.id}
                      className={`px-2 py-1.5 text-[10px] font-medium rounded-lg border ${selectedDispute.status===s?"bg-green-50 border-green-300 text-green-700":"hover:bg-gray-50 text-gray-600"} disabled:opacity-40`}>
                      {s.replace(/_/g," ")}
                    </button>
                  ))}
                  <button onClick={()=>handleRefund(selectedDispute.id,selectedDispute.ride_fare)} disabled={actionLoading===selectedDispute.id}
                    className="px-2 py-1.5 text-[10px] font-medium rounded-lg border bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
                    💰 Refund Full
                  </button>
                  <button onClick={()=>handlePenalize(selectedDispute.id,"driver",500)} disabled={actionLoading===selectedDispute.id}
                    className="px-2 py-1.5 text-[10px] font-medium rounded-lg border bg-red-50 border-red-300 text-red-700 hover:bg-red-100 disabled:opacity-40">
                    🚫 Penalize Driver
                  </button>
                  <button onClick={()=>handlePenalize(selectedDispute.id,"rider",500)} disabled={actionLoading===selectedDispute.id}
                    className="px-2 py-1.5 text-[10px] font-medium rounded-lg border bg-orange-50 border-orange-300 text-orange-700 hover:bg-orange-100 disabled:opacity-40">
                    🚫 Penalize Rider
                  </button>
                  <button onClick={()=>handleStatusChange(selectedDispute.id,"resolved")} disabled={actionLoading===selectedDispute.id}
                    className="px-2 py-1.5 text-[10px] font-medium rounded-lg border bg-green-50 border-green-300 text-green-700 hover:bg-green-100 disabled:opacity-40">
                    ✅ Resolve
                  </button>
                </div>
              </div>

              {/* Admin Note */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-2">Add Internal Note</h4>
                <textarea value={adminNote} onChange={e=>setAdminNote(e.target.value)} rows={3}
                  placeholder="Internal admin note..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs"/>
                <button onClick={()=>handleAddNote(selectedDispute.id)} disabled={!adminNote.trim()}
                  className="mt-2 w-full px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 disabled:opacity-40">
                  <Flag className="h-3 w-3 inline mr-1"/>Save Note
                </button>
              </div>

              {/* Messages */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-2"><MessageSquare className="h-4 w-4"/>Messages</h4>
                <div className="max-h-[300px] overflow-y-auto space-y-2">
                  {messagesLoading ? <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-600"/></div> :
                  messages.length===0 ? <p className="text-xs text-gray-400 py-2">No messages yet</p> :
                  messages.map(m=>(
                    <div key={m.id} className={`p-2 rounded-lg text-xs ${m.is_internal?"bg-amber-50 border border-amber-100":"bg-gray-50"}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${m.is_internal?"bg-amber-200 text-amber-800":"bg-blue-100 text-blue-700"}`}>{m.is_internal?"🎫 Internal":"💬"}{m.sender_type}</span>
                        <span className="text-gray-400 text-[9px]">{timeAgo(m.created_at)}</span>
                      </div>
                      <p className="text-gray-700">{m.message}</p>
                    </div>
                  ))
                }
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}