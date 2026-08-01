"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
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
      // Fetch driver wallets with driver info
      const { data: walletData, error } = await supabase
        .from("driver_wallets")
        .select("*, driver:drivers(id, user:users(full_name, phone))")
        .order("available_balance", { ascending: false })
        .limit(100);

      if (error) throw error;

      // Fetch today's date boundaries
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      // Fetch today's completed rides per driver for earnings
      const { data: todayRides } = await supabase
        .from("rides")
        .select("driver_id, fare_amount, commission_amount, driver_earning")
        .eq("status", "completed")
        .gte("created_at", todayStart);

      const { data: weekRides } = await supabase
        .from("rides")
        .select("driver_id, fare_amount, commission_amount, driver_earning")
        .eq("status", "completed")
        .gte("created_at", weekStart);

      const { data: monthRides } = await supabase
        .from("rides")
        .select("driver_id, fare_amount, commission_amount, driver_earning")
        .eq("status", "completed")
        .gte("created_at", monthStart);

      // Aggregate earnings per driver
      const todayByDriver: Record<string, number> = {};
      const weekByDriver: Record<string, number> = {};
      const monthByDriver: Record<string, number> = {};

      (todayRides || []).forEach((r: any) => {
        todayByDriver[r.driver_id] = (todayByDriver[r.driver_id] || 0) + (r.driver_earning || r.fare_amount || 0);
      });
      (weekRides || []).forEach((r: any) => {
        weekByDriver[r.driver_id] = (weekByDriver[r.driver_id] || 0) + (r.driver_earning || r.fare_amount || 0);
      });
      (monthRides || []).forEach((r: any) => {
        monthByDriver[r.driver_id] = (monthByDriver[r.driver_id] || 0) + (r.driver_earning || r.fare_amount || 0);
      });

      // Count trips per driver this month
      const tripsByDriver: Record<string, number> = {};
      (monthRides || []).forEach((r: any) => {
        tripsByDriver[r.driver_id] = (tripsByDriver[r.driver_id] || 0) + 1;
      });

      if (walletData && walletData.length > 0) {
        const mapped = walletData.map((w: any) => {
          const driverObj = w.driver as Record<string, any> | undefined;
          const userObj = driverObj?.user as Record<string, any> | undefined;
          const driverId = w.driver_id || driverObj?.id;
          return {
            id: w.id,
            driver_id: driverId,
            driver_name: userObj?.full_name || "Unknown Driver",
            driver_phone: userObj?.phone || "",
            today: todayByDriver[driverId] || 0,
            this_week: weekByDriver[driverId] || 0,
            this_month: monthByDriver[driverId] || 0,
            total_trips: tripsByDriver[driverId] || 0,
            available_balance: w.available_balance || 0,
            pending_balance: w.pending_balance || 0,
            commission_owed: w.commission_owed || 0,
          };
        });
        setEarnings(mapped);
        setSummary({
          today: mapped.reduce((s, e) => s + e.today, 0),
          week: mapped.reduce((s, e) => s + e.this_week, 0),
          month: mapped.reduce((s, e) => s + e.this_month, 0),
          pending: mapped.reduce((s, e) => s + e.pending_balance, 0),
        });
      } else {
        // Fallback: get drivers directly
        const { data: driverData } = await supabase
          .from("drivers")
          .select("id, total_earnings, available_balance, pending_balance, user:users(full_name, phone)")
          .limit(100);

        if (driverData) {
          const mapped = driverData.map((d: any) => {
            const userObj = d.user as Record<string, any> | undefined;
            const driverId = d.id;
            return {
              id: driverId,
              driver_id: driverId,
              driver_name: userObj?.full_name || "Unknown Driver",
              driver_phone: userObj?.phone || "",
              today: todayByDriver[driverId] || 0,
              this_week: weekByDriver[driverId] || 0,
              this_month: monthByDriver[driverId] || 0,
              total_trips: tripsByDriver[driverId] || 0,
              available_balance: d.available_balance || 0,
              pending_balance: d.pending_balance || 0,
              commission_owed: Math.round((d.total_earnings || 0) * 0.15),
            };
          });
          setEarnings(mapped);
          setSummary({
            today: mapped.reduce((s, e) => s + e.today, 0),
            week: mapped.reduce((s, e) => s + e.this_week, 0),
            month: mapped.reduce((s, e) => s + e.this_month, 0),
            pending: mapped.reduce((s, e) => s + e.pending_balance, 0),
          });
        }
      }
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