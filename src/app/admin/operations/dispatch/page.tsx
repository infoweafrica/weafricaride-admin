      "use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { useCityContext } from "@/lib/city-context";
import { supabase } from "@/lib/supabase";
import {
  RefreshCw, Send, Clock, AlertTriangle, CheckCircle, XCircle,
  MapPin, Navigation, Users, ArrowRight, Search, Phone,
  User, Zap, Shield, Ban, Eye, History,
} from "lucide-react";
import { formatCurrency, timeAgo } from "@/lib/utils";

// ── Live Map (lazy, SSR-off) ────────────────────────────────

interface DriverLoc {
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

interface RideOnMap {
  id: string;
  status: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  pickup_addr: string;
  dropoff_addr: string;
  driver_id?: string;
  driver_name?: string;
  rider_name?: string;
  fare?: number;
}

const LiveMapView = dynamic(() => import("@/app/admin/operations/live-map/LiveMapView"), {
  ssr: false,
  loading: () => (
    <div className="bg-gray-100 rounded-[20px] h-[480px] flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
    </div>
  ),
});

// ── Types ───────────────────────────────────────────────────

interface RideCard {
  id: string;
  rider_name: string;
  rider_phone?: string;
  pickup_address: string;
  pickup_lat?: number;
  pickup_lng?: number;
  dropoff_address: string;
  dropoff_lat?: number;
  dropoff_lng?: number;
  estimated_fare: number;
  vehicle_type?: string;
  status: string;
  wait_seconds: number;
  driver_name?: string;
  driver_id?: string;
  created_at: string;
}

interface ActivityItem {
  id: string;
  ride_id: string;
  type: "created" | "assigned" | "completed" | "cancelled";
  actor_name: string;
  detail: string;
  created_at: string;
}

// ── Page ────────────────────────────────────────────────────

export default function DispatchQueuePage() {
  return (
    <PermissionGuard permission="dispatch_rides">
      <DispatchDashboard />
    </PermissionGuard>
  );
}

function DispatchDashboard() {
  const { selectedCityId } = useCityContext();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rides, setRides] = useState<RideCard[]>([]);
  const [drivers, setDrivers] = useState<DriverLoc[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [mapRides, setMapRides] = useState<RideOnMap[]>([]);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // ── Fetch all data ──────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const cityFilter = selectedCityId || undefined;

      // 1. Fetch active rides
      let rideQ = supabase
        .from("rides")
        .select(`
          id, status, pickup_address, dropoff_address,
          pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
          estimated_fare, vehicle_type, created_at,
          driver_id, driver:drivers(user:users(full_name, phone)),
          rider:riders(user:users(full_name, phone))
        `)
        .in("status", ["pending", "requested", "searching", "assigned", "accepted", "driver_arriving", "driver_arrived", "arrived", "in_progress", "no_driver_found", "no_drivers"])
        .order("created_at", { ascending: true })
        .limit(50);

      if (cityFilter) rideQ = rideQ.eq("city_id", cityFilter);
      const { data: rideData } = await rideQ;

      const cards: RideCard[] = (rideData as any[] || []).map((r: any) => {
        const riderName = r.rider?.user?.full_name || "Unknown Rider";
        const riderPhone = r.rider?.user?.phone || undefined;
        const driverName = r.driver?.user?.full_name || undefined;
        const waitSec = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 1000);
        return {
          id: r.id,
          rider_name: riderName,
          rider_phone: riderPhone,
          pickup_address: r.pickup_address || "—",
          pickup_lat: r.pickup_lat,
          pickup_lng: r.pickup_lng,
          dropoff_address: r.dropoff_address || "—",
          dropoff_lat: r.dropoff_lat,
          dropoff_lng: r.dropoff_lng,
          estimated_fare: r.estimated_fare || 0,
          vehicle_type: r.vehicle_type || "economy",
          status: r.status,
          wait_seconds: waitSec,
          driver_name: driverName,
          driver_id: r.driver_id,
          created_at: r.created_at,
        };
      });
      setRides(cards);

      // 2. Fetch drivers — cross-check both driver_locations and drivers.is_online
      const { data: locData } = await supabase
        .from("driver_locations")
        .select("*")
        .eq("is_online", true)
        .order("updated_at", { ascending: false })
        .limit(200);

      const locs: DriverLoc[] = (locData as any[] || []).map((d: any) => ({
        id: d.id,
        driver_id: d.driver_id,
        driver_name: d.driver_id?.slice(0, 8) || "???",
        latitude: d.latitude,
        longitude: d.longitude,
        heading: d.heading,
        speed: d.speed,
        is_online: d.is_online || false,
        updated_at: d.updated_at,
      }));

      // Enrich driver names and cross-check is_online from drivers table
      const driverIds = [...new Set(locs.map((d) => d.driver_id).filter(Boolean))];
      if (driverIds.length > 0) {
        const { data: drData } = await supabase
          .from("drivers")
          .select("id, is_online, user:users(full_name), vehicle:vehicles!drivers_vehicle_id_fkey(plate_number, make, model, vehicle_type)")
          .in("id", driverIds);

        const nameMap: Record<string, any> = {};
        const driverOnlineMap: Record<string, boolean> = {};
        (drData as any[])?.forEach((d: any) => {
          nameMap[d.id] = {
            full_name: d.user?.full_name || d.id.slice(0, 8),
            plate: d.vehicle?.plate_number || null,
            vehicle_make: d.vehicle?.make || null,
            vehicle_model: d.vehicle?.model || null,
            vehicle_type: d.vehicle?.vehicle_type || null,
          };
          driverOnlineMap[d.id] = d.is_online === true;
        });

        // Enrich driver names; only cross-check stale locations (>2 min old)
        const staleMs = 2 * 60 * 1000;
        locs.forEach((loc) => {
          if (nameMap[loc.driver_id]) {
            loc.driver_name = nameMap[loc.driver_id].full_name;
            (loc as any).plate = nameMap[loc.driver_id].plate;
            (loc as any).vehicle_make = nameMap[loc.driver_id].vehicle_make;
            (loc as any).vehicle_model = nameMap[loc.driver_id].vehicle_model;
            (loc as any).vehicle_type = nameMap[loc.driver_id].vehicle_type;
          }
          // Only cross-check if location is stale (>2 min) AND drivers says offline
          const age = Date.now() - new Date(loc.updated_at).getTime();
          if (age > staleMs && driverOnlineMap[loc.driver_id] === false) {
            loc.is_online = false;
          }
        });

        // Only keep truly online drivers
        setDrivers(locs.filter((loc) => loc.is_online === true));
      } else {
        setDrivers(locs);
      }

      // 3. Map rides (rides with coordinates)
      const mRides: RideOnMap[] = cards
        .filter((c) => c.pickup_lat && c.pickup_lng)
        .map((c) => ({
          id: c.id,
          status: c.status,
          pickup_lat: c.pickup_lat!,
          pickup_lng: c.pickup_lng!,
          dropoff_lat: c.dropoff_lat || 0,
          dropoff_lng: c.dropoff_lng || 0,
          pickup_addr: c.pickup_address,
          dropoff_addr: c.dropoff_address,
          driver_id: c.driver_id,
          driver_name: c.driver_name,
          rider_name: c.rider_name,
          fare: c.estimated_fare,
        }));
      setMapRides(mRides);

      // 4. Activity feed
      const { data: actData } = await supabase
        .from("rides")
        .select("id, status, created_at, updated_at, rider:riders(user:users(full_name)), driver:drivers(user:users(full_name))")
        .order("updated_at", { ascending: false })
        .limit(20);

      const acts: ActivityItem[] = (actData as any[] || []).map((a: any) => {
        let type: ActivityItem["type"] = "created";
        let actor = a.rider?.user?.full_name || "Rider";
        let detail = "Ride requested";
        if (a.status === "accepted" || a.status === "in_progress" || a.status === "driver_arriving" || a.status === "driver_arrived") {
          type = "assigned";
          actor = a.driver?.user?.full_name || "Driver";
          detail = `Ride ${a.status === "accepted" ? "accepted" : "in progress"}`;
        } else if (a.status === "completed") {
          type = "completed";
          actor = a.driver?.user?.full_name || "Driver";
          detail = "Trip completed";
        } else if (["cancelled", "rider_cancelled", "driver_cancelled", "admin_cancelled"].includes(a.status)) {
          type = "cancelled";
          actor = a.rider?.user?.full_name || "Rider";
          detail = "Cancelled";
        }
        return { id: a.id, ride_id: a.id, type, actor_name: actor, detail, created_at: a.updated_at || a.created_at };
      });
      setActivity(acts);

    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [selectedCityId]);

  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAll]);

  // ── Actions ────────────────────────────────────────────

  const handleAssign = async (rideId: string) => {
    setAssigningId(rideId);
    try {
      const { error: fnErr } = await supabase.rpc("assign_driver", { p_ride_id: rideId });
      if (fnErr) throw new Error(fnErr.message);
      fetchAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setAssigningId(null);
    }
  };

  const handleCancelRide = async (rideId: string) => {
    if (!confirm("Cancel this ride?")) return;
    try {
      await supabase.from("rides").update({ status: "admin_cancelled", cancelled_at: new Date().toISOString(), cancelled_by: "admin" }).eq("id", rideId);
      fetchAll();
    } catch { /* silent */ }
  };

  const handleReassign = async (rideId: string) => {
    try {
      await supabase.from("rides").update({ status: "searching", driver_id: null }).eq("id", rideId);
      fetchAll();
    } catch { /* silent */ }
  };

  // ── Computed ────────────────────────────────────────────

  const pending = rides.filter((r) => r.status === "requested" || r.status === "pending");
  const assigned = rides.filter((r) =>
    ["assigned", "accepted", "driver_arriving", "driver_arrived", "arrived", "in_progress"].includes(r.status)
  );
  const searching = rides.filter((r) => r.status === "searching");
  const stuck = rides.filter((r) => r.status === "no_driver_found" || r.status === "no_drivers");
  const onlineDrivers = drivers.filter((d) => d.is_online);
  const activeTrips = assigned.filter((r) => r.status === "in_progress");
  const priorityRides = [...pending, ...searching, ...stuck];

  const formatWait = (sec: number) => {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };

  const statusBadge = (s: string) => {
    switch (s) {
      case "requested": return { color: "bg-amber-100 text-amber-700", label: "Pending", dot: "bg-amber-500" };
      case "searching": return { color: "bg-blue-100 text-blue-700", label: "Searching", dot: "bg-blue-500" };
      case "accepted": return { color: "bg-green-100 text-green-700", label: "Accepted", dot: "bg-green-500" };
      case "arrived": return { color: "bg-blue-100 text-blue-700", label: "Arrived", dot: "bg-blue-500" };
      case "driver_arriving": case "driver_arrived": return { color: "bg-cyan-100 text-cyan-700", label: "En Route", dot: "bg-cyan-500" };
      case "in_progress": return { color: "bg-purple-100 text-purple-700", label: "On Trip", dot: "bg-purple-500" };
      case "no_driver_found": return { color: "bg-orange-100 text-orange-700", label: "No Driver Found", dot: "bg-orange-500" };
      case "no_drivers": return { color: "bg-orange-100 text-orange-700", label: "No Driver Found", dot: "bg-orange-500" };
      default: return { color: "bg-gray-100 text-gray-700", label: s, dot: "bg-gray-400" };
    }
  };

  // ── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-6 p-6">
      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard icon={Clock} label="Pending" value={pending.length} color="text-amber-500" bg="bg-amber-50" border="border-amber-200" />
        <MetricCard icon={CheckCircle} label="Assigned" value={assigned.length} color="text-green-500" bg="bg-green-50" border="border-green-200" />
        <MetricCard icon={Search} label="Searching" value={searching.length} color="text-blue-500" bg="bg-blue-50" border="border-blue-200" />
        <MetricCard icon={AlertTriangle} label="Stuck" value={stuck.length} color="text-red-500" bg="bg-red-50" border="border-red-200" />
        <MetricCard icon={Users} label="Online Drivers" value={onlineDrivers.length} color="text-purple-500" bg="bg-purple-50" border="border-purple-200" />
        <MetricCard icon={Navigation} label="Active Trips" value={activeTrips.length} color="text-cyan-500" bg="bg-cyan-50" border="border-cyan-200" />
      </div>

      {/* Main Content */}
      <div className="flex flex-col xl:flex-row gap-6">
        {/* LEFT — Queue */}
        <div className="xl:flex-[65%] flex flex-col gap-4 min-w-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Ride Queue</h2>
            <button onClick={fetchAll} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-32"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" /></div>
          ) : error ? (
            <div className="bg-red-50 rounded-2xl border border-red-200 p-8 text-center">
              <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" />
              <p className="text-sm text-red-600">{error}</p>
              <button onClick={fetchAll} className="mt-3 text-xs text-red-700 underline">Retry</button>
            </div>
          ) : priorityRides.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center">
              <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-3" />
              <p className="text-base font-semibold text-gray-900">Queue is clear</p>
              <p className="text-sm text-gray-400 mt-1">All rides have been assigned</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {priorityRides.map((ride) => {
                const badge = statusBadge(ride.status);
                return (
                  <div key={ride.id} className={`bg-white rounded-[18px] border-l-4 p-5 shadow-sm hover:shadow-md transition-all ${
                    (ride.status === "no_driver_found" || ride.status === "no_drivers") ? "border-l-orange-500" : ride.status === "searching" ? "border-l-blue-500" : "border-l-amber-500"
                  }`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-xs font-mono text-gray-400">#{ride.id.slice(0, 8)}</span>
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />{badge.label}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-gray-400"><Clock className="h-3 w-3" />{formatWait(ride.wait_seconds)}</span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0">{ride.rider_name.charAt(0)}</div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{ride.rider_name}</p>
                            {ride.rider_phone && <p className="text-xs text-gray-400 flex items-center gap-1"><Phone className="h-2.5 w-2.5" /> {ride.rider_phone}</p>}
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-sm">
                          <MapPin className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                          <span className="text-gray-700 truncate">{ride.pickup_address}</span>
                          <ArrowRight className="h-3 w-3 text-gray-300 flex-shrink-0" />
                          <MapPin className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
                          <span className="text-gray-500 truncate">{ride.dropoff_address}</span>
                        </div>
                        <div className="mt-3 flex items-center gap-3 flex-wrap">
                          <span className="text-sm font-bold text-gray-900">{formatCurrency(ride.estimated_fare)} MWK</span>
                          {ride.driver_name && <span className="text-xs text-gray-500 flex items-center gap-1"><User className="h-3 w-3" /> {ride.driver_name}</span>}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        {(ride.status === "requested" || ride.status === "searching" || ride.status === "no_driver_found" || ride.status === "no_drivers") ? (
                          <button onClick={() => handleAssign(ride.id)} disabled={assigningId === ride.id} className="flex items-center gap-1.5 h-10 px-5 bg-green-600 text-white rounded-xl text-xs font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors shadow-sm shadow-green-200">
                            <Zap className="h-3.5 w-3.5" />{assigningId === ride.id ? "..." : "Assign"}
                          </button>
                        ) : (
                          <button onClick={() => handleReassign(ride.id)} className="flex items-center gap-1.5 h-10 px-5 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition-colors">
                            <RefreshCw className="h-3.5 w-3.5" />Reassign
                          </button>
                        )}
                        <div className="flex gap-1.5">
                          <button onClick={() => {}} className="flex items-center justify-center w-8 h-8 bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 transition-colors"><Eye className="h-3.5 w-3.5" /></button>
                          <button onClick={() => handleCancelRide(ride.id)} className="flex items-center justify-center w-8 h-8 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition-colors"><XCircle className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT — Map + Drivers + Actions */}
        <div className="xl:flex-[35%] flex flex-col gap-4 min-w-[340px] max-w-[440px]">
          <div className="bg-white rounded-[20px] border border-gray-200 overflow-hidden shadow-sm">
            <LiveMapView drivers={drivers} rides={mapRides} />
          </div>

          <div className="bg-white rounded-[20px] border border-gray-200 p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />Online Drivers ({onlineDrivers.length})
            </h3>
            <div className="space-y-2 max-h-[340px] overflow-y-auto">
              {onlineDrivers.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">No drivers online</p>
              ) : (
                onlineDrivers.slice(0, 10).map((drv) => (
                  <div key={drv.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                    <div className="w-10 h-10 bg-green-600 rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0">{drv.driver_name.charAt(0).toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{drv.driver_name}</p>
                      <p className="text-xs text-gray-400">{(drv as any).plate || "No vehicle"}{(drv as any).vehicle_make ? ` · ${(drv as any).vehicle_make} ${(drv as any).vehicle_model || ""}` : ""}</p>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white rounded-[20px] border border-gray-200 p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-3">Quick Actions</h3>
            <div className="flex flex-wrap gap-2">
              <ActionBtn icon={RefreshCw} label="Refresh Queue" onClick={fetchAll} />
              <ActionBtn icon={Zap} label="Force Assign" onClick={() => {}} />
              <ActionBtn icon={Send} label="Manual Dispatch" onClick={() => {}} />
              <ActionBtn icon={Shield} label="Emergencies" onClick={() => {}} />
              <ActionBtn icon={Ban} label="Pause Dispatch" onClick={() => {}} />
            </div>
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="bg-white rounded-[20px] border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wide flex items-center gap-2"><History className="h-3.5 w-3.5 text-gray-400" />Activity Feed</h3>
          <span className="text-xs text-gray-400">Last 20 events</span>
        </div>
        <div className="max-h-[260px] overflow-y-auto divide-y divide-gray-50">
          {activity.length === 0 ? (
            <div className="px-5 py-8 text-center"><p className="text-xs text-gray-400">No recent activity</p></div>
          ) : (
            activity.map((a, i) => {
              const iconColor = a.type === "created" ? "text-blue-400 bg-blue-50" : a.type === "assigned" ? "text-green-400 bg-green-50" : a.type === "completed" ? "text-purple-400 bg-purple-50" : "text-red-400 bg-red-50";
              const IconComp = a.type === "created" ? Clock : a.type === "completed" ? CheckCircle : a.type === "cancelled" ? XCircle : Users;
              return (
                <div key={a.id + i} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconColor}`}><IconComp className="h-4 w-4" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-900"><span className="font-medium">{a.actor_name}</span> <span className="text-gray-500">{a.detail}</span></p>
                    <p className="text-xs text-gray-400 mt-0.5">#{a.ride_id.slice(0, 8)} · {timeAgo(a.created_at)}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, color, bg, border }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: number; color: string; bg: string; border: string;
}) {
  return (
    <div className={`${bg} ${border} rounded-[20px] p-5 min-h-[110px] flex flex-col justify-between border`}>
      <div className="flex items-center gap-2">
        <div className="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center">
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
      </div>
      <div>
        <p className="text-[34px] font-bold text-gray-900 leading-none">{value.toLocaleString()}</p>
        <p className="text-xs font-medium text-gray-500 mt-1">{label}</p>
      </div>
    </div>
  );
}

function ActionBtn({ icon: Icon, label, onClick }: {
  icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 h-12 px-4 bg-gray-100 text-gray-700 rounded-xl text-xs font-medium hover:bg-gray-200 transition-colors">
      <Icon className="h-4 w-4 text-gray-500" />{label}
    </button>
  );
}

import React from "react";