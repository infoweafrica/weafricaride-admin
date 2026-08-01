"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { RefreshCw, Navigation, Users } from "lucide-react";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAllDriverLocations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/live-map");
      if (!res.ok) throw new Error("Failed to fetch driver locations");
      const data = await res.json();
      setDrivers(data.drivers || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load driver locations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllDriverLocations();
    // Poll every 15 seconds as a lightweight alternative to realtime with anon key
    const interval = setInterval(fetchAllDriverLocations, 15000);
    return () => clearInterval(interval);
  }, [fetchAllDriverLocations]);

  const onlineDrivers = drivers.filter((d) => d.is_online);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Live Map</h1>
          <p className="text-sm text-gray-500 mt-1">Real-time driver locations</p>
        </div>
        <button
          onClick={fetchAllDriverLocations}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={<Navigation className="h-5 w-5 text-blue-600" />} label="Total Tracked" value={drivers.length} />
        <StatCard icon={<Users className="h-5 w-5 text-green-600" />} label="Online" value={onlineDrivers.length} />
        <StatCard icon={<Users className="h-5 w-5 text-gray-600" />} label="Offline" value={drivers.filter((d) => !d.is_online).length} />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <LiveMapView drivers={drivers} />
        </div>
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Drivers</h3>
          </div>
          <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-sm text-gray-400">Loading...</div>
            ) : drivers.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-400">No active drivers</div>
            ) : (
              drivers.slice(0, 50).map((d) => (
                <div key={d.id} className="px-4 py-3 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{d.driver_name}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${d.is_online ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                      {d.is_online ? "online" : "offline"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    <span>Lat: {d.latitude.toFixed(5)}</span>
                    <span>Lng: {d.longitude.toFixed(5)}</span>
                    {d.speed != null && <span>{d.speed.toFixed(1)} km/h</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
      <div className="p-2 bg-gray-50 rounded-lg">{icon}</div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}
