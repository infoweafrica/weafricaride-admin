"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Activity, MapPin, CreditCard, Car, RefreshCw } from "lucide-react";
import { formatDate } from "@/lib/utils";

type RealtimeEvent = {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, any>;
  created_at: string;
};

export default function RealtimeMonitoringPage() {
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("audit_logs")
        .select("id, action as event_type, entity_type, entity_id, details, created_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (filter !== "all") query = query.eq("entity_type", filter);

      const { data } = await query;
      if (data) setEvents(data as unknown as RealtimeEvent[]);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => {
    fetchEvents();
    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchEvents, 10000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  const getEventIcon = (type: string) => {
    if (type.includes("gps") || type.includes("location") || type.includes("map")) return <MapPin className="h-4 w-4 text-green-500" />;
    if (type.includes("payment") || type.includes("refund") || type.includes("payout")) return <CreditCard className="h-4 w-4 text-yellow-500" />;
    if (type.includes("ride") || type.includes("dispatch") || type.includes("driver")) return <Car className="h-4 w-4 text-blue-500" />;
    return <Activity className="h-4 w-4 text-gray-500" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Realtime Monitoring</h1>
          <p className="text-gray-500 mt-1">Live event stream — GPS updates, payments, ride requests, dispatch events</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-green-600">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Auto-refreshes every 10s
          </div>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="all">All Events</option>
            <option value="ride">Rides</option>
            <option value="payment">Payments</option>
            <option value="driver">Drivers</option>
            <option value="rider">Riders</option>
          </select>
          <button onClick={fetchEvents} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Live Event Stream */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="bg-green-50 border-b border-green-100 px-4 py-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-medium text-green-700">{events.length} recent events</span>
        </div>
        <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
          {loading && events.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">Loading events...</div>
          ) : events.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No events recorded yet</div>
          ) : (
            events.map((event) => (
              <div key={event.id} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50">
                <div className="mt-1">{getEventIcon(event.event_type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium capitalize text-gray-900">
                      {event.event_type?.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                      {event.entity_type}
                    </span>
                  </div>
                  {event.entity_id && (
                    <p className="text-xs text-gray-400 font-mono truncate">{event.entity_id}</p>
                  )}
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {formatDate(event.created_at)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}