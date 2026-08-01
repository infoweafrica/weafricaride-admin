"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { DollarSign, TrendingUp, Calendar, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function RevenueAnalyticsPage() {
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const [data, setData] = useState<{ label: string; revenue: number; commission: number; driver_earnings: number }[]>([]);
  const [summary, setSummary] = useState({ total: 0, commission: 0, driver_earnings: 0, avg_per_ride: 0 });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: revenueData } = await supabase.rpc("get_revenue_timeline", { p_period: period });
      if (revenueData) {
        const mapped = (revenueData as any[]).map((r: any) => ({
          label: r.period_label,
          revenue: r.gross || 0,
          commission: r.commission || 0,
          driver_earnings: r.driver_earnings || 0,
        }));
        setData(mapped);
        setSummary({
          total: mapped.reduce((s: number, r: any) => s + r.revenue, 0),
          commission: mapped.reduce((s: number, r: any) => s + r.commission, 0),
          driver_earnings: mapped.reduce((s: number, r: any) => s + r.driver_earnings, 0),
          avg_per_ride: mapped.length > 0 ? mapped.reduce((s: number, r: any) => s + r.revenue, 0) / mapped.length : 0,
        });
      }
    } catch (err) {
      console.error("Revenue fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Revenue Analytics</h1>
          <p className="text-gray-500 mt-1">Track daily, weekly, and monthly revenue performance</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <DollarSign className="h-5 w-5 text-green-600 mb-2" />
          <p className="text-xs text-gray-500">Total Revenue</p>
          <p className="text-2xl font-bold">{formatCurrency(summary.total)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <TrendingUp className="h-5 w-5 text-blue-600 mb-2" />
          <p className="text-xs text-gray-500">Commission Earned</p>
          <p className="text-2xl font-bold">{formatCurrency(summary.commission)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <DollarSign className="h-5 w-5 text-amber-600 mb-2" />
          <p className="text-xs text-gray-500">Driver Earnings</p>
          <p className="text-2xl font-bold">{formatCurrency(summary.driver_earnings)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <Calendar className="h-5 w-5 text-purple-600 mb-2" />
          <p className="text-xs text-gray-500">Avg Per Period</p>
          <p className="text-2xl font-bold">{formatCurrency(summary.avg_per_ride)}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Revenue Trend ({period})</h3>
        {data.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm">No revenue data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
              <YAxis stroke="#9ca3af" fontSize={11} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
              <Tooltip formatter={(v) => [formatCurrency(Number(v) || 0)]} />
              <Line type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} name="Revenue" dot={false} />
              <Line type="monotone" dataKey="commission" stroke="#f59e0b" strokeWidth={2} name="Commission" dot={false} />
              <Line type="monotone" dataKey="driver_earnings" stroke="#3b82f6" strokeWidth={2} name="Driver Earnings" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}