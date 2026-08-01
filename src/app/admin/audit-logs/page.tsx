"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { AuditLog } from "@/lib/types";
import { Search } from "lucide-react";
import { timeAgo } from "@/lib/utils";

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from("audit_logs").select("*, admin:admin_users(user:users(full_name))").order("created_at", { ascending: false }).range(0, pageSize - 1);
      setLogs(data || []);
    } catch {
      setLogs([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchLogs(); }, []);

  const filteredLogs = logs.filter(log => {
    if (search) {
      const s = search.toLowerCase();
      if (!log.entity_id?.toLowerCase().includes(s) && !log.entity_type?.toLowerCase().includes(s) && !log.action?.toLowerCase().includes(s)) return false;
    }
    if (actionFilter !== "all" && log.action !== actionFilter) return false;
    if (entityFilter !== "all" && log.entity_type !== entityFilter) return false;
    return true;
  });

  const actions = ["all", ...new Set(logs.map(l => l.action))];
  const entities = ["all", ...new Set(logs.map(l => l.entity_type))];

  const getActionColor = (action: string) => {
    const colors: Record<string, string> = { approve: "bg-green-100 text-green-800", reject: "bg-red-100 text-red-800", create: "bg-blue-100 text-blue-800", update: "bg-yellow-100 text-yellow-800", delete: "bg-red-100 text-red-800", login: "bg-gray-100 text-gray-800", logout: "bg-gray-100 text-gray-800", refund: "bg-orange-100 text-orange-800", suspend: "bg-red-100 text-red-800", payout: "bg-purple-100 text-purple-800" };
    return colors[action] || "bg-gray-100 text-gray-800";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
        <p className="text-gray-500 mt-1">Track all admin actions and system changes</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input type="text" placeholder="Search logs..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          </div>
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm">
            <option value="all">All Actions</option>
            {actions.filter(a => a !== "all").map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm">
            <option value="all">All Entities</option>
            {entities.filter(e => e !== "all").map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Entity ID</th>
                  <th className="px-4 py-3 font-medium">Admin</th>
                  <th className="px-4 py-3 font-medium">Changes</th>
                  <th className="px-4 py-3 font-medium">IP Address</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium capitalize ${getActionColor(log.action)}`}>{log.action}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 capitalize">{log.entity_type}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">{log.entity_id?.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{(log as unknown as { admin?: { user?: { full_name?: string } } }).admin?.user?.full_name || "System"}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {(log as unknown as { old_value?: unknown }).old_value && (log as unknown as { new_value?: unknown }).new_value ? (
                        <span>{JSON.stringify((log as unknown as { old_value?: unknown }).old_value).slice(0, 50)} → {JSON.stringify((log as unknown as { new_value?: unknown }).new_value).slice(0, 50)}</span>
                      ) : <span>-</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">{log.ip_address}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{timeAgo(log.created_at)}</td>
                  </tr>
                ))}
                {filteredLogs.length === 0 && <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">No audit logs found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Showing {filteredLogs.length} of {logs.length} logs</p>
        <div className="flex gap-2">
          <button onClick={() => setPage(p => Math.max(1, p-1))} className="px-3 py-1 border rounded text-xs" disabled={page === 1}>Previous</button>
          <button onClick={() => setPage(p => p+1)} className="px-3 py-1 border rounded text-xs">Next</button>
        </div>
      </div>
    </div>
  );
}