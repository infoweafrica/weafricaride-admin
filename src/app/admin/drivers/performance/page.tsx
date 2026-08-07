"use client";

import { useState, useEffect, useCallback } from "react";
import { Star, TrendingUp, XCircle, CheckCircle, Shield, Search, RefreshCw } from "lucide-react";
import Link from "next/link";

type DriverPerformance = {
  id: string;
  driver_name: string;
  driver_phone: string;
  total_trips: number;
  acceptance_rate: number;
  cancellation_rate: number;
  completion_rate: number;
  average_rating: number;
  safety_score: number;
  complaints: number;
};

export default function DriverPerformancePage() {
  const [drivers, setDrivers] = useState<DriverPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/drivers/performance");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load driver performance");
      setDrivers(body.drivers || []);
    } catch (err) {
      console.error("Failed to load driver performance:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = drivers.filter((d) =>
    d.driver_name.toLowerCase().includes(search.toLowerCase())
  );

  const avgAcceptance = drivers.length > 0 ? Math.round(drivers.reduce((s, d) => s + d.acceptance_rate, 0) / drivers.length) : 0;
  const avgCancellation = drivers.length > 0 ? Math.round(drivers.reduce((s, d) => s + d.cancellation_rate, 0) / drivers.length) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Driver Performance</h1>
          <p className="text-gray-500 mt-1">Acceptance, cancellation, completion, and safety metrics from live data</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <TrendingUp className="h-5 w-5 text-green-600 mb-2" />
          <p className="text-xs text-gray-500">Avg Acceptance Rate</p>
          <p className="text-2xl font-bold">{avgAcceptance}%</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <XCircle className="h-5 w-5 text-red-600 mb-2" />
          <p className="text-xs text-gray-500">Avg Cancellation Rate</p>
          <p className="text-2xl font-bold">{avgCancellation}%</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <Star className="h-5 w-5 text-yellow-600 mb-2" />
          <p className="text-xs text-gray-500">Avg Rating</p>
          <p className="text-2xl font-bold">{drivers.length > 0 ? (drivers.reduce((s, d) => s + d.average_rating, 0) / drivers.length).toFixed(2) : "—"}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <Shield className="h-5 w-5 text-blue-600 mb-2" />
          <p className="text-xs text-gray-500">Total Drivers</p>
          <p className="text-2xl font-bold">{drivers.length}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input type="text" placeholder="Search drivers..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Driver</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Trips</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Acceptance</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Cancellation</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Completion</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Rating</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Safety</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-gray-400">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-gray-400">No driver data available</td></tr>
              ) : (
                filtered.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{d.driver_name}</p>
                      {d.driver_phone && <p className="text-xs text-gray-500">{d.driver_phone}</p>}
                    </td>
                    <td className="px-4 py-3 text-right">{d.total_trips}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-medium ${d.acceptance_rate >= 80 ? "text-green-600" : d.acceptance_rate >= 60 ? "text-amber-600" : "text-red-600"}`}>
                        {d.acceptance_rate}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-medium ${d.cancellation_rate <= 5 ? "text-green-600" : d.cancellation_rate <= 15 ? "text-amber-600" : "text-red-600"}`}>
                        {d.cancellation_rate}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-medium ${d.completion_rate >= 90 ? "text-green-600" : d.completion_rate >= 75 ? "text-amber-600" : "text-red-600"}`}>
                        {d.completion_rate}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="flex items-center justify-end gap-1">
                        <Star className="h-3 w-3 text-yellow-500" /> {d.average_rating.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-medium ${d.safety_score >= 80 ? "text-green-600" : d.safety_score >= 60 ? "text-amber-600" : "text-red-600"}`}>
                        {d.safety_score}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/admin/drivers/${d.id}`} className="text-xs text-green-600 font-medium hover:text-green-700">View</Link>
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