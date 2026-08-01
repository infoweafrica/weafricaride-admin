"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { useCityContext } from "@/lib/city-context";
import { supabase } from "@/lib/supabase";
import { RefreshCw, Send, Clock, AlertTriangle, CheckCircle } from "lucide-react";

interface DispatchItem {
  id: string;
  ride_id: string;
  rider_name: string;
  pickup_address: string;
  dropoff_address: string;
  status: string;
  created_at: string;
  attempts: number;
}

export default function DispatchQueuePage() {
  return (
    <PermissionGuard permission="dispatch_rides">
      <DispatchContent />
    </PermissionGuard>
  );
}

function DispatchContent() {
  const { selectedCityId } = useCityContext();
  const [queue, setQueue] = useState<DispatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("dispatch_queue")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(50);

      if (selectedCityId) {
        query = query.eq("city_id", selectedCityId);
      }

      const { data, error: err } = await query;
      if (err) throw new Error(err.message);
      setQueue((data as DispatchItem[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dispatch queue");
    } finally {
      setLoading(false);
    }
  }, [selectedCityId]);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 10000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  const handleAssign = async (item: DispatchItem) => {
    setAssigning(item.id);
    try {
      const { error: fnError } = await supabase.rpc("assign_driver", {
        p_ride_id: item.ride_id,
      });
      if (fnError) throw new Error(fnError.message);
      // Remove from queue on success
      setQueue((prev) => prev.filter((q) => q.id !== item.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setAssigning(null);
    }
  };

  const pending = queue.filter((q) => q.status === "pending");
  const stuck = queue.filter((q) => q.status === "stuck" || q.attempts >= 3);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dispatch Queue</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manual ride assignments and stuck ride management
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
            <span className="text-xs font-medium">Pending</span>
          </div>
          <p className="text-2xl font-bold">{pending.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-red-600 mb-1">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-xs font-medium">Stuck</span>
          </div>
          <p className="text-2xl font-bold">{stuck.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-green-600 mb-1">
            <CheckCircle className="h-4 w-4" />
            <span className="text-xs font-medium">Total Queue</span>
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
              Queue is clear — all rides assigned
            </div>
          ) : (
            queue.map((item) => (
              <div key={item.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{item.rider_name}</p>
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
                        {new Date(item.created_at).toLocaleTimeString()}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        item.status === "stuck" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                      }`}>
                        {item.status} ({item.attempts} attempts)
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleAssign(item)}
                    disabled={assigning === item.id}
                    className="ml-4 flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-xs font-medium disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {assigning === item.id ? "Assigning..." : "Assign"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}