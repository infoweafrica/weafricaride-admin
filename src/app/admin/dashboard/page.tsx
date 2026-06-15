"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import StatCard from "@/components/StatCard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useCityContext } from "@/lib/city-context";
import {
  Users,
  Car,
  Clock,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ClipboardList,
  RefreshCw,
} from "lucide-react";
import {
  formatCurrency,
  formatNumber,
  getStatusColor,
  getRideStatusLabel,
  timeAgo,
} from "@/lib/utils";
import type { Ride } from "@/lib/types";
import {
  fetchActiveRidesCount,
  fetchCompletedRidesCount,
  fetchCancelledRidesCount,
  fetchRevenueTotal,
  fetchWeeklyRevenue,
  fetchWeeklyRides,
  fetchRideStatusCounts,
  fetchRides,
} from "@/lib/api/rides";
import {
  fetchTotalDriversCount,
  fetchActiveDriversCount,
  fetchPendingApprovalsCount,
  fetchTotalDriverPayouts,
} from "@/lib/api/drivers";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = ["#22c55e", "#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6"];

export default function DashboardPage() {
  return (
    <ErrorBoundary>
      <DashboardContent />
    </ErrorBoundary>
  );
}

function DashboardContent() {
  const { selectedCityId, selectedCityName } = useCityContext();

  // Stats
  const [totalRiders, setTotalRiders] = useState(0);
  const [totalDrivers, setTotalDrivers] = useState(0);
  const [activeDrivers, setActiveDrivers] = useState(0);
  const [activeRides, setActiveRides] = useState(0);
  const [completedRides, setCompletedRides] = useState(0);
  const [cancelledRides, setCancelledRides] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [driverPayouts, setDriverPayouts] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  // Chart data
  const [weeklyRevenueData, setWeeklyRevenueData] = useState<
    { name: string; revenue: number }[]
  >([]);
  const [weeklyRidesData, setWeeklyRidesData] = useState<
    { name: string; completed: number; cancelled: number }[]
  >([]);
  const [rideStatusData, setRideStatusData] = useState<
    { name: string; value: number }[]
  >([]);

  // Recent rides
  const [recentRides, setRecentRides] = useState<Ride[]>([]);

  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const cityFilter = selectedCityId || undefined;
      const [
        activeRidesCount,
        completedRidesCount,
        cancelledRidesCount,
        revenue,
        totalDriversCount,
        activeDriversCount,
        pendingCount,
        payouts,
        weeklyRev,
        weeklyRides,
        statusCounts,
        recent,
      ] = await Promise.all([
        fetchActiveRidesCount(cityFilter),
        fetchCompletedRidesCount(cityFilter),
        fetchCancelledRidesCount(cityFilter),
        fetchRevenueTotal(),
        fetchTotalDriversCount(cityFilter),
        fetchActiveDriversCount(cityFilter),
        fetchPendingApprovalsCount(),
        fetchTotalDriverPayouts(),
        fetchWeeklyRevenue(cityFilter),
        fetchWeeklyRides(cityFilter),
        fetchRideStatusCounts(cityFilter),
        fetchRides(1, 10, { cityId: cityFilter }),
      ]);

      // Set stats from real data
      setActiveRides(activeRidesCount);
      setCompletedRides(completedRidesCount);
      setCancelledRides(cancelledRidesCount);
      setTotalRevenue(revenue);
      setTotalDrivers(totalDriversCount);
      setActiveDrivers(activeDriversCount);
      setPendingApprovals(pendingCount);
      setDriverPayouts(payouts);

      // For total riders, we don't have a dedicated API yet — use count from riders table
      // But we don't have a riders API yet. We'll fetch inline for now.
      // This will be updated when we build the riders API module.

      // Chart data
      setWeeklyRevenueData(weeklyRev);
      setWeeklyRidesData(weeklyRides);

      // Ride status pie chart
      const statusLabels: Record<string, string> = {
        completed: "Completed",
        cancelled: "Cancelled",
        in_progress: "In Progress",
        searching: "Searching",
        scheduled: "Scheduled",
        requested: "Requested",
        accepted: "Accepted",
        driver_arriving: "Arriving",
        driver_arrived: "Arrived",
        no_driver_found: "No Driver Found",
        no_drivers: "No Driver Found",
      };
      const pieData = Object.entries(statusCounts)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => ({ name: statusLabels[k] || k, value: v }));
      setRideStatusData(pieData);

      // Recent rides
      if (recent.data) {
        setRecentRides(recent.data);
      }
    } catch (err) {
      console.error("[Dashboard] Error loading data:", err);
      setLoadError(
        err instanceof Error ? err.message : "Failed to load dashboard data"
      );
    } finally {
      setIsLoading(false);
    }
  }, [selectedCityId]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Also fetch riders count directly (we'll move this to API module later)
  useEffect(() => {
    let cancelled = false;
    const fetchRiders = async () => {
      try {
        const { supabase } = await import("@/lib/supabase");
        const { count } = await supabase
          .from("riders")
          .select("*", { count: "exact", head: true });
        if (!cancelled) setTotalRiders(count || 0);
      } catch {
        // Silently ignore — riders count is non-critical
      }
    };
    fetchRiders();
    return () => {
      cancelled = true;
    };
  }, []);

  // Realtime auto-refresh — subscribe to changes on key tables
  useEffect(() => {
    let cancelled = false;

    const dashboardChannel = supabase
      .channel("dashboard_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rides" },
        () => {
          if (!cancelled) fetchDashboardData();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "drivers" },
        () => {
          if (!cancelled) fetchDashboardData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_locations" },
        () => {
          if (!cancelled) fetchDashboardData();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(dashboardChannel);
    };
  }, [fetchDashboardData]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 mt-1">Loading your data...</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse"
            >
              <div className="h-4 bg-gray-200 rounded w-20 mb-3" />
              <div className="h-8 bg-gray-200 rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 mt-1">
            {selectedCityName === "All Cities"
              ? "Real-time platform overview — all data from live database"
              : `Showing data for ${selectedCityName}`}
          </p>
        </div>
        <button
          onClick={fetchDashboardData}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Error banner */}
      {loadError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Failed to load some dashboard data: {loadError}. Showing available data.
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        <StatCard
          title="Total Riders"
          value={formatNumber(totalRiders)}
          icon={Users}
          trend={{ value: 0, isPositive: true }}
          iconClassName="bg-blue-50"
        />
        <StatCard
          title="Total Drivers"
          value={formatNumber(totalDrivers)}
          subtitle={`${activeDrivers} active now`}
          icon={Car}
          iconClassName="bg-purple-50"
        />
        <StatCard
          title="Active Rides"
          value={activeRides}
          subtitle="Currently in progress"
          icon={Clock}
          iconClassName="bg-cyan-50"
        />
        <StatCard
          title="Total Revenue"
          value={formatCurrency(totalRevenue)}
          subtitle={`${formatNumber(completedRides)} completed rides`}
          icon={DollarSign}
          iconClassName="bg-yellow-50"
        />
        <StatCard
          title="Pending Approvals"
          value={pendingApprovals}
          subtitle="New driver applications"
          icon={ClipboardList}
          iconClassName="bg-orange-50"
        />
      </div>

      {/* Second Row Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Completed Rides"
          value={formatNumber(completedRides)}
          icon={CheckCircle}
          iconClassName="bg-green-50"
        />
        <StatCard
          title="Cancelled Rides"
          value={formatNumber(cancelledRides)}
          icon={XCircle}
          iconClassName="bg-red-50"
        />
        <StatCard
          title="Driver Payouts"
          value={formatCurrency(driverPayouts)}
          icon={TrendingUp}
          iconClassName="bg-indigo-50"
        />
        <StatCard
          title="Open Complaints"
          value={"—"}
          icon={AlertTriangle}
          iconClassName="bg-red-50"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Weekly Revenue
          </h3>
          {weeklyRevenueData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={weeklyRevenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} />
                <YAxis
                  stroke="#9ca3af"
                  fontSize={12}
                  tickFormatter={(v) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                />
                <Tooltip
                  formatter={(value) => [
                    formatCurrency(Number(value) || 0),
                    "Revenue",
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={{ fill: "#22c55e", r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm">
              No revenue data available yet
            </div>
          )}
        </div>

        {/* Rides Chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Weekly Rides
          </h3>
          {weeklyRidesData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={weeklyRidesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} />
                <Tooltip />
                <Bar
                  dataKey="completed"
                  fill="#22c55e"
                  radius={[4, 4, 0, 0]}
                  name="Completed"
                />
                <Bar
                  dataKey="cancelled"
                  fill="#ef4444"
                  radius={[4, 4, 0, 0]}
                  name="Cancelled"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm">
              No ride data available yet
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Ride Status Distribution */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Ride Status
          </h3>
          {rideStatusData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={rideStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {rideStatusData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 mt-2 justify-center">
                {rideStatusData.map((item, index) => (
                  <div key={item.name} className="flex items-center gap-1">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    />
                    <span className="text-xs text-gray-600">{item.name}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-gray-400 text-sm">
              No ride data yet
            </div>
          )}
        </div>

        {/* Recent Rides */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Recent Rides
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="pb-3 font-medium">Rider</th>
                  <th className="pb-3 font-medium">Driver</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Category</th>
                  <th className="pb-3 font-medium text-right">Fare</th>
                  <th className="pb-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentRides.length > 0 ? (
                  recentRides.map((ride) => {
                    const riderName =
                      (ride.rider as unknown as { user?: { full_name?: string } })
                        ?.user?.full_name || "N/A";
                    const driverName =
                      (ride.driver as unknown as { user?: { full_name?: string } })
                        ?.user?.full_name || "Unassigned";
                    const categoryName =
                      (ride.category as unknown as { name?: string })?.name ||
                      "N/A";
                    return (
                      <tr
                        key={ride.id}
                        className="border-b border-gray-50 hover:bg-gray-50"
                      >
                        <td className="py-3">{riderName}</td>
                        <td className="py-3 text-gray-500">{driverName}</td>
                        <td className="py-3">
                          <span
                            className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                              ride.status
                            )}`}
                          >
                            {getRideStatusLabel(ride.status)}
                          </span>
                        </td>
                        <td className="py-3 text-gray-500">{categoryName}</td>
                        <td className="py-3 text-right font-medium">
                          {formatCurrency(
                            ride.actual_fare || ride.estimated_fare || 0
                          )}
                        </td>
                        <td className="py-3 text-gray-500">
                          {timeAgo(ride.created_at)}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-8 text-center text-gray-400"
                    >
                      No rides recorded yet — data will appear as rides happen
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}