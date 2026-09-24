"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { useCityContext } from "@/lib/city-context";
import { supabase } from "@/lib/supabase";
import { RefreshCw, Clock, AlertTriangle, CheckCircle } from "lucide-react";

interface QueueItem {
  id: string;
  ride_id: string;
  status: string;
  queued_at: string;
  expires_at: string | null;
  driver_name: string;
  rider_name: string;
  pickup_address: string;
  dropoff_address: string;
  city: string | null;
}

// This page used to query "dispatch_queue" -- a table with no city_id
// column (or any foreign keys at all; it isn't wired to anything real).
// "trip_queue" is the actual live table (the driver app subscribes to it
// for "next ride queued" notifications): rows here are rides *already*
// assigned to a specific driver, held until that driver finishes their
// current trip and the queued one auto-activates. There's no unassigned-
// rides-needing-manual-dispatch concept in the current schema, so this is
// now a monitoring view of the real queue rather than an "Assign" action
// that never matched what these rows actually are.
export default function DispatchQueuePage() {
  return (
    <PermissionGuard permission="dispatch_rides">
      <DispatchContent />
    </PermissionGuard>
  );
}

function DispatchContent() {
  const { selectedCityId, cities } = useCityContext();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedCityName = cities?.find((c: { id: string; name: string }) => c.id === selectedCityId)?.name;

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("trip_queue")
        .select(
          "id, ride_id, status, queued_at, expires_at, ride:rides(pickup_address, dropoff_address, city, rider:riders(user:users(full_name))), driver:drivers(user:users(full_name))"
        )
        .order("queued_at", { ascending: true })
        .limit(50);

      if (err) throw new Error(err.message);

      const mapped: QueueItem[] = ((data as any[]) || []).map((row) => ({
        id: row.id,
        ride_id: row.ride_id,
        status: row.status,
        queued_at: row.queued_at,
        expires_at: row.expires_at,
        driver_name: row.driver?.user?.full_name || "Unknown driver",
        rider_name: row.ride?.rider?.user?.full_name || "Unknown rider",
        pickup_address: row.ride?.pickup_address || "—",
        dropoff_address: row.ride?.dropoff_address || "—",
        city: row.ride?.city || null,
      }));

      // trip_queue has no city column of its own -- filtering happens
      // client-side against the joined ride's city instead, since
      // PostgREST can't filter a top-level query by a nested embed.
      setQueue(selectedCityName ? mapped.filter((q) => q.city === selectedCityName) : mapped);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dispatch queue");
    } finally {
      setLoading(false);
    }
  }, [selectedCityName]);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 10000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  const queued = queue.filter((q) => q.status === "queued");
  const overdue = queued.filter((q) => q.expires_at && new Date(q.expires_at) < new Date());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dispatch Queue</h1>
          <p className="text-sm text-gray-500 mt-1">
            Next rides queued for drivers currently on a trip
          </p>
        </div>
        <button
          onClick={fetchQueue}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-amber-600 mb-1">
            <Clock className="h-4 w-4" />
            <span className="text-xs font-medium">Queued</span>
          </div>
          <p className="text-2xl font-bold">{queued.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-red-600 mb-1">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-xs font-medium">Overdue</span>
          </div>
          <p className="text-2xl font-bold">{overdue.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-green-600 mb-1">
            <CheckCircle className="h-4 w-4" />
            <span className="text-xs font-medium">Total in Queue</span>
          </div>
          <p className="text-2xl font-bold">{queue.length}</p>
        </div>
      </div>

      {/* Queue list */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Queued Rides</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {loading ? (
            <div className="p-6 text-center text-sm text-gray-400">Loading dispatch queue...</div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-red-500">{error}</div>
          ) : queue.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">
              <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-400" />
              Queue is clear — nothing waiting on a driver right now
            </div>
          ) : (
            queue.map((item) => {
              const isOverdue = item.status === "queued" && item.expires_at && new Date(item.expires_at) < new Date();
              return (
                <div key={item.id} className="px-6 py-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {item.rider_name} <span className="text-gray-400 font-normal">→ queued for</span> {item.driver_name}
                      </p>
                      <div className="mt-1 space-y-0.5">
                        <p className="text-xs text-gray-500">
                          <span className="font-medium text-gray-700">From:</span> {item.pickup_address}
                        </p>
                        <p className="text-xs text-gray-500">
                          <span className="font-medium text-gray-700">To:</span> {item.dropoff_address}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-xs text-gray-400">
                          {new Date(item.queued_at).toLocaleTimeString()}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          isOverdue ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                        }`}>
                          {isOverdue ? "overdue" : item.status}
                        </span>
                      </div>
                    </div>
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
