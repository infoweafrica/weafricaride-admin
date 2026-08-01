"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Car, Star, TrendingUp, XCircle, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function DriverAnalyticsPage() {
  const [topDrivers, setTopDrivers] = useState<any[]>([]);
  const [topCancellers, setTopCancellers] = useState<any[]>([]);
  const [highestEarners, setHighestEarners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [topRes, cancelRes, earnRes] = await Promise.all([
        supabase.rpc("get_top_driver_performance", { p_limit: 10 }),
        supabase.from("rides").select("driver_id, count", { count: "exact" }).eq("status", "cancelled").limit(10),
        supabase.from("drivers").select("id, total_earnings, user:users(full_name)").order("total_earnings", { ascending: false }).limit(10),
      ]);

      if (topRes.data) setTopDrivers(topRes.data as any[]);
      if (earnRes.data) setHighestEarners(earnRes.data as any[]);
      if (cancelRes.data) setTopCancellers(cancelRes.data as any[]);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Driver Analytics</h1>
          <p className="text-gray-500 mt-1">Top performers, cancellation rates, and earnings insights</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Drivers */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Star className="h-5 w-5 text-yellow-500" />
            <h3 className="font-semibold text-gray-900">Top Rated Drivers</h3>
          </div>
          {topDrivers.length === 0 ? (
            <p className="text-sm text-gray-400">No data yet</p>
          ) : (
            <div className="space-y-3">
              {topDrivers.map((d: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 font-bold w-5">{i + 1}</span>
                    <span className="font-medium">{d.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span>⭐ {d.rating}</span>
                    <span className="text-gray-500">{d.trips} trips</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Most Cancellations */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <XCircle className="h-5 w-5 text-red-500" />
            <h3 className="font-semibold text-gray-900">Most Cancellations</h3>
          </div>
          <p className="text-sm text-gray-400 italic">Requires driver-level cancellation tracking</p>
        </div>

        {/* Highest Earners */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-5 w-5 text-green-600" />
            <h3 className="font-semibold text-gray-900">Highest Earners</h3>
          </div>
          {highestEarners.length === 0 ? (
            <p className="text-sm text-gray-400">No data yet</p>
          ) : (
            <div className="space-y-3">
              {highestEarners.map((d: any, i: number) => {
                const userObj = d.user as Record<string, any> | undefined;
                return (
                  <div key={i} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 font-bold w-5">{i + 1}</span>
                      <span className="font-medium">{userObj?.full_name || "N/A"}</span>
                    </div>
                    <span className="text-green-600 font-medium">{formatCurrency(d.total_earnings || 0)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}