"use client";

import { useState, useEffect, useCallback } from "react";
import { DollarSign, TrendingUp, Wallet, RefreshCw, Search, Download } from "lucide-react";
import { formatCurrency, timeAgo } from "@/lib/utils";

type DriverEarning = {
  id: string;
  driver_id: string;
  driver_name: string;
  driver_phone: string;
  today: number;
  this_week: number;
  this_month: number;
  total_trips: number;
  available_balance: number;
  pending_balance: number;
  commission_owed: number;
};

export default function DriverEarningsPage() {
  const [earnings, setEarnings] = useState<DriverEarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [summary, setSummary] = useState({ today: 0, week: 0, month: 0, pending: 0 });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/drivers/earnings");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load earnings");
      setEarnings(body.earnings || []);
      setSummary(body.summary || { today: 0, week: 0, month: 0, pending: 0 });
    } catch (err) {
      console.error("Failed to load earnings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = earnings.filter((e) =>
    e.driver_name.toLowerCase().includes(search.toLowerCase()) ||
    e.driver_phone.includes(search)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Driver Earnings</h1>
          <p className="text-gray-500 mt-1">Real-time earnings breakdown by driver — today, this week, this month</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            <Download className="h-4 w-4" /> Export
          </button>
          <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-5 w-5 text-green-600" />
            <p className="text-xs text-gray-500 font-medium">Today</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{loading ? "..." : formatCurrency(summary.today)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            <p className="text-xs text-gray-500 font-medium">This Week</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{loading ? "..." : formatCurrency(summary.week)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="h-5 w-5 text-purple-600" />
            <p className="text-xs text-gray-500 font-medium">This Month</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{loading ? "..." : formatCurrency(summary.month)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-5 w-5 text-amber-600" />
            <p className="text-xs text-gray-500 font-medium">Pending Settlement</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{loading ? "..." : formatCurrency(summary.pending)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search drivers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      {/* Earnings Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Driver</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Today</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">This Week</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">This Month</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Trips</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Available</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Commission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-400">Loading earnings...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-400">No driver earnings found</td></tr>
              ) : (
                filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{e.driver_name}</p>
                      {e.driver_phone && <p className="text-xs text-gray-500">{e.driver_phone}</p>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-green-600">{formatCurrency(e.today)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-blue-600">{formatCurrency(e.this_week)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-purple-600">{formatCurrency(e.this_month)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{e.total_trips}</td>
                    <td className="px-4 py-3 text-right text-green-700">{formatCurrency(e.available_balance)}</td>
                    <td className="px-4 py-3 text-right text-red-600">{formatCurrency(e.commission_owed)}</td>
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