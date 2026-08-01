"use client";

import { useState } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import { Search, Play, MapPin, Clock } from "lucide-react";

interface TripRoute {
  ride_id: string;
  driver_name: string;
  rider_name: string;
  city: string;
  status: string;
  created_at: string;
}

export default function TripPlaybackPage() {
  return (
    <PermissionGuard permission="view_trip_playback">
      <PlaybackContent />
    </PermissionGuard>
  );
}

function PlaybackContent() {
  const [rideId, setRideId] = useState("");
  const [trips, setTrips] = useState<TripRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<TripRoute | null>(null);

  const handleSearch = async () => {
    if (!rideId.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("rides")
        .select("*")
        .or(`id.eq.${rideId.trim()},rider_name.ilike.%${rideId.trim()}%`)
        .limit(10);

      if (error) throw new Error(error.message);
      setTrips((data as TripRoute[]) || []);
    } catch (e) {
      setTrips([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trip Playback</h1>
          <p className="text-sm text-gray-500 mt-1">Replay trip routes and review ride history</p>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Enter Ride ID or rider name..."
              value={rideId}
              onChange={(e) => setRideId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            Search
          </button>
        </div>
      </div>

      {/* Results */}
      {trips.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Results</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {trips.map((trip) => (
              <div
                key={trip.ride_id}
                className={`px-6 py-4 hover:bg-gray-50 cursor-pointer ${selectedTrip?.ride_id === trip.ride_id ? "bg-green-50" : ""}`}
                onClick={() => setSelectedTrip(trip)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {trip.driver_name || "Unknown"} → {trip.rider_name || "Unknown"}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {trip.city}</span>
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(trip.created_at).toLocaleString()}</span>
                      <span>{trip.status}</span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500">ID: {trip.ride_id.slice(0, 8)}...</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Playback area */}
      {selectedTrip && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 min-h-[400px] flex flex-col items-center justify-center text-gray-400">
          <Play className="h-16 w-16 mb-4 text-gray-300" />
          <p className="text-lg font-medium text-gray-500">Trip Playback</p>
          <p className="text-sm">Ride ID: {selectedTrip.ride_id}</p>
          <p className="text-xs mt-2">Integrate map playback here with route animation</p>
        </div>
      )}
    </div>
  );
}