"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { RefreshCw, Users, Car, Wifi, WifiOff, Clock } from "lucide-react";
import Link from "next/link";

type DriverStatus = {
  id: string;
  name: string;
  phone: string;
  status: string;
  last_seen: string;
  city: string;
  vehicle_type: string;
  vehicle_label: string;
  plate: string;
  current_ride_id?: string | null;
  online_duration: string;
};

type FleetStats = {
  online: number;
  offline: number;
  busy: number;
  idle: number;
  total: number;
};

export default function FleetMonitoringPage() {
  const [drivers, setDrivers] = useState<DriverStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<FleetStats>({ online: 0, offline: 0, busy: 0, idle: 0, total: 0 });
  const [filter, setFilter] = useState("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: driverData, error } = await supabase
        .from("drivers")
        .select("id, status, is_online, city, vehicle_id, user:users(full_name, phone)")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) {
        console.error("drivers query error", JSON.stringify(error, null, 2));
        throw error;
      }

      const driverIds = (driverData || []).map((d: any) => d.id).filter(Boolean);

      const vehicleIds = [...new Set((driverData || []).map((d: any) => d.vehicle_id).filter(Boolean))];
      const { data: vehicleData } = vehicleIds.length
        ? await supabase
            .from("vehicles")
            .select("id, plate_number, make, model, vehicle_type")
            .in("id", vehicleIds)
        : { data: [] as any[] };

      const vehicleMap: Record<string, any> = {};
      (vehicleData as any[] || []).forEach((v: any) => {
        vehicleMap[v.id] = v;
      });


      const { data: locData, error: locError } = driverIds.length
        ? await supabase
            .from("driver_locations")
            .select("driver_id, is_online, updated_at, latitude, longitude")
            .in("driver_id", driverIds)
        : { data: [] as any[], error: null };

      if (locError) {
        console.error("driver_locations query error", JSON.stringify(locError, null, 2));
        throw locError;
      }

      const locationMap: Record<string, any> = {};
      (locData as any[] || []).forEach((loc: any) => {
        locationMap[loc.driver_id] = loc;
      });

      const activeStatuses = ["accepted", "driver_arriving", "driver_arrived", "arrived", "in_progress"];
      const { data: activeRideData, error: activeRideError } = driverIds.length
        ? await supabase
            .from("rides")
            .select("id, driver_id, status")
            .in("driver_id", driverIds)
            .in("status", activeStatuses)
        : { data: [] as any[], error: null };

      if (activeRideError) {
        console.error("active rides query error", JSON.stringify(activeRideError, null, 2));
        throw activeRideError;
      }

      const activeRideMap: Record<string, any> = {};
      (activeRideData as any[] || []).forEach((ride: any) => {
        if (ride.driver_id) activeRideMap[ride.driver_id] = ride;
      });

      const now = new Date();
      let onlineCount = 0;
      let offlineCount = 0;
      let busyCount = 0;
      let idleCount = 0;

      const mapped = (driverData || []).map((d: any) => {
        const loc = locationMap[d.id];
        const liveOnline = loc?.is_online === true;
        const profileOnline = d.is_online === true;
        const activeRide = activeRideMap[d.id];
        const lastSeenValue = loc?.updated_at || "";
        const lastSeen = lastSeenValue ? new Date(lastSeenValue) : null;
        const minutesAgo = lastSeen ? Math.floor((now.getTime() - lastSeen.getTime()) / 60000) : 999999;

        let driverStatus = "offline";
        if (activeRide) {
          driverStatus = "busy";
          busyCount++;
        } else if (liveOnline || profileOnline) {
          driverStatus = "idle";
          idleCount++;
          onlineCount++;
        } else {
          offlineCount++;
        }

        const vehicle = vehicleMap[d.vehicle_id];
        const vehicleLabel = [vehicle?.make, vehicle?.model].filter(Boolean).join(" ");

        return {
          id: d.id,
          name: d.user?.full_name || d.id?.slice(0, 8) || "Unknown",
          phone: d.user?.phone || "",
          status: driverStatus,
          last_seen: lastSeenValue,
          city: d.city || "—",
          vehicle_type: vehicle?.vehicle_type || d.status || "Standard",
          vehicle_label: vehicleLabel || "No vehicle",
          plate: vehicle?.plate_number || "",
          current_ride_id: activeRide?.id || null,
          online_duration: minutesAgo < 60 ? `${minutesAgo}m ago` : minutesAgo < 999999 ? `${Math.floor(minutesAgo / 60)}h ago` : "Never",
        };
      });

      setDrivers(mapped);
      setStats({
        online: onlineCount,
        offline: offlineCount,
        busy: busyCount,
        idle: idleCount,
        total: mapped.length,
      });
    } catch (err) {
      console.error("Failed to load fleet data:", JSON.stringify(err, null, 2), err);
      setDrivers([]);
      setStats({ online: 0, offline: 0, busy: 0, idle: 0, total: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const interval = setInterval(fetchData, 30000); // Auto-refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  const filtered = filter === "all" ? drivers : drivers.filter(d => d.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fleet Monitoring</h1>
          <p className="text-gray-500 mt-1">Real-time driver availability and fleet health</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/operations/live-map" className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
            Open Live Map
          </Link>
          <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-5 w-5 text-gray-600" />
            <p className="text-xs text-gray-500 font-medium">Total Drivers</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{loading ? "..." : stats.total}</p>
        </div>
        <div className="bg-white rounded-xl border border-green-200 p-5 bg-green-50">
          <div className="flex items-center gap-2 mb-2">
            <Wifi className="h-5 w-5 text-green-600" />
            <p className="text-xs text-green-600 font-medium">Online</p>
          </div>
          <p className="text-2xl font-bold text-green-700">{loading ? "..." : stats.online}</p>
        </div>
        <div className="bg-white rounded-xl border border-blue-200 p-5 bg-blue-50">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-5 w-5 text-blue-600" />
            <p className="text-xs text-blue-600 font-medium">Idle</p>
          </div>
          <p className="text-2xl font-bold text-blue-700">{loading ? "..." : stats.idle}</p>
        </div>
        <div className="bg-white rounded-xl border border-purple-200 p-5 bg-purple-50">
          <div className="flex items-center gap-2 mb-2">
            <Car className="h-5 w-5 text-purple-600" />
            <p className="text-xs text-purple-600 font-medium">Busy (On Trip)</p>
          </div>
          <p className="text-2xl font-bold text-purple-700">{loading ? "..." : stats.busy}</p>
        </div>
        <div className="bg-white rounded-xl border border-red-200 p-5 bg-red-50">
          <div className="flex items-center gap-2 mb-2">
            <WifiOff className="h-5 w-5 text-red-600" />
            <p className="text-xs text-red-600 font-medium">Offline</p>
          </div>
          <p className="text-2xl font-bold text-red-700">{loading ? "..." : stats.offline}</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        {["all", "online", "idle", "busy", "offline"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === f
                ? "bg-green-600 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === "online" && ` (${stats.online})`}
            {f === "idle" && ` (${stats.idle})`}
            {f === "busy" && ` (${stats.busy})`}
            {f === "offline" && ` (${stats.offline})`}
          </button>
        ))}
      </div>

      {/* Driver List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Driver</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">City</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Vehicle</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Last Seen</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Loading fleet data...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">No drivers found</td></tr>
              ) : (
                filtered.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{d.name}</p>
                      {d.phone && <p className="text-xs text-gray-500">{d.phone}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        d.status === "online" ? "bg-green-100 text-green-700" :
                        d.status === "idle" ? "bg-blue-100 text-blue-700" :
                        d.status === "busy" ? "bg-purple-100 text-purple-700" :
                        "bg-red-100 text-red-700"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          d.status === "online" ? "bg-green-500" :
                          d.status === "idle" ? "bg-blue-500" :
                          d.status === "busy" ? "bg-purple-500" :
                          "bg-red-500"
                        }`} />
                        {d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{d.city}</td>
                    <td className="px-4 py-3 text-gray-700"><div>{d.plate || "No plate"}</div><div className="text-xs text-gray-500">{d.vehicle_label}</div><div className="text-xs text-gray-400">{d.vehicle_type}</div></td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{d.online_duration}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/admin/drivers/${d.id}`} className="text-green-600 hover:text-green-700 text-xs font-medium">
                        View
                      </Link>
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