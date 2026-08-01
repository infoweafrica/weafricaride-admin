"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Search, AlertTriangle, Filter, RefreshCw } from "lucide-react";
import { formatDate, getStatusColor } from "@/lib/utils";

type Complaint = {
  id: string;
  category: string;
  status: string;
  priority: string;
  subject: string;
  description: string;
  user_name: string;
  ride_id: string | null;
  created_at: string;
};

const CATEGORIES = [
  "driver_behavior", "rider_behavior", "payment_issue", "safety_issue", "vehicle_issue", "other",
];

export default function ComplaintsPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchComplaints = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("support_tickets")
        .select("id, category, status, priority, subject, description, user_name, ride_id, created_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (categoryFilter !== "all") query = query.eq("category", categoryFilter);
      if (statusFilter !== "all") query = query.eq("status", statusFilter);

      const { data } = await query;
      if (data) setComplaints(data as Complaint[]);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [categoryFilter, statusFilter]);

  useEffect(() => { fetchComplaints(); }, [fetchComplaints]);

  const filtered = complaints.filter((c) =>
    c.subject?.toLowerCase().includes(search.toLowerCase()) ||
    c.user_name?.toLowerCase().includes(search.toLowerCase())
  );

  const countByCategory = CATEGORIES.map((cat) => ({
    name: cat.replace(/_/g, " "),
    count: complaints.filter((c) => c.category === cat).length,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Complaint Management</h1>
          <p className="text-gray-500 mt-1">{complaints.length} total — driver behavior, rider behavior, payment, safety, vehicle</p>
        </div>
        <button onClick={fetchComplaints} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Category Breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {countByCategory.map((cat) => (
          <div key={cat.name} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-lg font-bold">{cat.count}</p>
            <p className="text-xs text-gray-500 capitalize">{cat.name}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input type="text" placeholder="Search complaints..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
        </div>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="all">All Categories</option>
          {CATEGORIES.map((c) => (<option key={c} value={c}>{c.replace(/_/g, " ")}</option>))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {/* Complaints Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Subject</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">User</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Priority</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">No complaints found</td></tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{c.subject || "N/A"}</td>
                    <td className="px-4 py-3 text-gray-600">{c.user_name}</td>
                    <td className="px-4 py-3">
                      <span className="capitalize text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                        {c.category?.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(c.status)}`}>
                        {c.status?.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${
                        c.priority === "urgent" ? "text-red-600" :
                        c.priority === "high" ? "text-orange-600" :
                        "text-gray-500"
                      }`}>{c.priority}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(c.created_at)}</td>
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