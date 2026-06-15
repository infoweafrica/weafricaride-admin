"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  RefreshCw, Search, Download, Filter, X, Eye, Copy,
  FileText, AlertTriangle, CheckCircle, XCircle, Info,
  Activity, Clock, Shield, UserCheck, ChevronLeft, ChevronRight,
  Zap,
} from "lucide-react";
import { formatNumber, timeAgo } from "@/lib/utils";

// ─── TYPES ───
interface AuditLog {
  id: string;
  admin_id: string | null;
  admin?: { full_name?: string; email?: string } | null;
  action: string;
  entity_type: string | null;
  target_type: string | null;
  target_id: string | null;
  entity_id: string | null;
  severity: string;
  status: string;
  city: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  case_id: string | null;
}

const SEVERITY_MAP: Record<string, { color: string; icon: typeof Info }> = {
  info: { color: "bg-blue-100 text-blue-700", icon: Info },
  success: { color: "bg-green-100 text-green-700", icon: CheckCircle },
  warning: { color: "bg-amber-100 text-amber-700", icon: AlertTriangle },
  error: { color: "bg-red-100 text-red-700", icon: XCircle },
  critical: { color: "bg-red-200 text-red-800 border border-red-300", icon: Shield },
};

const STATUS_MAP: Record<string, string> = {
  success: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  pending: "bg-amber-100 text-amber-700",
};

const ACTIONS = ["login","logout","create","update","delete","approve","reject","suspend","reactivate","ban","warn","dismiss","escalate","resolve","payout","refund","send","schedule","invite","reset_password","view","export"];
const ENTITIES = ["driver","rider","ride","vehicle","payment","promo","referral","notification","moderation_case","appeal","pricing","feature_flag","staff","admin_role","settings"];
const SEVERITIES = ["all","info","success","warning","error","critical"];
const PAGE_SIZES = [25,50,100];

export default function AuditLogsPage() {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState({ total: 0, critical: 0, failed: 0, today: 0 });
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState("7d");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("admin_audit_logs")
        .select("*, admin:admin_id(full_name, email)", { count: "exact" });

      // Date filter
      if (dateRange === "today") {
        query = query.gte("created_at", new Date(new Date().setHours(0,0,0,0)).toISOString());
      } else if (dateRange === "7d") {
        query = query.gte("created_at", new Date(Date.now() - 7*24*60*60*1000).toISOString());
      } else if (dateRange === "30d") {
        query = query.gte("created_at", new Date(Date.now() - 30*24*60*60*1000).toISOString());
      }

      if (actionFilter !== "all") {
        query = query.ilike("action", `%${actionFilter}%`);
      }
      if (entityFilter !== "all") {
        query = query.eq("target_type", entityFilter);
      }

      if (search.trim()) {
        const s = `%${search.toLowerCase()}%`;
        query = query.or(`action.ilike.${s},target_type.ilike.${s}`);
      }

      const { count } = await query;
      setTotalCount(count || 0);

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const { data } = await query
        .order("created_at", { ascending: false })
        .range(from, to);

      const all = (data || []).map((log: Record<string, unknown>) => ({
        ...log,
        severity: (log.action as string)?.includes("delete") || (log.action as string)?.includes("ban") ? "critical" :
                  (log.action as string)?.includes("reject") || (log.action as string)?.includes("suspend") || (log.action as string)?.includes("failed") ? "warning" :
                  (log.action as string)?.includes("approve") || (log.action as string)?.includes("resolve") || (log.action as string)?.includes("complete") ? "success" : "info",
        status: "success",
      })) as AuditLog[];

      setLogs(all);

      // Stats
      const { count: totalAll } = await supabase.from("admin_audit_logs").select("*", { count: "exact", head: true });
      const { count: todayCount } = await supabase.from("admin_audit_logs").select("*", { count: "exact", head: true }).gte("created_at", new Date(new Date().setHours(0,0,0,0)).toISOString());
      const { count: criticalCount } = await supabase.from("admin_audit_logs").select("*", { count: "exact", head: true }).or("action.ilike.%delete%,action.ilike.%ban%,action.ilike.%suspend%");
      const { count: failedCount } = await supabase.from("admin_audit_logs").select("*", { count: "exact", head: true }).eq("status", "failed");

      setStats({
        total: totalAll || 0,
        critical: criticalCount || 0,
        failed: failedCount || 0,
        today: todayCount || 0,
      });
    } catch { /* */ } finally { setLoading(false); }
  }, [page, pageSize, dateRange, actionFilter, entityFilter, search]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const totalPages = Math.ceil(totalCount / pageSize);
  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); };

  return (
    <div className="space-y-6">
      {/* ─── HEADER ─── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
          <p className="text-sm text-gray-500 mt-1">Track every admin action — who did what, when, to whom, and what changed.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchLogs} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
            <RefreshCw className={`h-4 w-4 ${loading?"animate-spin":""}`}/> Refresh
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700">
            <Download className="h-4 w-4"/> Export CSV
          </button>
        </div>
      </div>

      {/* ─── STATS CARDS ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Logs", value: stats.total, icon: FileText, color: "bg-blue-50 text-blue-600" },
          { label: "Critical Actions", value: stats.critical, icon: Shield, color: "bg-red-50 text-red-600" },
          { label: "Failed Actions", value: stats.failed, icon: XCircle, color: stats.failed > 0 ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600" },
          { label: "Today's Activity", value: stats.today, icon: Activity, color: "bg-purple-50 text-purple-600" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-4" style={{minHeight:110}}>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${s.color}`}><s.icon className="h-6 w-6"/></div>
            <div><p className="text-2xl font-bold text-gray-900">{formatNumber(s.value)}</p><p className="text-xs text-gray-400">{s.label}</p></div>
          </div>
        ))}
      </div>

      {/* ─── FILTER BAR ─── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"/>
          <input type="text" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}
            placeholder="Search by action, entity, admin..." className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-xs"/>
        </div>

        <select value={dateRange} onChange={e=>{setDateRange(e.target.value);setPage(1);}} className="px-3 py-2.5 border border-gray-200 rounded-xl text-xs">
          <option value="today">Today</option><option value="7d">Last 7 Days</option><option value="30d">Last 30 Days</option><option value="all">All Time</option>
        </select>

        <select value={severityFilter} onChange={e=>{setSeverityFilter(e.target.value);setPage(1);}} className="px-3 py-2.5 border border-gray-200 rounded-xl text-xs">
          <option value="all">All Severity</option>
          {SEVERITIES.filter(s=>s!=="all").map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
        </select>

        <select value={actionFilter} onChange={e=>{setActionFilter(e.target.value);setPage(1);}} className="px-3 py-2.5 border border-gray-200 rounded-xl text-xs">
          <option value="all">All Actions</option>
          {ACTIONS.map(a=><option key={a} value={a}>{a.replace(/_/g," ")}</option>)}
        </select>

        <select value={entityFilter} onChange={e=>{setEntityFilter(e.target.value);setPage(1);}} className="px-3 py-2.5 border border-gray-200 rounded-xl text-xs">
          <option value="all">All Entities</option>
          {ENTITIES.map(e=><option key={e} value={e}>{e.replace(/_/g," ")}</option>)}
        </select>

        {(search||dateRange!=="7d"||severityFilter!=="all"||actionFilter!=="all"||entityFilter!=="all")&&(
          <button onClick={()=>{setSearch("");setDateRange("7d");setSeverityFilter("all");setActionFilter("all");setEntityFilter("all");setPage(1);}} className="flex items-center gap-1 px-3 py-2.5 text-xs text-red-600 hover:bg-red-50 rounded-xl"><X className="h-3 w-3"/> Clear</button>
        )}
      </div>

      {/* ─── LOGS TABLE ─── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200" style={{height:52}}>
                <th className="px-4 py-3 text-xs font-medium w-[140px]">Time</th>
                <th className="px-4 py-3 text-xs font-medium w-[90px]">Severity</th>
                <th className="px-4 py-3 text-xs font-medium">Action</th>
                <th className="px-4 py-3 text-xs font-medium">Entity</th>
                <th className="px-4 py-3 text-xs font-medium">Admin</th>
                <th className="px-4 py-3 text-xs font-medium">Role</th>
                <th className="px-4 py-3 text-xs font-medium">IP</th>
                <th className="px-4 py-3 text-xs font-medium">Status</th>
                <th className="px-4 py-3 text-xs font-medium text-right">View</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="py-12 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto"/></td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={9} className="py-16 text-center">
                  <Search className="h-10 w-10 mx-auto mb-3 opacity-20"/>
                  <p className="text-sm text-gray-500 font-medium">No audit logs found</p>
                  <p className="text-xs text-gray-400 mt-1">Admin actions will appear here as they happen across the platform.</p>
                </td></tr>
              ) : (
                logs.map(log => {
                  const sev = SEVERITY_MAP[log.severity] || SEVERITY_MAP.info;
                  const SevIcon = sev.icon;
                  const adminName = log.admin?.full_name || log.admin?.email || "System";
                  return (
                    <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={()=>setSelectedLog(log)} style={{height:64}}>
                      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{timeAgo(log.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${sev.color}`}>
                          <SevIcon className="h-3 w-3"/>{log.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-700 capitalize">
                          {log.action?.replace(/_/g," ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 capitalize">{log.target_type || log.entity_type || "—"}</td>
                      <td className="px-4 py-3 text-xs font-medium text-gray-700">{adminName}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{/* role derived from admin context */ "—"}</td>
                      <td className="px-4 py-3 text-xs text-gray-400 font-mono">{log.ip_address || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_MAP[log.status]||"bg-green-100 text-green-700"}`}>{log.status || "success"}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={(e)=>{e.stopPropagation();setSelectedLog(log);}} className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-500">
                          <Eye className="h-3.5 w-3.5"/>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
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
                let pg: number;
                if (totalPages<=5) pg=i+1;
                else if (page<=3) pg=i+1;
                else if (page>=totalPages-2) pg=totalPages-4+i;
                else pg=page-2+i;
                if (pg<1||pg>totalPages) return null;
                return <button key={pg} onClick={()=>setPage(pg)} className={`px-2.5 py-1 rounded text-xs font-medium ${pg===page?"bg-green-600 text-white":"border hover:bg-gray-50"}`}>{pg}</button>;
              })}
              <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page>=totalPages} className="px-2 py-1 border rounded text-xs disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5"/></button>
            </div>
          </div>
        )}
      </div>

      {/* ─── DETAIL MODAL ─── */}
      {selectedLog && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={()=>setSelectedLog(null)}/>
          <div className="fixed inset-y-0 right-0 w-full max-w-[460px] bg-white shadow-2xl z-50 overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-900">Audit Log Detail</h3>
                <button onClick={()=>setSelectedLog(null)} className="p-1.5 hover:bg-gray-100 rounded-lg"><X className="h-5 w-5 text-gray-400"/></button>
              </div>

              <div className="space-y-4">
                {/* Severity */}
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${SEVERITY_MAP[selectedLog.severity]?.color}`}>
                    {(()=>{const I=SEVERITY_MAP[selectedLog.severity]?.icon;return I?<I className="h-3.5 w-3.5"/>:null;})()}
                    {selectedLog.severity?.toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-400">{timeAgo(selectedLog.created_at)}</span>
                </div>

                {/* Basic Info */}
                <div className="bg-gray-50 rounded-xl p-4 space-y-3 text-sm">
                  {[
                    { label: "Log ID", value: selectedLog.id?.slice(0,12) },
                    { label: "Timestamp", value: new Date(selectedLog.created_at).toLocaleString() },
                    { label: "Admin", value: selectedLog.admin?.full_name || selectedLog.admin?.email || "System" },
                    { label: "Admin Email", value: selectedLog.admin?.email || "—" },
                    { label: "Action", value: selectedLog.action?.replace(/_/g," ") },
                    { label: "Entity Type", value: selectedLog.target_type || selectedLog.entity_type || "—" },
                    { label: "Entity ID", value: selectedLog.target_id || selectedLog.entity_id || "—" },
                    { label: "Case ID", value: selectedLog.case_id || "—" },
                    { label: "City", value: selectedLog.city || "—" },
                    { label: "IP Address", value: selectedLog.ip_address || "—" },
                    { label: "Status", value: selectedLog.status || "success" },
                    { label: "Error", value: selectedLog.error_message || "None" },
                  ].map(f => (
                    <div key={f.label} className="flex justify-between">
                      <span className="text-gray-400 text-xs">{f.label}</span>
                      <span className="text-xs font-medium text-gray-700 text-right max-w-[200px] truncate">{f.value}</span>
                    </div>
                  ))}
                </div>

                {/* Changes: Before → After */}
                {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                  <div className="bg-gray-50 rounded-xl p-4">
                    <p className="text-xs font-medium text-gray-400 mb-2">Changes</p>
                    <pre className="text-[10px] text-gray-600 bg-gray-100 p-3 rounded-lg overflow-x-auto max-h-[200px] overflow-y-auto">
                      {JSON.stringify(selectedLog.metadata, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedLog.details && Object.keys(selectedLog.details).length > 0 && (
                  <div className="bg-gray-50 rounded-xl p-4">
                    <p className="text-xs font-medium text-gray-400 mb-2">Details</p>
                    <pre className="text-[10px] text-gray-600 bg-gray-100 p-3 rounded-lg overflow-x-auto max-h-[200px] overflow-y-auto">
                      {JSON.stringify(selectedLog.details, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-2 pt-2">
                  <button onClick={()=>copyToClipboard(selectedLog.id)} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 border rounded-xl text-xs font-medium text-gray-600 hover:bg-gray-50">
                    <Copy className="h-3.5 w-3.5"/> Copy ID
                  </button>
                  <button className="flex-1 flex items-center justify-center gap-1 px-3 py-2 border rounded-xl text-xs font-medium text-gray-600 hover:bg-gray-50">
                    <Download className="h-3.5 w-3.5"/> Export JSON
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}