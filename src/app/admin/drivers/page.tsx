"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { ErrorBoundary, ApiErrorDisplay, EmptyState } from "@/components/ErrorBoundary";
import { useCityContext } from "@/lib/city-context";
import Pagination from "@/components/Pagination";
import { supabase } from "@/lib/supabase";
import {
  Search,
  Eye,
  CheckCircle,
  XCircle,
  X,
  Star,
  Ban,
  Circle,
  Navigation,
  BarChart3,
  Users,
  Shield,
  DollarSign,
  TrendingUp,
  Clock,
  MapPin,
  Phone,
  MessageCircle,
  FileText,
  IdCard,
  Car,
  Camera,
  User,
} from "lucide-react";
import { formatCurrency, timeAgo, getStatusColor, getApprovalStatusLabel } from "@/lib/utils";
import type { Driver } from "@/lib/types";
import {
  fetchDrivers,
  approveDriver,
  rejectDriver,
  suspendDriver,
  forceDriverOffline,
  fetchTotalDriversCount,
  fetchActiveDriversCount,
  fetchPendingApprovalsCount,
  fetchApprovedDriversCount,
  fetchRejectedDriversCount,
  fetchTopDrivers,
  fetchTopDriversByEarnings,
  fetchDriversOnTripCount,
} from "@/lib/api/drivers";
import type { PaginatedResult } from "@/lib/api/base";

// Dynamically import Leaflet map to avoid SSR issues
const LiveMapView = dynamic(() => import("@/app/admin/operations/live-map/LiveMapView"), {
  ssr: false,
  loading: () => (
    <div className="bg-white rounded-xl border h-[400px] flex items-center justify-center text-gray-400">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"></div>
    </div>
  ),
});

interface DriverLocation {
  id: string;
  driver_id: string;
  driver_name: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  is_online: boolean;
  updated_at: string;
}

type DriverTab = "overview" | "all" | "verification" | "earnings" | "live" | "analytics";

export default function DriversPage() {
  return (
    <ErrorBoundary>
      <DriversContent />
    </ErrorBoundary>
  );
}

function DriversContent() {
  const { selectedCityId, selectedCityName } = useCityContext();
  const [activeTab, setActiveTab] = useState<DriverTab>("overview");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Filters
  const [search, setSearch] = useState("");
  const [approvalFilter, setApprovalFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"online" | "offline" | "all">("all");

  // Data
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<Omit<PaginatedResult<Driver[]>, "data">>({
    page: 1, pageSize: 25, totalCount: 0, totalPages: 0, count: 0, error: null,
  });

  // Stats
  const [totalDrivers, setTotalDrivers] = useState(0);
  const [activeDrivers, setActiveDrivers] = useState(0);
  const [driversOnTrip, setDriversOnTrip] = useState(0);
  const [driversOverdueDocs, setDriversOverdueDocs] = useState(0);
  const [avgRating, setAvgRating] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [approvedCount, setApprovedCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [topDrivers, setTopDrivers] = useState<Driver[]>([]);
  const [topEarners, setTopEarners] = useState<Driver[]>([]);

  // Modal
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showSuspend, setShowSuspend] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Detail sub-tab
  const [detailTab, setDetailTab] = useState<"details" | "documents" | "rides" | "wallet">("details");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cityFilter = selectedCityId || undefined;

      // Map filter values for the API
      const approvalStatusProp = approvalFilter === "all" ? "" : approvalFilter;
      const isOnlineProp = statusFilter === "all" ? undefined : statusFilter === "online";

      const [stats, realtimeStats, driversResult] = await Promise.all([
        Promise.all([
          fetchTotalDriversCount(cityFilter),
          fetchActiveDriversCount(cityFilter),
          fetchPendingApprovalsCount(),
          fetchApprovedDriversCount(),
          fetchRejectedDriversCount(),
          fetchTopDrivers(10),
          fetchTopDriversByEarnings(10),
        ]),
        Promise.all([
          fetchDriversOnTripCount(),
        ]),
        activeTab === "all"
          ? fetchDrivers(page, pageSize, {
              cityId: cityFilter,
              search,
              approvalStatus: approvalStatusProp,
              isOnline: isOnlineProp,
            })
          : fetchDrivers(1, 10),
      ]);

      const [total, active, pending, approved, rejected, top, topEarn] = stats;
      const [onTrip] = realtimeStats;
      setTotalDrivers(total);
      setActiveDrivers(active);
      setDriversOnTrip(onTrip);
      setPendingCount(pending);
      setApprovedCount(approved);
      setRejectedCount(rejected);
      setTopDrivers(top);
      setTopEarners(topEarn);

      if (driversResult.error) {
        setError(driversResult.error);
        setDrivers([]);
      } else {
        setDrivers(driversResult.data || []);
        setPagination({
          page: driversResult.page,
          pageSize: driversResult.pageSize,
          totalCount: driversResult.totalCount,
          totalPages: driversResult.totalPages,
          count: driversResult.count,
          error: driversResult.error,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load drivers");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, approvalFilter, statusFilter, activeTab, selectedCityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => { setPage(1); }, [approvalFilter, statusFilter, search]);

  const handleApprove = async (driverId: string) => {
    setActionLoading(driverId);
    if (await approveDriver(driverId)) loadData();
    setActionLoading(null);
  };

  const handleReject = async () => {
    if (!selectedDriver) return;
    setActionLoading(selectedDriver.id);
    if (await rejectDriver(selectedDriver.id, rejectReason)) {
      loadData();
      setShowReject(false);
      setRejectReason("");
    }
    setActionLoading(null);
  };

  const handleSuspend = async () => {
    if (!selectedDriver) return;
    setActionLoading(selectedDriver.id);
    if (await suspendDriver(selectedDriver.id, suspendReason)) {
      loadData();
      setShowSuspend(false);
      setSuspendReason("");
    }
    setActionLoading(null);
  };

  const handleForceOffline = async (driverId: string) => {
    setActionLoading(driverId);
    if (await forceDriverOffline(driverId)) loadData();
    setActionLoading(null);
  };

  // Live map driver locations from driver_locations table (real-time)
  const [liveLocations, setLiveLocations] = useState<DriverLocation[]>([]);

  const tabs: { id: DriverTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "all", label: "All Drivers", icon: Users },
    { id: "verification", label: "Verification", icon: Shield },
    { id: "earnings", label: "Earnings", icon: DollarSign },
    { id: "live", label: "Live Map", icon: Navigation },
    { id: "analytics", label: "Analytics", icon: TrendingUp },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapDriverLocation = (d: any): DriverLocation => ({
    id: d.id,
    driver_id: d.driver_id,
    driver_name: `Driver ${d.driver_id?.slice(0, 8) || "???"}`,
    latitude: d.latitude,
    longitude: d.longitude,
    heading: d.heading,
    speed: d.speed,
    is_online: d.is_online || false,
    updated_at: d.updated_at,
  });

  // Load live locations on mount + subscribe to real-time
  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const { data } = await supabase
          .from("driver_locations")
          .select("id, driver_id, latitude, longitude, heading, speed, is_online, updated_at")
          .eq("is_online", true)
          .order("updated_at", { ascending: false })
          .limit(200);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped = ((data as any[]) || []).map((d: any) => mapDriverLocation(d));
        // Enrich with driver names from existing drivers list
        const nameMap: Record<string, string> = {};
        drivers.forEach((d) => {
          if (d.id && d.user?.full_name) nameMap[d.id] = d.user.full_name;
        });
        setLiveLocations(mapped.map((d: DriverLocation) => ({
          ...d,
          driver_name: nameMap[d.driver_id] || d.driver_name,
        })));
      } catch {
        // silently ignore
      }
    };

    fetchLocations();

    const channel = supabase
      .channel("drivers_page_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_locations" },
        async (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const newRow = (payload.new as any) || {};
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const oldRow = (payload.eventType === "DELETE" ? (payload.old as any) : null);

          if (payload.eventType === "DELETE") {
            setLiveLocations((prev) => prev.filter((d) => d.id !== oldRow?.id));
            return;
          }

          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const mapped = mapDriverLocation(newRow);
            // Try to get driver name from existing drivers list
            const nameMap: Record<string, string> = {};
            setLiveLocations((prev) => {
              // Build name map from current state
              prev.forEach((d) => {
                if (d.driver_name && !d.driver_name.startsWith("Driver ")) {
                  nameMap[d.driver_id] = d.driver_name;
                }
              });
              const enriched = { ...mapped, driver_name: nameMap[mapped.driver_id] || mapped.driver_name };
              const idx = prev.findIndex((d) => d.id === enriched.id);
              if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = enriched;
                return copy;
              }
              return [...prev, enriched];
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also update live locations when drivers change (for name enrichment)
  useEffect(() => {
    if (drivers.length === 0 || liveLocations.length === 0) return;
    const nameMap: Record<string, string> = {};
    drivers.forEach((d) => {
      if (d.id && d.user?.full_name) nameMap[d.id] = d.user.full_name;
    });
    setLiveLocations((prev) =>
      prev.map((loc) => ({
        ...loc,
        driver_name: nameMap[loc.driver_id] || loc.driver_name,
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers]);

  const onlineCount = activeDrivers;

  return (
    <div className="space-y-6">
      <div>
          <h1 className="text-2xl font-bold text-gray-900">Drivers</h1>
          <p className="text-gray-500 mt-1">
            {selectedCityName === "All Cities"
              ? `${totalDrivers.toLocaleString()} registered drivers`
              : `${totalDrivers.toLocaleString()} drivers in ${selectedCityName}`}
          </p>
      </div>

      <ApiErrorDisplay error={error} onRetry={loadData} />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id ? "border-green-600 text-green-600" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon className="h-4 w-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* ===== OVERVIEW TAB ===== */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <StatBox icon={Users} label="Total Drivers" value={totalDrivers} color="text-blue-600" bg="bg-blue-50" />
            <StatBox icon={Circle} label="Online Now" value={onlineCount} color="text-green-600" bg="bg-green-50" dot="bg-green-500" />
            <StatBox icon={Navigation} label="On Trip" value={driversOnTrip} color="text-cyan-600" bg="bg-cyan-50" />
            <StatBox icon={Clock} label="Pending" value={pendingCount} color="text-amber-600" bg="bg-amber-50" />
            <StatBox icon={Ban} label="Rejected" value={rejectedCount} color="text-red-600" bg="bg-red-50" />
            <StatBox icon={DollarSign} label="Approved" value={approvedCount} color="text-emerald-600" bg="bg-emerald-50" />
            <StatBox icon={Star} label="Avg Rating" value={(drivers.length > 0 ? drivers.reduce((s,d)=>s+(d.rating||0),0)/drivers.length : 0).toFixed(1)} color="text-yellow-600" bg="bg-yellow-50" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border p-5">
              <h3 className="text-sm font-semibold mb-3">Approval Status</h3>
              <ProgressBar label="Approved" value={approvedCount} max={totalDrivers} color="bg-green-500" />
              <ProgressBar label="Pending" value={pendingCount} max={totalDrivers} color="bg-amber-500" />
              <ProgressBar label="Rejected" value={rejectedCount} max={totalDrivers} color="bg-red-500" />
            </div>
            <div className="bg-white rounded-xl border p-5">
              <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
              <div className="space-y-2">
                <button onClick={() => setActiveTab("verification")} className="w-full flex items-center gap-2 px-3 py-2 bg-amber-50 hover:bg-amber-100 rounded-lg text-sm text-amber-700">
                  <Shield className="h-4 w-4" /> {pendingCount} pending verification
                </button>
                <button onClick={() => setActiveTab("all")} className="w-full flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm text-blue-700">
                  <Users className="h-4 w-4" /> View all {totalDrivers} drivers
                </button>
              </div>
            </div>
            <div className="bg-white rounded-xl border p-5">
              <h3 className="text-sm font-semibold mb-3">Top Drivers</h3>
              <div className="space-y-2">
                {topDrivers.slice(0, 5).map((d, i) => (
                  <div key={d.id} className="flex items-center justify-between text-xs">
                    <span>{d.user?.full_name || "Unknown"}</span>
                    <span className="text-gray-500">{d.total_rides || 0} rides</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== ALL DRIVERS TAB ===== */}
      {activeTab === "all" && (
        <>
          <div className="bg-white rounded-xl border p-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input type="text" placeholder="Search name, phone, license, plate..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <select value={approvalFilter} onChange={(e) => setApprovalFilter(e.target.value)} className="px-4 py-2 border rounded-lg text-sm bg-white">
                <option value="all">All Approvals</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="documents_missing">Missing Docs</option>
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "online" | "offline" | "all")} className="px-4 py-2 border rounded-lg text-sm bg-white">
                <option value="all">All Status</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-xl border overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div></div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 bg-gray-50 border-b">
                        <th className="px-4 py-3 font-medium">Driver</th>
                        <th className="px-4 py-3 font-medium">Phone</th>
                        <th className="px-4 py-3 font-medium">Vehicle</th>
                        <th className="px-4 py-3 font-medium">Rating</th>
                        <th className="px-4 py-3 font-medium">Earnings</th>
                        <th className="px-4 py-3 font-medium">Online</th>
                        <th className="px-4 py-3 font-medium">Verification</th>
                        <th className="px-4 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drivers.map((driver) => (
                        <tr key={driver.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="relative">
                                <div className="h-9 w-9 bg-purple-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                                  {driver.user?.full_name?.charAt(0) || "D"}
                                </div>
                                <span className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white ${driver.is_online ? "bg-green-500" : "bg-gray-400"}`} />
                              </div>
                              <div>
                                <p className="font-medium text-gray-900">{driver.user?.full_name || "Unknown"}</p>
                                <p className="text-xs text-gray-400">{driver.driver_license_number || "No license"}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">{driver.user?.phone || "N/A"}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {driver.vehicle ? <>{driver.vehicle.plate_number}<br />{driver.vehicle.make} {driver.vehicle.model}</> : "No vehicle"}
                          </td>
                          <td className="px-4 py-3"><div className="flex items-center gap-1"><Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" /><span className="font-medium">{driver.rating?.toFixed(1) || "5.0"}</span></div></td>
                          <td className="px-4 py-3 font-medium text-xs">{formatCurrency(driver.total_earnings || 0)}</td>
                          <td className="px-4 py-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${driver.is_online ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>{driver.is_online ? "Online" : "Offline"}</span></td>
                          <td className="px-4 py-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(driver.approval_status || "pending")}`}>{getApprovalStatusLabel(driver.approval_status || "pending")}</span></td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => { setSelectedDriver(driver); setShowDetail(true); setDetailTab("details"); }} className="p-1.5 hover:bg-gray-100 rounded text-gray-500"><Eye className="h-4 w-4" /></button>
                              {driver.is_online && <button onClick={() => handleForceOffline(driver.id)} className="p-1.5 hover:bg-red-50 rounded text-red-600"><XCircle className="h-4 w-4" /></button>}
                              {driver.approval_status === "pending" && <><button onClick={() => handleApprove(driver.id)} className="p-1.5 hover:bg-green-50 rounded text-green-600"><CheckCircle className="h-4 w-4" /></button><button onClick={() => { setSelectedDriver(driver); setShowReject(true); }} className="p-1.5 hover:bg-red-50 rounded text-red-600"><XCircle className="h-4 w-4" /></button></>}
                              {driver.approval_status === "approved" && <button onClick={() => { setSelectedDriver(driver); setShowSuspend(true); }} className="p-1.5 hover:bg-orange-50 rounded text-orange-600"><Ban className="h-4 w-4" /></button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {drivers.length === 0 && <tr><td colSpan={8} className="px-6 py-12"><EmptyState icon={Users} title="No drivers found" description="Drivers will appear here after registration" /></td></tr>}
                    </tbody>
                  </table>
                </div>
                <Pagination page={pagination.page} totalPages={pagination.totalPages} totalCount={pagination.totalCount} pageSize={pagination.pageSize} onPageChange={setPage} onPageSizeChange={(ps) => { setPageSize(ps); setPage(1); }} />
              </>
            )}
          </div>
        </>
      )}

      {/* ===== VERIFICATION TAB ===== */}
      {activeTab === "verification" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <VerificationCard label="Pending" value={pendingCount} color="bg-amber-50" textColor="text-amber-700" />
            <VerificationCard label="Approved" value={approvedCount} color="bg-green-50" textColor="text-green-700" />
            <VerificationCard label="Rejected" value={rejectedCount} color="bg-red-50" textColor="text-red-700" />
            <VerificationCard label="Expired Docs" value={0} color="bg-gray-50" textColor="text-gray-700" />
          </div>
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500 bg-gray-50 border-b"><th className="px-4 py-3 font-medium">Driver</th><th className="px-4 py-3 font-medium">License</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium text-right">Actions</th></tr></thead>
                <tbody>
                  {drivers.filter(d => d.approval_status === "pending").slice(0, 20).map(driver => (
                    <tr key={driver.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-xs">{driver.user?.full_name}</td>
                      <td className="px-4 py-3 text-xs">{driver.driver_license_number || "—"}</td>
                      <td className="px-4 py-3"><span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Pending Review</span></td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleApprove(driver.id)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">Approve</button>
                          <button onClick={() => { setSelectedDriver(driver); setShowReject(true); }} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Reject</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {drivers.filter(d => d.approval_status === "pending").length === 0 && <tr><td colSpan={4} className="px-6 py-12 text-center text-gray-400">No pending verifications</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===== EARNINGS TAB ===== */}
      {activeTab === "earnings" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500 bg-gray-50 border-b"><th className="px-4 py-3 font-medium">Driver</th><th className="px-4 py-3 font-medium">Available</th><th className="px-4 py-3 font-medium">Pending</th><th className="px-4 py-3 font-medium">Cash</th><th className="px-4 py-3 font-medium">Total</th></tr></thead>
                <tbody>
                  {topEarners.slice(0, 20).map(driver => (
                    <tr key={driver.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-xs">{driver.user?.full_name}</td>
                      <td className="px-4 py-3 text-xs text-green-600">{formatCurrency(driver.available_balance || 0)}</td>
                      <td className="px-4 py-3 text-xs text-amber-600">{formatCurrency(driver.pending_balance || 0)}</td>
                      <td className="px-4 py-3 text-xs">{formatCurrency(driver.cash_collected || 0)}</td>
                      <td className="px-4 py-3 text-xs font-medium">{formatCurrency(driver.total_earnings || 0)}</td>
                    </tr>
                  ))}
                  {topEarners.length === 0 && <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400">No earnings data</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===== LIVE TAB ===== */}
      {activeTab === "live" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-xl border overflow-hidden" style={{ minHeight: "500px" }}>
            <LiveMapView drivers={liveLocations} />
          </div>
          <div className="bg-white rounded-xl border p-4">
            <h3 className="text-sm font-semibold mb-3">Active Drivers ({liveLocations.length})</h3>
            <div className="space-y-2 max-h-[450px] overflow-y-auto">
              {liveLocations.map(loc => (
                <div key={loc.id} className="flex items-center justify-between p-2 border rounded-lg hover:bg-gray-50">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 bg-purple-600 rounded-full flex items-center justify-center text-white text-xs font-medium">
                      {loc.driver_name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-xs font-medium">{loc.driver_name}</p>
                      <p className="text-xs text-gray-400">{loc.speed != null ? `${loc.speed.toFixed(1)} km/h` : "Stationary"}</p>
                    </div>
                  </div>
                </div>
              ))}
              {liveLocations.length === 0 && <p className="text-center text-gray-400 text-sm py-4">No drivers online</p>}
            </div>
          </div>
        </div>
      )}

      {/* ===== ANALYTICS TAB ===== */}
      {activeTab === "analytics" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border p-5">
            <h3 className="text-sm font-semibold mb-3">Top Drivers by Rides</h3>
            <div className="space-y-3">
              {topDrivers.map((d, i) => (
                <div key={d.id} className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span><span className="text-xs font-medium">{d.user?.full_name}</span></div><span className="text-xs text-gray-500">{d.total_rides || 0} rides</span></div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border p-5">
            <h3 className="text-sm font-semibold mb-3">Top Earners</h3>
            <div className="space-y-3">
              {topEarners.map((d, i) => (
                <div key={d.id} className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span><span className="text-xs font-medium">{d.user?.full_name}</span></div><span className="text-xs text-green-600 font-medium">{formatCurrency(d.total_earnings || 0)}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== DRIVER DETAIL MODAL ===== */}
      {showDetail && selectedDriver && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-6 border-b">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="h-12 w-12 bg-purple-600 rounded-full flex items-center justify-center text-white text-lg font-medium">{selectedDriver.user?.full_name?.charAt(0)}</div>
                  <span className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-white ${selectedDriver.is_online ? "bg-green-500" : "bg-gray-400"}`} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">{selectedDriver.user?.full_name}</h2>
                  <p className="text-xs text-gray-500">{selectedDriver.user?.phone} • {selectedDriver.vehicle?.plate_number}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selectedDriver.approval_status === "pending" && <><button onClick={() => handleApprove(selectedDriver.id)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium">Approve</button><button onClick={() => setShowReject(true)} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium">Reject</button></>}
                {selectedDriver.approval_status === "approved" && <><button onClick={() => setShowSuspend(true)} className="px-3 py-1.5 bg-orange-600 text-white rounded-lg text-xs font-medium">Suspend</button><button onClick={() => handleForceOffline(selectedDriver.id)} className="px-3 py-1.5 bg-gray-600 text-white rounded-lg text-xs font-medium">Force Offline</button></>}
                <button onClick={() => setShowDetail(false)} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="flex border-b px-6">
              {(["details","documents","rides","wallet"] as const).map(tab => (
                <button key={tab} onClick={() => setDetailTab(tab)} className={`px-4 py-3 text-sm font-medium border-b-2 capitalize ${detailTab === tab ? "border-green-600 text-green-600" : "border-transparent text-gray-500"}`}>{tab}</button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {detailTab === "details" && (
                <div className="grid grid-cols-3 gap-4">
                  <DetailSection title="Personal Info" items={[["Phone", selectedDriver.user?.phone || "N/A"],["Email", selectedDriver.user?.email || "N/A"],["ID Number", selectedDriver.id_number || "N/A"],["ID Type", selectedDriver.id_type === "national_id" ? "National ID" : "Passport"],["Date of Birth", selectedDriver.date_of_birth || "N/A"],["Address", selectedDriver.address || "N/A"]]} />
                  <DetailSection title="License & Vehicle" items={[["License No", selectedDriver.driver_license_number || "N/A"],["License Expiry", selectedDriver.driver_license_expiry || "N/A"],["Plate", selectedDriver.vehicle?.plate_number || "N/A"],["Vehicle", selectedDriver.vehicle ? `${selectedDriver.vehicle.make} ${selectedDriver.vehicle.model}` : "N/A"],["Type", selectedDriver.vehicle?.vehicle_type || "N/A"],["Color", selectedDriver.vehicle?.color || "N/A"]]} />
                  <DetailSection title="Performance" items={[["Total Rides", String(selectedDriver.total_rides || 0)],["Total Earnings", formatCurrency(selectedDriver.total_earnings || 0)],["Rating", `★ ${selectedDriver.rating?.toFixed(1) || "5.0"}`],["Cash Collected", formatCurrency(selectedDriver.cash_collected || 0)],["Status", selectedDriver.is_online ? "Online" : "Offline"],["Approval", selectedDriver.approval_status || "N/A"]]} />
                </div>
              )}
              {detailTab === "documents" && (
                <div className="space-y-4">
                  {/* Identity Documents */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-2 border-b pb-1">Identity Documents</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <DocCard icon={IdCard} label="ID Document" url={selectedDriver.id_document_url} />
                      <DocCard icon={FileText} label="Driver License" url={selectedDriver.license_document_url} />
                      <DocCard icon={User} label="Profile Photo" url={selectedDriver.profile_picture_url} />
                    </div>
                  </div>
                  {/* Vehicle Documents */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-2 border-b pb-1">Vehicle Documents</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <DocCard icon={Car} label="Vehicle Registration" url={selectedDriver.vehicle_registration_url} />
                      <DocCard icon={Shield} label="Insurance" url={selectedDriver.insurance_document_url} />
                    </div>
                  </div>
                  {/* Vehicle Photos */}
                  {selectedDriver.vehicle_photo_urls && selectedDriver.vehicle_photo_urls.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-2 border-b pb-1">Vehicle Photos</h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedDriver.vehicle_photo_urls.map((url, idx) => (
                          <a key={idx} href={url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 underline">
                            <Camera className="h-3 w-3" /> Photo {idx + 1}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Emergency Contact */}
                  {(selectedDriver.emergency_contact_name || selectedDriver.emergency_contact_phone) && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-2 border-b pb-1">Emergency Contact</h4>
                      <div className="text-xs space-y-1">
                        {selectedDriver.emergency_contact_name && <p><span className="text-gray-500">Name:</span> {selectedDriver.emergency_contact_name}</p>}
                        {selectedDriver.emergency_contact_phone && <p><span className="text-gray-500">Phone:</span> {selectedDriver.emergency_contact_phone}</p>}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {detailTab === "rides" && <div className="text-center py-8 text-gray-400"><MapPin className="h-12 w-12 mx-auto mb-2 opacity-50" /><p>Completed: {selectedDriver.total_rides || 0} rides</p></div>}
              {detailTab === "wallet" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="bg-green-50 rounded-lg p-4 text-center"><p className="text-xs text-gray-500">Available</p><p className="text-xl font-bold text-green-700">{formatCurrency(selectedDriver.available_balance || 0)}</p></div>
                    <div className="bg-yellow-50 rounded-lg p-4 text-center"><p className="text-xs text-gray-500">Pending</p><p className="text-xl font-bold text-yellow-700">{formatCurrency(selectedDriver.pending_balance || 0)}</p></div>
                    <div className="bg-blue-50 rounded-lg p-4 text-center"><p className="text-xs text-gray-500">Cash</p><p className="text-xl font-bold text-blue-700">{formatCurrency(selectedDriver.cash_collected || 0)}</p></div>
                    <div className="bg-purple-50 rounded-lg p-4 text-center"><p className="text-xs text-gray-500">Earned</p><p className="text-xl font-bold text-purple-700">{formatCurrency(selectedDriver.total_earnings || 0)}</p></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showReject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-red-600">Reject Driver</h2>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Rejection reason..." rows={3} className="w-full px-3 py-2 border rounded-lg text-sm" />
            <div className="flex gap-2"><button onClick={() => setShowReject(false)} className="flex-1 px-4 py-2 border rounded-lg text-sm">Cancel</button><button onClick={handleReject} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm">Reject</button></div>
          </div>
        </div>
      )}

      {/* Suspend Modal */}
      {showSuspend && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-orange-600">Suspend Driver</h2>
            <p className="text-sm">Suspend <strong>{selectedDriver?.user?.full_name}</strong>?</p>
            <textarea value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder="Reason..." rows={2} className="w-full px-3 py-2 border rounded-lg text-sm" />
            <div className="flex gap-2"><button onClick={() => setShowSuspend(false)} className="flex-1 px-4 py-2 border rounded-lg text-sm">Cancel</button><button onClick={handleSuspend} className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm">Suspend</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- HELPERS ---

function StatBox({ icon: Icon, label, value, color, bg, dot }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; color: string; bg: string; dot?: string }) {
  return <div className={`${bg} rounded-xl p-4`}><div className="flex items-center gap-2"><Icon className={`h-4 w-4 ${color}`} />{dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}</div><p className="text-xl font-bold mt-2 text-gray-900">{value}</p><p className="text-xs text-gray-500">{label}</p></div>;
}

function ProgressBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return <div className="mb-3"><div className="flex justify-between text-xs mb-1"><span className="text-gray-500">{label}</span><span className="text-gray-700">{value}</span></div><div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} /></div></div>;
}

function VerificationCard({ label, value, color, textColor }: { label: string; value: number; color: string; textColor: string }) {
  return <div className={`${color} rounded-xl p-4`}><p className={`text-xl font-bold ${textColor}`}>{value}</p><p className="text-xs text-gray-600">{label}</p></div>;
}

function DetailSection({ title, items }: { title: string; items: [string, string][] }) {
  return <div className="bg-gray-50 rounded-lg p-4"><h4 className="text-xs font-semibold text-gray-900 mb-2">{title}</h4><div className="space-y-1.5">{items.map(([label, value], i) => <div key={i} className="flex justify-between text-xs"><span className="text-gray-500">{label}</span><span className="font-medium truncate ml-2 max-w-[140px]">{value}</span></div>)}</div></div>;
}

function DocCard({ icon: Icon, label, url }: { icon: React.ComponentType<{ className?: string }>; label: string; url: string | null | undefined }) {
  if (!url) {
    return (
      <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-2 border border-gray-100">
        <Icon className="h-4 w-4 text-gray-300" />
        <div>
          <p className="text-xs font-medium text-gray-400">{label}</p>
          <p className="text-xs text-gray-300">Not uploaded</p>
        </div>
      </div>
    );
  }
  const isImage = /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(url);
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="bg-blue-50 rounded-lg p-3 flex items-center gap-2 border border-blue-100 hover:bg-blue-100 transition-colors">
      <Icon className="h-4 w-4 text-blue-600" />
      <div>
        <p className="text-xs font-medium text-blue-700">{label}</p>
        <p className="text-xs text-blue-500 underline">{isImage ? "View Image" : "Open Document"}</p>
      </div>
    </a>
  );
}
