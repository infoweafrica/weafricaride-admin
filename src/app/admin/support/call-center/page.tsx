"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { RefreshCw, Phone, AlertTriangle, Plus, Search, ExternalLink } from "lucide-react";
import { formatCurrency, getStatusColor, timeAgo } from "@/lib/utils";
import Link from "next/link";

type TicketRow = {
  id: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  rider_name: string;
  driver_name: string;
  created_at: string;
  ride_id: string | null;
};

type EscalationRow = {
  id: string;
  type: string;
  description: string;
  status: string;
  created_at: string;
};

export default function CallCenterPage() {
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [escalations, setEscalations] = useState<EscalationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState({ open: 0, in_progress: 0, escalated: 0, resolved_today: 0 });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch support tickets (call center queue)
      const { data: ticketData } = await supabase
        .from("support_tickets")
        .select(`
          id, subject, category, status, priority, created_at,
          ride_id,
          rider:rider_id(full_name),
          driver:driver_id(full_name)
        `)
        .order("created_at", { ascending: false })
        .limit(100);

      if (ticketData) {
        const mapped = ticketData.map((t: any) => {
          const riderObj = t.rider as Record<string, any> | undefined;
          const driverObj = t.driver as Record<string, any> | undefined;
          return {
            id: t.id,
            subject: t.subject || t.description || "—",
            category: t.category || "general",
            status: t.status || "open",
            priority: t.priority || "normal",
            rider_name: riderObj?.full_name || "",
            driver_name: driverObj?.full_name || "",
            created_at: t.created_at,
            ride_id: t.ride_id,
          };
        });
        setTickets(mapped);

        const openCount = mapped.filter(t => t.status === "open").length;
        const inProgressCount = mapped.filter(t => t.status === "in_progress" || t.status === "pending").length;
        const escalatedCount = mapped.filter(t => t.status === "escalated" || t.status === "urgent").length;

        // Resolved today
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const resolvedToday = mapped.filter(t =>
          (t.status === "resolved" || t.status === "closed") &&
          new Date(t.created_at) >= todayStart
        ).length;

        setStats({
          open: openCount,
          in_progress: inProgressCount,
          escalated: escalatedCount,
          resolved_today: resolvedToday,
        });
      }

      // Fetch emergency escalations (safety-related tickets)
      const { data: escData } = await supabase
        .from("support_tickets")
        .select("id, category, description, status, created_at")
        .in("category", ["safety", "emergency", "harassment", "fraud"])
        .in("status", ["open", "escalated", "urgent"])
        .order("created_at", { ascending: false })
        .limit(20);

      if (escData) {
        setEscalations(escData.map((e: any) => ({
          id: e.id,
          type: e.category || "general",
          description: e.description || "—",
          status: e.status || "open",
          created_at: e.created_at,
        })));
      }
    } catch (err) {
      console.error("Failed to load call center data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = tickets.filter((t) =>
    t.subject.toLowerCase().includes(search.toLowerCase()) ||
    t.rider_name.toLowerCase().includes(search.toLowerCase()) ||
    t.driver_name.toLowerCase().includes(search.toLowerCase()) ||
    t.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Call Center</h1>
          <p className="text-gray-500 mt-1">Support tickets, escalations, and manual ride management</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/support/tickets" className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            All Tickets
          </Link>
          <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Phone className="h-5 w-5 text-amber-600" />
            <p className="text-xs text-gray-500 font-medium">Open Tickets</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{loading ? "..." : stats.open}</p>
        </div>
        <div className="bg-white rounded-xl border border-blue-200 p-5 bg-blue-50">
          <div className="flex items-center gap-2 mb-2">
            <Phone className="h-5 w-5 text-blue-600" />
            <p className="text-xs text-blue-600 font-medium">In Progress</p>
          </div>
          <p className="text-2xl font-bold text-blue-700">{loading ? "..." : stats.in_progress}</p>
        </div>
        <div className="bg-white rounded-xl border border-red-200 p-5 bg-red-50">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <p className="text-xs text-red-600 font-medium">Escalated</p>
          </div>
          <p className="text-2xl font-bold text-red-700">{loading ? "..." : stats.escalated}</p>
        </div>
        <div className="bg-white rounded-xl border border-green-200 p-5 bg-green-50">
          <div className="flex items-center gap-2 mb-2">
            <Plus className="h-5 w-5 text-green-600" />
            <p className="text-xs text-green-600 font-medium">Resolved Today</p>
          </div>
          <p className="text-2xl font-bold text-green-700">{loading ? "..." : stats.resolved_today}</p>
        </div>
      </div>

      {/* Escalations Section */}
      {escalations.length > 0 && (
        <div className="bg-red-50 rounded-xl border border-red-200 p-5">
          <h3 className="text-sm font-bold text-red-800 mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Active Escalations ({escalations.length})
          </h3>
          <div className="space-y-2">
            {escalations.slice(0, 5).map((e) => (
              <div key={e.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-2 border border-red-100">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-red-600 bg-red-100 px-2 py-0.5 rounded">{e.type}</span>
                  <span className="text-sm text-gray-700 truncate max-w-md">{e.description}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">{timeAgo(e.created_at)}</span>
                  <Link href={`/admin/support/tickets?id=${e.id}`} className="text-green-600 hover:text-green-700">
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search tickets by subject, rider, driver, or category..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      {/* Tickets Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Subject</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Rider</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Driver</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Priority</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Time</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-gray-400">Loading tickets...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-gray-400">No tickets found</td></tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{t.subject}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{t.category}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{t.rider_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{t.driver_name || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                        t.priority === "urgent" || t.priority === "high" ? "bg-red-100 text-red-700" :
                        t.priority === "normal" ? "bg-yellow-100 text-yellow-700" :
                        "bg-gray-100 text-gray-700"
                      }`}>
                        {t.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(t.status)}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{timeAgo(t.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/admin/support/tickets?id=${t.id}`} className="text-green-600 hover:text-green-700 text-xs font-medium">
                        Open
                      </Link>
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