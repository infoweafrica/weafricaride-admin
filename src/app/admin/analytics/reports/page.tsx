"use client";

import { useState, useEffect } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { BarChart3, Users, DollarSign, Download } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

interface AnalyticsSummary {
  totalRides: number;
  totalDrivers: number;
  totalUsers: number;
  totalRevenue: number;
  revenueOverTime: { day: string; revenue: number }[];
  rideVolumeOverTime: { day: string; rides: number }[];
  cityBreakdown: { city: string; count: number }[];
}

const CITY_COLORS = ["#16a34a", "#2563eb", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];

function formatDay(day: string) {
  const d = new Date(day + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ReportsPage() {
  return (
    <PermissionGuard permission="view_analytics">
      <ReportsContent />
    </PermissionGuard>
  );
}

function ReportsContent() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStats() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/analytics/summary");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load analytics");
        setSummary(body as AnalyticsSummary);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load analytics");
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, []);

  const exportCsv = () => {
    if (!summary) return;
    const rows = [
      ["Day", "Revenue", "Rides"],
      ...summary.revenueOverTime.map((r, i) => [r.day, String(r.revenue), String(summary.rideVolumeOverTime[i]?.rides ?? 0)]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "weafrica-analytics.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics & Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Business intelligence and platform performance</p>
        </div>
        <button onClick={exportCsv} disabled={!summary} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50">
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={<BarChart3 className="h-5 w-5 text-blue-600" />} label="Total Rides" value={loading ? "…" : (summary?.totalRides ?? 0).toLocaleString()} />
        <StatCard icon={<Users className="h-5 w-5 text-green-600" />} label="Total Drivers" value={loading ? "…" : (summary?.totalDrivers ?? 0).toLocaleString()} />
        <StatCard icon={<Users className="h-5 w-5 text-purple-600" />} label="Total Users" value={loading ? "…" : (summary?.totalUsers ?? 0).toLocaleString()} />
        <StatCard icon={<DollarSign className="h-5 w-5 text-amber-600" />} label="Revenue" value={loading ? "…" : `MWK ${Math.round(summary?.totalRevenue ?? 0).toLocaleString()}`} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Revenue over time (last 30 days)</h3>
        <div style={{ width: "100%", height: 280 }}>
          {loading ? (
            <ChartSkeleton />
          ) : (
            <ResponsiveContainer>
              <AreaChart data={summary?.revenueOverTime ?? []}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16a34a" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tickFormatter={formatDay} tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip labelFormatter={formatDay} formatter={(v: number) => [`MWK ${v.toLocaleString()}`, "Revenue"]} />
                <Area type="monotone" dataKey="revenue" stroke="#16a34a" fill="url(#revenueGradient)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Ride volume (last 30 days)</h3>
          <div style={{ width: "100%", height: 260 }}>
            {loading ? (
              <ChartSkeleton />
            ) : (
              <ResponsiveContainer>
                <BarChart data={summary?.rideVolumeOverTime ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tickFormatter={formatDay} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip labelFormatter={formatDay} formatter={(v: number) => [v, "Rides"]} />
                  <Bar dataKey="rides" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Rides by city (last 30 days)</h3>
          <div style={{ width: "100%", height: 260 }}>
            {loading ? (
              <ChartSkeleton />
            ) : (summary?.cityBreakdown.length ?? 0) === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">No ride data in this window</div>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <Pie data={summary?.cityBreakdown} dataKey="count" nameKey="city" cx="50%" cy="50%" outerRadius={90} label={(props: any) => `${props.city}: ${props.count}`}>
                    {(summary?.cityBreakdown ?? []).map((entry, i) => (
                      <Cell key={entry.city} fill={CITY_COLORS[i % CITY_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return <div className="h-full w-full bg-gray-50 rounded-lg animate-pulse" />;
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
      <div className="p-2 bg-gray-50 rounded-lg">{icon}</div>
      <div><p className="text-2xl font-bold text-gray-900">{value}</p><p className="text-xs text-gray-500">{label}</p></div>
    </div>
  );
}
