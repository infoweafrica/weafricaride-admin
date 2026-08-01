"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import { RefreshCw, FileText, Search } from "lucide-react";
import type { AuditLog } from "@/lib/types";

export default function ApiLogsPage() {
  return (
    <PermissionGuard permission="view_logs">
      <LogsContent />
    </PermissionGuard>
  );
}

function LogsContent() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      setLogs((data as AuditLog[]) || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const filtered = search
    ? logs.filter(
        (l) =>
          l.action.includes(search.toLowerCase()) ||
          l.admin_email?.toLowerCase().includes(search.toLowerCase()) ||
          l.entity_type?.toLowerCase().includes(search.toLowerCase())
      )
    : logs;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">API & System Logs</h1>
          <p className="text-sm text-gray-500 mt-1">Monitor system activity and API requests</p>
        </div>
        <button
          onClick={fetchLogs}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search logs by action, email, or entity..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-700 w-32">Timestamp</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Admin</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Action</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Entity</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-gray-400">
                    Loading logs...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-gray-400">
                    No logs found
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 100).map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{log.admin_email || "System"}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{log.entity_type}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs max-w-xs truncate">
                      {log.details ? JSON.stringify(log.details).slice(0, 80) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}