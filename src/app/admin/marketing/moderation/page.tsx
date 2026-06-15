"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  Shield, AlertTriangle, CheckCircle, XCircle, Eye, Search,
  Clock, Flag, Ban, UserX, FileText, RefreshCw, Download, Settings,
  Zap, Users, Car, MessageSquare, FileCheck, Activity, MoreHorizontal, UserCheck,
} from "lucide-react";
import { formatNumber, timeAgo } from "@/lib/utils";

// ─── TYPES ───
interface ModerationCase {
  id: string; case_number: string; source_app: string; case_type: string;
  priority: string; status: string; reported_user_name?: string;
  reported_user_role?: string; reported_user_id?: string;
  reason: string; city?: string;
  created_at: string; assigned_admin_name?: string;
  reported_user?: { full_name?: string } | null;
  reporter?: { full_name?: string } | null;
}

interface Appeal {
  id: string; user?: { full_name?: string } | null; role?: string;
  case?: { case_number?: string } | null;
  original_action?: string; appeal_reason: string; status: string; created_at: string;
}

interface SafetyIncident {
  id: string; trip_id?: string; rider?: { full_name?: string } | null;
  driver?: { full_name?: string } | null; city?: string;
  incident_type: string; severity: string; status: string;
}

interface AuditLog {
  id: string; admin?: { full_name?: string } | null; action: string;
  target_type?: string; target_id?: string; case_id?: string; created_at: string;
}

const PRIORITY_MAP: Record<string, { color: string; label: string }> = {
  critical: { color: "bg-red-100 text-red-700 border-red-200", label: "Critical" },
  high: { color: "bg-orange-100 text-orange-700 border-orange-200", label: "High" },
  medium: { color: "bg-amber-100 text-amber-700 border-amber-200", label: "Medium" },
  low: { color: "bg-blue-100 text-blue-700 border-blue-200", label: "Low" },
};

const STATUS_MAP: Record<string, string> = {
  open: "bg-blue-100 text-blue-700",
  investigating: "bg-purple-100 text-purple-700",
  pending_review: "bg-amber-100 text-amber-700",
  resolved: "bg-green-100 text-green-700",
  dismissed: "bg-gray-100 text-gray-500",
  escalated: "bg-red-100 text-red-700",
};

const SOURCE_MAP: Record<string, string> = {
  rider_app: "Rider App", driver_app: "Driver App", admin: "Admin", system: "System",
};

export default function ModerationPage() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [cases, setCases] = useState<ModerationCase[]>([]);
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [incidents, setIncidents] = useState<SafetyIncident[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [selectedCase, setSelectedCase] = useState<ModerationCase | null>(null);

  const [stats, setStats] = useState({ open: 0, critical: 0, pending: 0, drivers: 0, riders: 0, suspensions: 0 });
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const tabs = ["All", "Safety", "Fraud", "Drivers", "Riders", "Trips", "Payments", "Chat", "Documents", "Appeals"];
  const tabKeys = ["all", "safety", "fraud", "drivers", "riders", "trips", "payments", "chat", "documents", "appeals"];
  const tabTypeMap: Record<string, string> = { safety: "safety", fraud: "fraud", drivers: "drivers", riders: "riders", trips: "trip", payments: "payment", chat: "chat", documents: "documents", appeals: "appeal" };

  const fetchAll = async () => {
    setLoading(true);
    try {
      // Fetch moderation cases with user names
      const { data: caseData } = await supabase
        .from("moderation_cases")
        .select("*, reported_user:reported_user_id(full_name), reporter:reporter_id(full_name)")
        .order("created_at", { ascending: false })
        .limit(100);

      const allCases = (caseData || []).map(c => ({
        ...c,
        reported_user_name: c.reported_user?.full_name || c.reported_user_id?.slice(0, 8) || "Unknown",
        assigned_admin_name: null,
      })) as ModerationCase[];
      setCases(allCases);

      // Stats
      setStats({
        open: allCases.filter(c => c.status === "open" || c.status === "investigating").length,
        critical: allCases.filter(c => c.priority === "critical").length,
        pending: allCases.filter(c => c.status === "pending_review").length,
        drivers: allCases.filter(c => c.reported_user_role === "driver").length,
        riders: allCases.filter(c => c.reported_user_role === "rider").length,
        suspensions: 0, // Will fetch from suspensions table
      });

      // Appeals
      const { data: appealData } = await supabase
        .from("moderation_appeals")
        .select("*, user:user_id(full_name), case:case_id(case_number)")
        .order("created_at", { ascending: false })
        .limit(50);
      setAppeals((appealData || []) as Appeal[]);

      // Safety incidents
      const { data: incidentData } = await supabase
        .from("safety_incidents")
        .select("*, rider:rider_id(full_name), driver:driver_id(full_name)")
        .order("created_at", { ascending: false })
        .limit(50);
      setIncidents((incidentData || []) as SafetyIncident[]);

      // Audit logs
      const { data: auditData } = await supabase
        .from("admin_audit_logs")
        .select("*, admin:admin_id(full_name)")
        .order("created_at", { ascending: false })
        .limit(50);
      setAuditLogs((auditData || []) as AuditLog[]);

      // Suspensions count
      const { count: suspCount } = await supabase
        .from("user_suspensions")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);
      setStats(s => ({ ...s, suspensions: suspCount || 0 }));

    } catch (err) {
      console.error("Moderation fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  // ─── ACTIONS ───
  const handleAction = async (caseId: string, actionType: string, targetUserId?: string) => {
    setActionLoading(caseId);
    try {
      // Insert moderation action
      await supabase.from("moderation_actions").insert({
        case_id: caseId,
        action_type: actionType,
        target_user_id: targetUserId || null,
        action_reason: `Admin action: ${actionType}`,
      });

      // If suspending, also insert suspension
      if (actionType === "suspend" && targetUserId) {
        const c = cases.find(x => x.id === caseId);
        await supabase.from("user_suspensions").insert({
          user_id: targetUserId,
          role: c?.reported_user_role || "rider",
          suspension_type: "temporary",
          reason: `Case ${c?.case_number || caseId}: ${actionType}`,
          starts_at: new Date().toISOString(),
          ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          is_active: true,
        });
      }

      if (actionType === "ban" && targetUserId) {
        const c = cases.find(x => x.id === caseId);
        await supabase.from("user_suspensions").insert({
          user_id: targetUserId,
          role: c?.reported_user_role || "rider",
          suspension_type: "permanent",
          reason: `Case ${c?.case_number || caseId}: permanent ban`,
          starts_at: new Date().toISOString(),
          is_active: true,
        });
      }

      // Update case status if resolving/dismissing
      if (actionType === "dismiss" || actionType === "resolve") {
        await supabase.from("moderation_cases")
          .update({ status: actionType === "dismiss" ? "dismissed" : "resolved", updated_at: new Date().toISOString(), resolved_at: new Date().toISOString() })
          .eq("id", caseId);
      }

      if (actionType === "escalate") {
        await supabase.from("moderation_cases")
          .update({ status: "escalated", priority: "critical", updated_at: new Date().toISOString() })
          .eq("id", caseId);
      }

      // Audit log
      await supabase.from("admin_audit_logs").insert({
        action: `${actionType}_case`,
        target_type: "moderation_case",
        target_id: caseId,
        case_id: caseId,
        metadata: { action_type: actionType },
      });

      fetchAll();
    } catch (err) {
      console.error("Action failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleAppeal = async (appealId: string, approved: boolean) => {
    await supabase.from("moderation_appeals").update({
      status: approved ? "approved" : "rejected",
      reviewed_at: new Date().toISOString(),
    }).eq("id", appealId);

    await supabase.from("admin_audit_logs").insert({
      action: approved ? "approved_appeal" : "rejected_appeal",
      target_type: "moderation_appeal",
      target_id: appealId,
      metadata: { approved },
    });

    fetchAll();
  };

  // Filter cases
  const filteredCases = cases.filter(c => {
    if (activeTab !== "all" && activeTab !== "appeals" && c.case_type !== tabTypeMap[activeTab]) return false;
    if (priorityFilter !== "all" && c.priority !== priorityFilter) return false;
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (search && !c.case_number?.toLowerCase().includes(search.toLowerCase()) && !c.reported_user_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* ─── HEADER ─── */}
      <div className="flex items-center justify-between" style={{ minHeight: 88 }}>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Moderation & Safety Center</h1>
          <p className="text-sm text-gray-500 mt-1">Manage reports, fraud, safety incidents, flagged users, appeals, and admin actions across rider and driver apps.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50"><RefreshCw className="h-4 w-4"/> Refresh</button>
          <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50"><Download className="h-4 w-4"/> Export</button>
          <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50"><Settings className="h-4 w-4"/> Settings</button>
          <button className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700"><Zap className="h-4 w-4"/> Emergency</button>
        </div>
      </div>

      {/* ─── KPI CARDS ─── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: "Open Cases", value: stats.open, icon: FileText, color: "bg-blue-50 text-blue-600" },
          { label: "Critical Safety", value: stats.critical, icon: AlertTriangle, color: "bg-red-50 text-red-600" },
          { label: "Pending Reviews", value: stats.pending, icon: Clock, color: "bg-amber-50 text-amber-600" },
          { label: "Flagged Drivers", value: stats.drivers, icon: Car, color: "bg-purple-50 text-purple-600" },
          { label: "Flagged Riders", value: stats.riders, icon: Users, color: "bg-indigo-50 text-indigo-600" },
          { label: "Suspensions", value: stats.suspensions, icon: Ban, color: "bg-gray-50 text-gray-600" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-[18px] border border-gray-200 p-5 flex flex-col gap-2" style={{ minHeight: 128 }}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}><s.icon className="h-5 w-5" /></div>
            <div><p className="text-2xl font-bold text-gray-900">{formatNumber(s.value)}</p><p className="text-xs text-gray-400">{s.label}</p></div>
          </div>
        ))}
      </div>

      {/* ─── MAIN GRID: Left 8 + Right 4 ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT: 8 columns */}
        <div className="lg:col-span-8 space-y-6">
          {/* MODERATION QUEUE */}
          <div className="bg-white rounded-[18px] border border-gray-200 p-5" style={{ minHeight: 620 }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Moderation Queue</h3>
              <span className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">{filteredCases.length} cases</span>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto pb-1">
              {tabs.map((t, i) => (
                <button key={t} onClick={() => setActiveTab(tabKeys[i])}
                  className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 ${activeTab===tabKeys[i]?"border-green-600 text-green-600":"border-transparent text-gray-500 hover:text-gray-700"}`}>
                  {t}
                </button>
              ))}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2 mb-4">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"/>
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by user, case ID..." className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-xs"/>
              </div>
              <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-xs">
                <option value="all">All Priority</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-xs">
                <option value="all">All Status</option><option value="open">Open</option><option value="investigating">Investigating</option><option value="pending_review">Pending Review</option><option value="resolved">Resolved</option>
              </select>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"/></div>
              ) : filteredCases.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                  <Search className="h-10 w-10 mb-2 opacity-30"/>
                  <p className="text-sm">No cases found</p>
                  <p className="text-xs mt-1">Cases will appear here when reports are submitted</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2.5 text-xs font-medium">Priority</th>
                      <th className="px-3 py-2.5 text-xs font-medium">Case ID</th>
                      <th className="px-3 py-2.5 text-xs font-medium">Source</th>
                      <th className="px-3 py-2.5 text-xs font-medium">Type</th>
                      <th className="px-3 py-2.5 text-xs font-medium">Reported</th>
                      <th className="px-3 py-2.5 text-xs font-medium">Reason</th>
                      <th className="px-3 py-2.5 text-xs font-medium">Status</th>
                      <th className="px-3 py-2.5 text-xs font-medium">Created</th>
                      <th className="px-3 py-2.5 text-xs font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCases.map(c => (
                      <tr key={c.id} onClick={() => setSelectedCase(c)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-3 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${PRIORITY_MAP[c.priority]?.color || "bg-gray-100 text-gray-600"}`}>{PRIORITY_MAP[c.priority]?.label || c.priority}</span></td>
                        <td className="px-3 py-3 text-xs font-mono text-gray-600">{c.case_number}</td>
                        <td className="px-3 py-3 text-xs">{SOURCE_MAP[c.source_app] || c.source_app}</td>
                        <td className="px-3 py-3 text-xs capitalize">{c.case_type}</td>
                        <td className="px-3 py-3 text-xs font-medium">{c.reported_user_name}</td>
                        <td className="px-3 py-3 text-xs text-gray-500 max-w-[180px] truncate">{c.reason}</td>
                        <td className="px-3 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_MAP[c.status] || "bg-gray-100 text-gray-600"}`}>{c.status?.replace(/_/g," ")}</span></td>
                        <td className="px-3 py-3 text-xs text-gray-400">{timeAgo(c.created_at)}</td>
                        <td className="px-3 py-3 text-right" onClick={e=>e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {actionLoading === c.id ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-green-600 border-t-transparent"/> : <>
                              <button onClick={()=>handleAction(c.id,"note")} className="p-1 hover:bg-blue-50 rounded" title="Note"><Eye className="h-3.5 w-3.5 text-blue-500"/></button>
                              <button onClick={()=>handleAction(c.id,"warn",c.reported_user_id)} className="p-1 hover:bg-amber-50 rounded" title="Warn"><Flag className="h-3.5 w-3.5 text-amber-500"/></button>
                              <button onClick={()=>handleAction(c.id,"suspend",c.reported_user_id)} className="p-1 hover:bg-red-50 rounded" title="Suspend"><Ban className="h-3.5 w-3.5 text-red-500"/></button>
                              <button onClick={()=>handleAction(c.id,"dismiss")} className="p-1 hover:bg-gray-100 rounded" title="Dismiss"><MoreHorizontal className="h-3.5 w-3.5 text-gray-400"/></button>
                            </>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* CASE DETAIL PREVIEW */}
          {selectedCase && (
            <div className="bg-white rounded-[18px] border border-gray-200 p-5" style={{ minHeight: 380 }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Case Detail — {selectedCase.case_number}</h3>
                <button onClick={() => setSelectedCase(null)} className="text-gray-400 hover:text-gray-600"><XCircle className="h-5 w-5"/></button>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-xs text-gray-400">Priority</p><span className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${PRIORITY_MAP[selectedCase.priority]?.color || ""}`}>{PRIORITY_MAP[selectedCase.priority]?.label}</span></div>
                <div><p className="text-xs text-gray-400">Status</p><span className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_MAP[selectedCase.status] || ""}`}>{selectedCase.status?.replace(/_/g," ")}</span></div>
                <div><p className="text-xs text-gray-400">Reported User</p><p className="font-medium">{selectedCase.reported_user_name} <span className="text-gray-400 text-xs capitalize">({selectedCase.reported_user_role})</span></p></div>
                <div><p className="text-xs text-gray-400">City</p><p className="font-medium">{selectedCase.city || "—"}</p></div>
                <div className="col-span-2"><p className="text-xs text-gray-400">Reason</p><p className="font-medium">{selectedCase.reason}</p></div>
                <div className="col-span-2"><p className="text-xs text-gray-400">Source</p><p className="font-medium">{SOURCE_MAP[selectedCase.source_app] || selectedCase.source_app}</p></div>
              </div>
              <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-gray-100">
                <button onClick={()=>handleAction(selectedCase.id,"note")} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200">Save Note</button>
                <button onClick={()=>handleAction(selectedCase.id,"warn",selectedCase.reported_user_id)} className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-100">Warn User</button>
                <button onClick={()=>handleAction(selectedCase.id,"suspend",selectedCase.reported_user_id)} className="px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg text-xs font-medium hover:bg-orange-100">Suspend 24h</button>
                <button onClick={()=>handleAction(selectedCase.id,"ban",selectedCase.reported_user_id)} className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100">Ban Permanently</button>
                <button onClick={()=>handleAction(selectedCase.id,"escalate")} className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-100">Escalate</button>
                <button onClick={()=>{handleAction(selectedCase.id,"resolve");setSelectedCase(null);}} className="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100 ml-auto">Resolve Case</button>
              </div>
            </div>
          )}

          {/* APPEALS */}
          <div className="bg-white rounded-[18px] border border-gray-200 p-5" style={{ minHeight: 360 }}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Appeals Management</h3>
            <div className="overflow-x-auto">
              {appeals.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                  <FileCheck className="h-8 w-8 mb-2 opacity-30"/>
                  <p className="text-sm">No appeals submitted yet</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-500 bg-gray-50 border-b"><th className="px-3 py-2.5 text-xs font-medium">User</th><th className="px-3 py-2.5 text-xs font-medium">Case</th><th className="px-3 py-2.5 text-xs font-medium">Reason</th><th className="px-3 py-2.5 text-xs font-medium">Status</th><th className="px-3 py-2.5 text-xs font-medium">Submitted</th><th className="px-3 py-2.5 text-xs font-medium text-right">Actions</th></tr></thead>
                  <tbody>{appeals.map(a => (
                    <tr key={a.id} className="border-b border-gray-50"><td className="px-3 py-3 text-xs font-medium">{a.user?.full_name || "Unknown"}</td><td className="px-3 py-3 text-xs font-mono text-gray-400">{a.case?.case_number || "—"}</td><td className="px-3 py-3 text-xs text-gray-500 max-w-[200px] truncate">{a.appeal_reason}</td><td className="px-3 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${a.status==="pending"?"bg-amber-100 text-amber-700":a.status==="approved"?"bg-green-100 text-green-700":"bg-red-100 text-red-700"}`}>{a.status}</span></td><td className="px-3 py-3 text-xs text-gray-400">{timeAgo(a.created_at)}</td><td className="px-3 py-3 text-right"><div className="flex items-center justify-end gap-1">
                      {a.status==="pending"&&<>
                        <button onClick={()=>handleAppeal(a.id,true)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"><CheckCircle className="h-3 w-3"/></button>
                        <button onClick={()=>handleAppeal(a.id,false)} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"><XCircle className="h-3 w-3"/></button>
                      </>}
                    </div></td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>

          {/* SAFETY INCIDENTS */}
          <div className="bg-white rounded-[18px] border border-gray-200 p-5" style={{ minHeight: 360 }}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Safety Incidents</h3>
            <div className="overflow-x-auto">
              {incidents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                  <Shield className="h-8 w-8 mb-2 opacity-30"/>
                  <p className="text-sm">No safety incidents recorded</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-500 bg-gray-50 border-b"><th className="px-3 py-2.5 text-xs font-medium">Trip</th><th className="px-3 py-2.5 text-xs font-medium">Rider</th><th className="px-3 py-2.5 text-xs font-medium">Driver</th><th className="px-3 py-2.5 text-xs font-medium">Type</th><th className="px-3 py-2.5 text-xs font-medium">Severity</th><th className="px-3 py-2.5 text-xs font-medium">Status</th></tr></thead>
                  <tbody>{incidents.map(i => (
                    <tr key={i.id} className="border-b border-gray-50"><td className="px-3 py-3 text-xs font-mono">{i.trip_id?.slice(0,8)||"—"}</td><td className="px-3 py-3 text-xs">{i.rider?.full_name||"—"}</td><td className="px-3 py-3 text-xs">{i.driver?.full_name||"—"}</td><td className="px-3 py-3 text-xs capitalize">{i.incident_type?.replace(/_/g," ")}</td><td className="px-3 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${i.severity==="critical"?"bg-red-100 text-red-700":"bg-amber-100 text-amber-700"}`}>{i.severity}</span></td><td className="px-3 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${i.status==="active"?"bg-red-100 text-red-700":"bg-green-100 text-green-700"}`}>{i.status}</span></td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>

          {/* AUDIT LOGS */}
          <div className="bg-white rounded-[18px] border border-gray-200 p-5" style={{ minHeight: 360 }}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Admin Audit Logs</h3>
            <div className="overflow-x-auto">
              {auditLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                  <Activity className="h-8 w-8 mb-2 opacity-30"/>
                  <p className="text-sm">No audit logs yet — actions will appear here</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-500 bg-gray-50 border-b"><th className="px-3 py-2.5 text-xs font-medium">Time</th><th className="px-3 py-2.5 text-xs font-medium">Admin</th><th className="px-3 py-2.5 text-xs font-medium">Action</th><th className="px-3 py-2.5 text-xs font-medium">Target</th><th className="px-3 py-2.5 text-xs font-medium">Case</th></tr></thead>
                  <tbody>{auditLogs.map(a => (
                    <tr key={a.id} className="border-b border-gray-50"><td className="px-3 py-3 text-xs text-gray-400">{timeAgo(a.created_at)}</td><td className="px-3 py-3 text-xs font-medium">{a.admin?.full_name || "System"}</td><td className="px-3 py-3 text-xs">{a.action?.replace(/_/g," ")}</td><td className="px-3 py-3 text-xs text-gray-500">{a.target_type}</td><td className="px-3 py-3 text-xs font-mono text-gray-400">{a.case_id?.slice(0,8) || "—"}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: 4 columns */}
        <div className="lg:col-span-4 space-y-4">
          {/* Critical Alerts */}
          <div className="bg-white rounded-[18px] border border-gray-200 p-5" style={{ minHeight: 260 }}>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500"/>Critical Alerts</h3>
            {cases.filter(c=>c.priority==="critical"&&c.status!=="resolved").length===0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                <AlertTriangle className="h-8 w-8 mb-2 opacity-20"/>
                <p className="text-xs">No critical alerts — all clear</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cases.filter(c=>c.priority==="critical"&&c.status!=="resolved").slice(0,5).map(c => (
                  <div key={c.id} className="flex items-center justify-between p-2 bg-red-50 rounded-xl border border-red-100">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"/>
                      <div><p className="text-xs font-medium text-gray-800">{c.reported_user_name}</p><p className="text-[10px] text-gray-500">{c.case_type} · {timeAgo(c.created_at)}</p></div>
                    </div>
                    <button onClick={()=>setSelectedCase(c)} className="px-2 py-1 text-[10px] font-medium bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-100">Review</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Fraud Intelligence */}
          <div className="bg-white rounded-[18px] border border-gray-200 p-5" style={{ minHeight: 300 }}>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><Shield className="h-4 w-4 text-purple-500"/>Fraud Intelligence</h3>
            {cases.filter(c=>c.case_type==="fraud"&&c.status!=="resolved").length===0 ? (
              <div className="flex flex-col items-center justify-center h-24 text-gray-400">
                <Shield className="h-8 w-8 mb-2 opacity-20"/>
                <p className="text-xs">No active fraud cases</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cases.filter(c=>c.case_type==="fraud"&&c.status!=="resolved").slice(0,4).map(c => (
                  <div key={c.id} className="p-2 bg-red-50 rounded-xl border border-red-100">
                    <p className="text-xs font-medium text-gray-800">{c.reported_user_name}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{c.reason.slice(0,80)}</p>
                    <span className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_MAP[c.status]}`}>{c.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* User Risk Snapshot */}
          <div className="bg-white rounded-[18px] border border-gray-200 p-5" style={{ minHeight: 300 }}>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><UserCheck className="h-4 w-4 text-green-500"/>User Risk Snapshot</h3>
            {!selectedCase ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                <Users className="h-8 w-8 mb-2 opacity-20"/>
                <p className="text-sm">Select a case to view</p>
                <p className="text-xs mt-1">Click any case in the queue</p>
              </div>
            ) : (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-gray-400">Name</span><span className="font-medium">{selectedCase.reported_user_name}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Role</span><span className="font-medium capitalize">{selectedCase.reported_user_role||"—"}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Case Type</span><span className="font-medium capitalize">{selectedCase.case_type}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Priority</span><span className="font-medium">{selectedCase.priority}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">City</span><span className="font-medium">{selectedCase.city||"—"}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Total Cases</span><span className="font-medium">{cases.filter(c=>c.reported_user_id===selectedCase.reported_user_id).length}</span></div>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-[18px] border border-gray-200 p-5" style={{ minHeight: 240 }}>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Refresh Data", icon: RefreshCw, action: fetchAll },
                { label: "View Appeals", icon: FileCheck, action: ()=>setActiveTab("appeals") },
                { label: "Audit Logs", icon: Activity, action: ()=>{} },
              ].map(a => (
                <button key={a.label} onClick={a.action} className="flex flex-col items-center gap-1 p-3 bg-gray-50 rounded-xl hover:bg-gray-100">
                  <a.icon className="h-5 w-5 text-gray-500"/>
                  <span className="text-[10px] font-medium text-gray-600 text-center">{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}