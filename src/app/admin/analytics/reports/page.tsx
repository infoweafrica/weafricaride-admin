"use client";

import { useState, useEffect } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import { BarChart3, TrendingUp, Users, DollarSign, Download } from "lucide-react";

export default function ReportsPage() {
  return (
    <PermissionGuard permission="view_analytics">
      <ReportsContent />
    </PermissionGuard>
  );
}

function ReportsContent() {
  const [stats, setStats] = useState({ totalRides: 0, totalDrivers: 0, totalUsers: 0, revenue: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        const fetchCount = async (table: string) => {
          const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
          return count || 0;
        };
        const [rides, drivers, users] = await Promise.all([
          fetchCount("rides"),
          fetchCount("drivers"),
          fetchCount("users"),
        ]);
        setStats({ totalRides: rides, totalDrivers: drivers, totalUsers: users, revenue: 0 });
      } catch { /* ignore */ } finally { setLoading(false); }
    }
    loadStats();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics & Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Business intelligence and platform performance</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={<BarChart3 className="h-5 w-5 text-blue-600" />} label="Total Rides" value={stats.totalRides.toLocaleString()} />
        <StatCard icon={<Users className="h-5 w-5 text-green-600" />} label="Total Drivers" value={stats.totalDrivers.toLocaleString()} />
        <StatCard icon={<Users className="h-5 w-5 text-purple-600" />} label="Total Users" value={stats.totalUsers.toLocaleString()} />
        <StatCard icon={<DollarSign className="h-5 w-5 text-amber-600" />} label="Revenue" value={`$${stats.revenue.toLocaleString()}`} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 min-h-[300px] flex flex-col items-center justify-center text-gray-400">
        <TrendingUp className="h-16 w-16 mb-4 text-gray-300" />
        <p className="text-lg font-medium text-gray-500">Analytics Dashboard</p>
        <p className="text-sm">Integrate with recharts for full charts — revenue over time, ride volume, city breakdowns</p>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
      <div className="p-2 bg-gray-50 rounded-lg">{icon}</div>
      <div><p className="text-2xl font-bold text-gray-900">{value}</p><p className="text-xs text-gray-500">{label}</p></div>
    </div>
  );
}