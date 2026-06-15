"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import { RefreshCw, Navigation, Users, Car, AlertTriangle } from "lucide-react";

const LiveMapView = dynamic(() => import("./LiveMapView"), {
  ssr: false,
  loading: () => (
    <div className="bg-white rounded-xl border border-gray-200 p-4 min-h-[500px] flex items-center justify-center text-gray-400">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
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
  on_trip?: boolean;
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

export default function LiveMapPage() {
  return (
    <PermissionGuard permission="view_live_map">
      <LiveMapContent />
    </PermissionGuard>
  );
}

function LiveMapContent() {
  const [drivers, setDrivers] = useState<DriverLocation[]>([]);
  const [rides, setRides] = useState<RideOnMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [onTripCount, setOnTripCount] = useState(0);
  const [driverSearch, setDriverSearch] = useState("");

  const mapDriverLocation = (d: Record<string, unknown>, driverName?: string): DriverLocation => ({
    id: d.id as string,
    driver_id: d.driver_id as string,
    driver_name: driverName || `Driver ${(d.driver_id as string)?.slice(0, 8) || "???"}`,
    latitude: d.latitude as number,
    longitude: d.longitude as number,
    heading: d.heading as number | null,
    speed: d.speed as number | null,
    is_online: d.is_online as boolean || false,
    updated_at: d.updated_at as string,
    on_trip: d.on_trip as boolean || false,
  });

  const enrichDriverNames = useCallback(async (locs: DriverLocation[]) => {
    if (locs.length === 0) return locs;
    const ids = [...new Set(locs.map(d => d.driver_id).filter(Boolean))];
    if (ids.length === 0) return locs;
    try {
      const { data } = await supabase.from("drivers").select("id, user:users(full_name)").in("id", ids);
      const map: Record<string, string> = {};
      (data as unknown[] as Record<string, unknown>[])?.forEach((d) => {
        map[d.id as string] = (d.user as Record<string, unknown>)?.full_name as string || (d.id as string).slice(0, 8);
      });
      return locs.map(d => ({ ...d, driver_name: map[d.driver_id] || d.driver_name }));
    } catch { return locs; }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // Fetch driver locations (no embed join needed)
      const { data: locData, error: locErr } = await supabase
        .from("driver_locations")
        .select("id, driver_id, latitude, longitude, heading, speed, is_online, updated_at")
        .order("updated_at", { ascending: false })
        .limit(200);

      if (locErr && !locErr.message.includes("row-level")) {
        throw new Error("Locations: " + locErr.message);
      }

      // Fetch active rides (no embed join — rpc or separate names query)
      const { data: rideData } = await supabase
        .from("rides")
        .select("id, status, pickup_address, dropoff_address, driver_id, estimated_fare, created_at")
        .in("status", ["in_progress"])
        .order("created_at", { ascending: false })
        .limit(50);

       // Map driver locations & cross-check with drivers.is_online
      const mapped = ((locData as unknown[]) || []).map((d) => mapDriverLocation(d as Record<string, unknown>));

      // Cross-check: fetch drivers.is_online to filter stale locations only
      const driverIds = [...new Set(mapped.map(d => d.driver_id).filter(Boolean))];
      if (driverIds.length > 0) {
        const { data: drData } = await supabase
          .from("drivers")
          .select("id, is_online")
          .in("id", driverIds);
        const onlineMap: Record<string, boolean> = {};
        (drData as any[])?.forEach((d: any) => { onlineMap[d.id] = d.is_online === true; });

        // drivers.is_online is the source of truth
        mapped.forEach(d => {
          d.is_online = onlineMap[d.driver_id] === true;
        });
      }
      const trulyOnline = mapped.filter(d => {
        return d.is_online === true && d.latitude != null && d.longitude != null;
      });

      const enriched =
        await enrichDriverNames(
          trulyOnline
        );

      // Map rides (without lat/lng for now — rides table may not have coordinates)
      const mappedRides: RideOnMap[] = ((rideData as unknown[]) || []).map((r) => {
        const rd = r as Record<string, unknown>;
        return {
          id: rd.id as string,
          status: rd.status as string,
          pickup_lat: 0, pickup_lng: 0,
          dropoff_lat: 0, dropoff_lng: 0,
          pickup_addr: (rd.pickup_address as string) || "",
          dropoff_addr: (rd.dropoff_address as string) || "",
          driver_id: rd.driver_id as string,
          driver_name: enriched.find(d => d.driver_id === rd.driver_id)?.driver_name || "—",
          rider_name: "—",
          fare: rd.estimated_fare as number,
        };
      }).filter(r => r.pickup_addr);

      setDrivers(enriched);
      setRides(mappedRides);
      setOnlineCount(enriched.length);
      setOnTripCount(mappedRides.filter(r => r.status === "in_progress").length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [enrichDriverNames]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Realtime subscriptions
  useEffect(() => {
    const locChannel = supabase
      .channel("livemap_locations")
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_locations" }, (payload) => {
        const newRow = payload.new as Record<string, unknown> | null;
        if (payload.eventType === "DELETE") {
          setDrivers(p => p.filter(d => d.id !== (payload.old as Record<string, unknown>)?.id));
          setOnlineCount(p => Math.max(0, p - 1));
          return;
        }
        if (newRow) {
          fetchAll();
        }
      }).subscribe();

    const rideChannel = supabase
      .channel("livemap_rides")
      .on("postgres_changes", { event: "*", schema: "public", table: "rides" }, () => {
        fetchAll();
      }).subscribe();

    return () => { supabase.removeChannel(locChannel); supabase.removeChannel(rideChannel); };
  }, [fetchAll, mapDriverLocation]);

  const handleForceOffline = async (driverId: string) => {
    await supabase.rpc("admin_force_driver_offline", { p_driver_id: driverId });
    fetchAll();
  };

  const handleSuspend = async (driverId: string) => {
    await supabase.rpc("admin_suspend_driver", { p_driver_id: driverId, p_reason: "Suspended from live map" });
    fetchAll();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Live Map</h1>
          <p className="text-sm text-gray-500 mt-1">Real-time driver locations & active trips</p>
        </div>
        <button onClick={fetchAll} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4"><div className="flex items-center gap-2"><Users className="h-4 w-4 text-green-600"/><span className="text-xs text-gray-500">Online</span></div><p className="text-xl font-bold mt-1">{onlineCount}</p></div>
        <div className="bg-white rounded-xl border p-4"><div className="flex items-center gap-2"><Navigation className="h-4 w-4 text-blue-600"/><span className="text-xs text-gray-500">On Trip</span></div><p className="text-xl font-bold mt-1">{onTripCount}</p></div>
        <div className="bg-white rounded-xl border p-4"><div className="flex items-center gap-2"><Car className="h-4 w-4 text-purple-600"/><span className="text-xs text-gray-500">Active Rides</span></div><p className="text-xl font-bold mt-1">{rides.length}</p></div>
        <div className="bg-white rounded-xl border p-4"><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-600"/><span className="text-xs text-gray-500">Emergencies</span></div><p className="text-xl font-bold mt-1">0</p></div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-3 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500 inline-block"></span> Available</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span> On Trip</span>
        <span className="flex items-center gap-1">📍 Pickup</span>
        <span className="flex items-center gap-1">🏁 Drop-off</span>
        </div>

        <div className="text-xs text-gray-400">
          Malawi operations view
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
        <div className="xl:col-span-3">
          <LiveMapView
            drivers={drivers}
            rides={rides}
            onForceOffline={handleForceOffline}
            onSuspendDriver={handleSuspend}
          />
        </div>

        <div className="xl:col-span-1 bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">

        <div className="px-4 py-3 border-b">
          <h3 className="font-semibold">
            Live Drivers
          </h3>
        </div>

        <div className="divide-y">

          <div className="p-3 border-b">
            <input
              type="text"
              placeholder="Search live driver..."
              value={driverSearch}
              onChange={(e) => setDriverSearch(e.target.value)}
              className="w-full h-10 px-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {drivers.filter(driver =>
            driver.driver_name.toLowerCase().includes(driverSearch.toLowerCase()) ||
            driver.driver_id.toLowerCase().includes(driverSearch.toLowerCase())
          ).length===0 && (
            <div className="p-6 text-center text-gray-400 text-sm">
              No live drivers
            </div>
          )}

          {drivers.filter(driver =>
            driver.driver_name.toLowerCase().includes(driverSearch.toLowerCase()) ||
            driver.driver_id.toLowerCase().includes(driverSearch.toLowerCase())
          ).map(driver=>{

            const mins=Math.floor(
              (
                Date.now()-
                new Date(driver.updated_at).getTime()
              )/60000
            )

            return (

              <div
                key={driver.id}
                className="p-4 flex items-center justify-between"
              >

                <div>

                  <p className="font-medium">
                    {driver.driver_name}
                  </p>

                  <p className="text-xs text-gray-500">

                    {driver.speed
                      ? `${driver.speed.toFixed(1)} km/h`
                      : "0 km/h"}

                    {" • "}

                    {mins}m ago

                  </p>

                  {mins >= 5 && (
                    <p className="mt-1 text-xs text-amber-600 font-medium">
                      Location update is stale
                    </p>
                  )}

                </div>

                <div className="flex gap-2">

                  <button
                    onClick={()=>handleForceOffline(driver.driver_id)}
                    className="px-3 py-1 bg-red-50 text-red-600 rounded-lg text-xs"
                  >
                    Go Offline
                  </button>

                  <button
                    onClick={()=>handleSuspend(driver.driver_id)}
                    className="px-3 py-1 bg-amber-50 text-amber-600 rounded-lg text-xs"
                  >
                    Suspend
                  </button>

                </div>

              </div>

            )

          })}

        </div>

        </div>
      </div>

    </div>
  );
}