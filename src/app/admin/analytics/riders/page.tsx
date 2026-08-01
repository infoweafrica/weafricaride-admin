"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Users, TrendingUp, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function RiderAnalyticsPage() {
  const [topRiders, setTopRiders] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, active: 0, growth: 0 });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [topRes, countRes, activeRes] = await Promise.all([
        supabase.rpc("get_top_riders", { p_limit: 10 }),
        supabase.from("riders").select("id", { count: "exact", head: true }),
        supabase.from("rides").select("rider_id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 86400000).toISOString()),
      ]);

      if (topRes.data) setTopRiders(topRes.data as any[]);
      setStats({
        total: countRes.count || 0,
        active: activeRes.count || 0,
        growth: 0,
      });
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rider Analytics</h1>
          <p className="text-gray-500 mt-1">Most active riders, retention, and growth tracking</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <Users className="h-5 w-5 text-blue-600 mb-2" />
          <p className="text-xs text-gray-500">Total Riders</p>
          <p className="text-2xl font-bold">{stats.total.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <TrendingUp className="h-5 w-5 text-green-600 mb-2" />
          <p className="text-xs text-gray-500">Active Today</p>
          <p className="text-2xl font-bold">{stats.active}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <TrendingUp className="h-5 w-5 text-purple-600 mb-2" />
          <p className="text-xs text-gray-500">Growth Rate</p>
          <p className="text-2xl font-bold">{stats.growth}%</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Most Active Riders</h3>
        {topRiders.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No rider data yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 border-b"><th className="pb-2 font-medium">#</th><th className="pb-2 font-medium">Rider</th><th className="pb-2 font-medium text-right">Trips</th><th className="pb-2 font-medium text-right">Spent</th><th className="pb-2 font-medium">City</th></tr></thead>
              <tbody>
                {topRiders.map((r: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-400 font-bold">{i + 1}</td>
                    <td className="py-2 font-medium">{r.name}</td>
                    <td className="py-2 text-right">{r.trips}</td>
                    <td className="py-2 text-right text-blue-600">{formatCurrency(r.total_spent || 0)}</td>
                    <td className="py-2 text-gray-400">{r.city || "N/A"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}