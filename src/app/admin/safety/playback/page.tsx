"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import {
  Search, Play, Pause, SkipBack, SkipForward, MapPin, Clock, User,
  Phone, Car, Shield, AlertTriangle, Activity, Flag, RotateCcw,
  DollarSign, FileText, ChevronRight, X, Filter, Download, RefreshCw,
  CheckCircle, Navigation, Gauge, Route, Calendar, CreditCard,
  Building2, Eye, Ban, FileSpreadsheet, ChevronLeft, ChevronDown,
} from "lucide-react";
import { formatCurrency, formatNumber, timeAgo, formatDate } from "@/lib/utils";

// ─── TYPES ──────────────────────────────────────────────────

interface PlaybackStats { total_trips: number; gps_trips: number; flagged_trips: number; disputed_trips: number; }

interface TripResult {
  ride_id: string; driver_id?: string; status: string; created_at: string; city: string;
  pickup_address?: string; dropoff_address?: string; fare?: number;
  distance_km?: number; duration_min?: number;
  safety_flagged?: boolean; safety_flag_reason?: string;
  reviewed_by?: string; reviewed_at?: string;
  rider_name?: string; rider_phone?: string;
  driver_name?: string; driver_phone?: string;
  plate_number?: string; make?: string; model?: string; color?: string;
  vehicle_class?: string;
  gps_point_count?: number; safety_event_count?: number; active_dispute_count?: number;
}

interface TripDetail {
  ride_id: string; driver_id?: string; status: string; created_at: string; city: string;
  pickup_address?: string; dropoff_address?: string; fare?: number;
  distance_km?: number; duration_min?: number;
  safety_flagged?: boolean; safety_flag_reason?: string; reviewed_at?: string;
  rider_name?: string; rider_phone?: string;
  driver_name?: string; driver_phone?: string;
  plate_number?: string; vehicle_make?: string; vehicle_model?: string; vehicle_color?: string;
  vehicle_class?: string;
  base_fare?: number; distance_fare?: number; time_fare?: number; surge_multiplier?: number;
  payment_method?: string; payment_status?: string; payment_amount?: number; paid_at?: string;
  started_at?: string; completed_at?: string; cancelled_at?: string; cancellation_reason?: string;
  gps_point_count?: number; event_count?: number;
  safety_event_count?: number; dispute_count?: number;
  commission?: number; tax?: number; driver_earnings?: number;
}

interface RoutePoint { id: string; latitude: number; longitude: number; speed_kmh?: number; event_type?: string; recorded_at: string; }
interface RideEvent { id: string; event_type: string; description?: string; recorded_at: string; }
interface SafetyEvent { id: string; event_type: string; severity: string; description?: string; recorded_at: string; }

// ─── HELPERS ────────────────────────────────────────────────

const getStatusColor = (s: string) => {
  switch (s) {
    case "completed": return "bg-green-100 text-green-700";
    case "cancelled": return "bg-red-100 text-red-700";
    case "in_progress": return "bg-blue-100 text-blue-700";
    default: return "bg-gray-100 text-gray-600";
  }
};

const getVehicleIcon = (vc?: string) => {
  switch (vc) {
    case "boda": return "🏍️"; case "delivery": return "📦";
    case "van": return "🚐"; case "shuttle": return "🚌";
    default: return "🚗";
  }
};

const EVENT_LABELS: Record<string, string> = {
  requested: "Rider requested trip", searching: "Searching for driver",
  accepted: "Driver accepted", driver_arriving: "Driver on the way",
  driver_arrived: "Driver arrived", started: "Trip started",
  stop_detected: "Stop detected", in_progress: "Trip in progress",
  completed: "Trip completed", cancelled: "Trip cancelled",
  payment_completed: "Payment completed", payment_failed: "Payment failed",
};

// ─── PAGE ───────────────────────────────────────────────────

export default function TripPlaybackPage() {
  return (
    <PermissionGuard permission="view_trip_playback">
      <PlaybackContent />
    </PermissionGuard>
  );
}

function PlaybackContent() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stats
  const [stats, setStats] = useState<PlaybackStats>({ total_trips: 0, gps_trips: 0, flagged_trips: 0, disputed_trips: 0 });

  // Search
  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [safetyFilter, setSafetyFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Results
  const [trips, setTrips] = useState<TripResult[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<TripResult | null>(null);
  const [tripDetail, setTripDetail] = useState<TripDetail | null>(null);
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [events, setEvents] = useState<RideEvent[]>([]);
  const [safetyEvents, setSafetyEvents] = useState<SafetyEvent[]>([]);

  // Playback
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentPointIndex, setCurrentPointIndex] = useState(0);

  // ── Fetch ──
  const fetchStats = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_trip_playback_stats");
      if (data) setStats(data as PlaybackStats);
    } catch { /* */ }
  }, []);

  const handleSearch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.rpc("admin_search_trips_enriched", {
        p_search: search,
        p_city: cityFilter !== "all" ? cityFilter : null,
        p_status: statusFilter !== "all" ? statusFilter : null,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_limit: 20,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setTrips(((data as any)?.data || []) as TripResult[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Search failed"); }
    finally { setLoading(false); }
  }, [search, cityFilter, statusFilter, dateFrom, dateTo]);

  const selectTrip = useCallback(async (trip: TripResult) => {
    setSelectedTrip(trip);
    setTripDetail(null);
    setRoutePoints([]);
    setEvents([]);
    setSafetyEvents([]);
    setCurrentPointIndex(0);
    setPlaying(false);

    try {
      // Get trip detail
      const { data: detailData } = await supabase.rpc("admin_get_trip_detail", { p_ride_id: trip.ride_id });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setTripDetail((detailData as any)?.data || null);

      // Get GPS points
      const { data: points } = await supabase.from("ride_location_points").select("*").eq("ride_id", trip.ride_id).order("recorded_at", { ascending: true }).limit(1000);
      setRoutePoints((points || []) as RoutePoint[]);

      // Get events
      const { data: evts } = await supabase.from("ride_events").select("*").eq("ride_id", trip.ride_id).order("recorded_at", { ascending: true });
      setEvents((evts || []) as RideEvent[]);

      // Get safety events
      const { data: se } = await supabase.from("ride_safety_events").select("*").eq("ride_id", trip.ride_id).order("recorded_at", { ascending: true });
      setSafetyEvents((se || []) as SafetyEvent[]);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Playback
  useEffect(() => {
    if (!playing || routePoints.length === 0) return;
    const interval = setInterval(() => {
      setCurrentPointIndex(prev => {
        const next = prev + 1;
        if (next >= routePoints.length) { setPlaying(false); return prev; }
        return next;
      });
    }, 1000 / speed);
    return () => clearInterval(interval);
  }, [playing, speed, routePoints.length]);

  const currentPoint = routePoints[currentPointIndex];
  const progress = routePoints.length > 0 ? (currentPointIndex / routePoints.length) * 100 : 0;

  // ─── RENDER ───────────────────────────────────────────────

  return (
    <div className="space-y-6" style={{ padding: 32 }}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800 }} className="text-gray-900">Trip Playback</h1>
          <p style={{ fontSize: 15 }} className="text-gray-500 mt-1">Replay trip routes, investigate incidents, and review ride history</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { fetchStats(); handleSearch(); }} className="flex items-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50" style={{ height: 44 }}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700"><AlertTriangle className="h-4 w-4 inline mr-1" />{error}</div>}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {([
          { label: "Total Trips Recorded", value: formatNumber(stats.total_trips), icon: Activity, color: "text-blue-600 bg-blue-50" },
          { label: "Trips with GPS Data", value: formatNumber(stats.gps_trips), icon: MapPin, color: "text-green-600 bg-green-50" },
          { label: "Safety Flagged", value: formatNumber(stats.flagged_trips), icon: Shield, color: "text-orange-600 bg-orange-50" },
          { label: "Active Disputes", value: formatNumber(stats.disputed_trips), icon: AlertTriangle, color: "text-red-600 bg-red-50" },
        ]).map(c => (
          <div key={c.label} className="bg-white rounded-2xl border p-4" style={{ minHeight: 90, minWidth: 180 }}>
            <div className="flex items-center gap-2 mb-1"><div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.color}`}><c.icon className="h-4 w-4" /></div><p className="text-xs text-gray-400 font-medium">{c.label}</p></div>
            <p style={{ fontSize: 24, fontWeight: 800 }} className="text-gray-900">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input type="text" placeholder="Search Ride ID, rider name/phone, driver name/phone, plate number..." value={search}
              onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <button onClick={handleSearch} disabled={loading} className="flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 disabled:opacity-50" style={{ height: 44 }}>
            <Search className="h-4 w-4" /> Search
          </button>
          <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-1.5 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50" style={{ height: 44 }}>
            <Filter className="h-4 w-4" /> Filters <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showFilters ? "rotate-180" : ""}`} />
          </button>
        </div>
        {showFilters && (
          <div className="flex flex-wrap gap-3 pt-3 border-t border-gray-100">
            <select value={cityFilter} onChange={e => setCityFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
              <option value="all">All Cities</option>
              <option value="blantyre">Blantyre</option><option value="lilongwe">Lilongwe</option><option value="mzuzu">Mzuzu</option><option value="zomba">Zomba</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
              <option value="all">All Status</option>
              <option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="in_progress">In Progress</option>
            </select>
            <select value={safetyFilter} onChange={e => setSafetyFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
              <option value="all">All Safety</option>
              <option value="flagged">Flagged</option><option value="normal">Normal</option>
            </select>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-xs" />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-xs" />
          </div>
        )}
      </div>

      {/* Results List */}
      {trips.length > 0 && !selectedTrip && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50"><h3 className="text-sm font-semibold text-gray-900">Search Results ({trips.length})</h3></div>
          <div className="divide-y divide-gray-100">
            {trips.map(t => (
              <div key={t.ride_id} onClick={() => selectTrip(t)}
                className="px-6 py-4 hover:bg-gray-50 cursor-pointer transition flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-900">{t.driver_name || "Unknown"}</span>
                    <ChevronRight className="h-3 w-3 text-gray-300" />
                    <span className="text-sm text-gray-600">{t.rider_name || "Unknown"}</span>
                    {t.safety_flagged && <Shield className="h-3.5 w-3.5 text-orange-500" />}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{t.city}</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(t.created_at)}</span>
                    <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium ${getStatusColor(t.status)}`}>{t.status}</span>
                    {t.gps_point_count ? <span className="flex items-center gap-1"><Navigation className="h-3 w-3" />{t.gps_point_count} pts</span> : null}
                  </div>
                </div>
                <div className="text-right text-xs text-gray-400">
                  <p className="font-mono">{t.ride_id?.slice(0, 8)}</p>
                  {t.fare ? <p className="font-medium text-gray-600">{formatCurrency(t.fare)}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TRIP PLAYBACK VIEW ── */}
      {selectedTrip && (
        <div className="space-y-6">
          {/* Back button */}
          <button onClick={() => { setSelectedTrip(null); setTripDetail(null); setPlaying(false); }} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ChevronLeft className="h-4 w-4" /> Back to results
          </button>

          {/* 2-Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-7 gap-6">
            {/* LEFT: Map Playback — 65% width (5/7 cols) */}
            <div className="lg:col-span-5 space-y-4">
              {/* Map */}
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden" style={{ height: 500 }}>
                <div className="relative w-full h-full bg-slate-100 flex flex-col items-center justify-center">
                  {routePoints.length === 0 ? (
                    <div className="text-center text-gray-400">
                      <MapPin className="h-16 w-16 mx-auto mb-2 opacity-20" />
                      <p className="text-sm">No GPS route data available</p>
                      <p className="text-xs mt-1">Trip was booked but no location tracking recorded</p>
                    </div>
                  ) : (
                    <>
                      {/* Route visualization */}
                      <div className="absolute inset-0 p-4">
                        <svg viewBox="0 0 400 400" className="w-full h-full" preserveAspectRatio="none">
                          {/* Route line */}
                          <polyline
                            points={routePoints.map((p, i) => {
                              // Normalize to 400x400
                              const lats = routePoints.map(pp => pp.latitude);
                              const lngs = routePoints.map(pp => pp.longitude);
                              const minLat = Math.min(...lats), maxLat = Math.max(...lats);
                              const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
                              const rangeLat = maxLat - minLat || 0.001;
                              const rangeLng = maxLng - minLng || 0.001;
                              const x = ((p.longitude - minLng) / rangeLng) * 380 + 10;
                              const y = 390 - ((p.latitude - minLat) / rangeLat) * 380;
                              return `${x},${y}`;
                            }).join(" ")}
                            fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"
                          />
                          {/* Start marker */}
                          {(() => {
                            const lats = routePoints.map(pp => pp.latitude);
                            const lngs = routePoints.map(pp => pp.longitude);
                            const minLat = Math.min(...lats), maxLat = Math.max(...lats);
                            const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
                            const rangeLat = maxLat - minLat || 0.001;
                            const rangeLng = maxLng - minLng || 0.001;
                            const sx = ((routePoints[0].longitude - minLng) / rangeLng) * 380 + 10;
                            const sy = 390 - ((routePoints[0].latitude - minLat) / rangeLat) * 380;
                            return <><circle cx={sx} cy={sy} r="6" fill="#22c55e" stroke="white" strokeWidth="2" /><text x={sx} y={sy - 10} textAnchor="middle" fill="#22c55e" fontSize="10" fontWeight="bold">START</text></>;
                          })()}
                          {/* End marker */}
                          {(() => {
                            const lats = routePoints.map(pp => pp.latitude);
                            const lngs = routePoints.map(pp => pp.longitude);
                            const minLat = Math.min(...lats), maxLat = Math.max(...lats);
                            const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
                            const rangeLat = maxLat - minLat || 0.001;
                            const rangeLng = maxLng - minLng || 0.001;
                            const last = routePoints[routePoints.length - 1];
                            const ex = ((last.longitude - minLng) / rangeLng) * 380 + 10;
                            const ey = 390 - ((last.latitude - minLat) / rangeLat) * 380;
                            return <><circle cx={ex} cy={ey} r="6" fill="#ef4444" stroke="white" strokeWidth="2" /><text x={ex} y={ey - 10} textAnchor="middle" fill="#ef4444" fontSize="10" fontWeight="bold">END</text></>;
                          })()}
                          {/* Current position (playback) */}
                          {currentPoint && (() => {
                            const lats = routePoints.map(pp => pp.latitude);
                            const lngs = routePoints.map(pp => pp.longitude);
                            const minLat = Math.min(...lats), maxLat = Math.max(...lats);
                            const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
                            const rangeLat = maxLat - minLat || 0.001;
                            const rangeLng = maxLng - minLng || 0.001;
                            const cx = ((currentPoint.longitude - minLng) / rangeLng) * 380 + 10;
                            const cy = 390 - ((currentPoint.latitude - minLat) / rangeLat) * 380;
                            return <circle cx={cx} cy={cy} r="8" fill="#3b82f6" stroke="white" strokeWidth="2" className="animate-pulse" />;
                          })()}
                        </svg>
                      </div>
                      {/* Legend overlay */}
                      <div className="absolute top-3 left-3 bg-white/90 rounded-lg px-3 py-1.5 text-[10px] space-y-0.5">
                        <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-green-500" /> Start</div>
                        <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-red-500" /> End</div>
                        <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Current</div>
                      </div>
                      {/* Info overlay */}
                      <div className="absolute bottom-3 left-3 right-3 bg-white/90 rounded-lg px-3 py-1.5 flex items-center justify-between text-[10px]">
                        <span>{routePoints.length} GPS points</span>
                        {currentPoint && <span>Speed: {currentPoint.speed_kmh || 0} km/h</span>}
                        <span className="font-mono">{currentPoint ? new Date(currentPoint.recorded_at).toLocaleTimeString() : "—"}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Playback Controls */}
              <div className="bg-white rounded-2xl border border-gray-200 p-4">
                <div className="flex items-center gap-3 mb-3">
                  <button onClick={() => setCurrentPointIndex(0)} disabled={routePoints.length === 0} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><SkipBack className="h-4 w-4 text-gray-600" /></button>
                  <button onClick={() => setPlaying(!playing)} disabled={routePoints.length === 0} className="p-3 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-30">
                    {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </button>
                  <button onClick={() => setCurrentPointIndex(routePoints.length - 1)} disabled={routePoints.length === 0} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><SkipForward className="h-4 w-4 text-gray-600" /></button>
                  <div className="flex items-center gap-1 ml-2">
                    {[1, 2, 4].map(s => (
                      <button key={s} onClick={() => setSpeed(s)} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${speed === s ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{s}x</button>
                    ))}
                  </div>
                  <span className="ml-auto text-xs text-gray-400 font-mono">
                    {currentPointIndex}/{routePoints.length}
                  </span>
                </div>
                {/* Timeline scrubber */}
                <div className="w-full bg-gray-200 rounded-full h-2 relative cursor-pointer"
                  onClick={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = (e.clientX - rect.left) / rect.width;
                    setCurrentPointIndex(Math.floor(pct * routePoints.length));
                  }}>
                  <div className="absolute inset-y-0 left-0 bg-green-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-gray-400">
                  <span>{routePoints[0] ? new Date(routePoints[0].recorded_at).toLocaleTimeString() : "—"}</span>
                  <span>{routePoints[routePoints.length - 1] ? new Date(routePoints[routePoints.length - 1].recorded_at).toLocaleTimeString() : "—"}</span>
                </div>
              </div>
            </div>

            {/* RIGHT: Trip Details Panel — 35% width (2/7 cols) */}
            <div className="lg:col-span-2 space-y-4">
              {/* Trip Info */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-900">Trip Details</h4>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${getStatusColor(selectedTrip.status)}`}>{selectedTrip.status}</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  {[
                    { l: "Ride ID", v: selectedTrip.ride_id?.slice(0, 12), mono: true },
                    { l: "Rider", v: `${tripDetail?.rider_name || "—"} · ${tripDetail?.rider_phone || ""}` },
                    { l: "Driver", v: `${tripDetail?.driver_name || "—"} · ${tripDetail?.driver_phone || ""}` },
                    { l: "Vehicle", v: `${getVehicleIcon(tripDetail?.vehicle_class)} ${tripDetail?.plate_number || "—"} (${tripDetail?.vehicle_make || ""} ${tripDetail?.vehicle_model || ""})` },
                    { l: "City", v: selectedTrip.city || "—" },
                    { l: "Pickup", v: tripDetail?.pickup_address || "—" },
                    { l: "Drop-off", v: tripDetail?.dropoff_address || "—" },
                    { l: "Distance", v: tripDetail?.distance_km ? `${tripDetail.distance_km} km` : "—" },
                    { l: "Duration", v: tripDetail?.duration_min ? `${tripDetail.duration_min} min` : "—" },
                    { l: "Fare", v: tripDetail?.fare ? formatCurrency(tripDetail.fare) : "—", bold: true },
                    { l: "Payment", v: `${tripDetail?.payment_method || "—"} · ${tripDetail?.payment_status || "—"}` },
                    { l: "Started", v: tripDetail?.started_at ? formatDate(tripDetail.started_at) : "—" },
                    { l: "Ended", v: tripDetail?.completed_at ? formatDate(tripDetail.completed_at) : tripDetail?.cancelled_at ? formatDate(tripDetail.cancelled_at) : "—" },
                  ].map(f => (
                    <div key={f.l} className="flex justify-between"><span className="text-gray-400">{f.l}</span><span className={`text-right max-w-[60%] ${f.mono ? "font-mono" : ""} ${f.bold ? "font-semibold text-gray-900" : "text-gray-700"}`}>{f.v}</span></div>
                  ))}
                </div>
              </div>

              {/* Pricing Breakdown */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-2">
                <h4 className="text-xs font-semibold text-gray-500 flex items-center gap-2"><DollarSign className="h-4 w-4" />Pricing</h4>
                <div className="space-y-1 text-xs">
                  {[
                    { l: "Base Fare", v: formatCurrency(tripDetail?.base_fare || 0) },
                    { l: "Distance", v: formatCurrency(tripDetail?.distance_fare || 0) },
                    { l: "Time", v: formatCurrency(tripDetail?.time_fare || 0) },
                    { l: "Surge", v: tripDetail?.surge_multiplier ? `${tripDetail.surge_multiplier}x` : "—" },
                    { l: "Commission", v: "-" + formatCurrency(tripDetail?.commission || 0), red: true },
                    { l: "Tax/VAT", v: "-" + formatCurrency(tripDetail?.tax || 0), red: true },
                    { l: "Driver Net", v: formatCurrency(tripDetail?.driver_earnings || 0), bold: true, green: true },
                  ].map(f => (
                    <div key={f.l} className="flex justify-between"><span className="text-gray-400">{f.l}</span><span className={`${f.bold ? "font-semibold" : ""} ${f.red ? "text-red-500" : f.green ? "text-green-600" : "text-gray-700"}`}>{f.v}</span></div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Safety Investigation */}
          {safetyEvents.length > 0 && (
            <div className="bg-white rounded-2xl border border-orange-200 p-6">
              <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><Shield className="h-4 w-4 text-orange-500" />Safety Review</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                {[
                  { label: "SOS Triggered", value: safetyEvents.some(e => e.event_type === "sos_triggered") ? "Yes ⚠️" : "No", alert: safetyEvents.some(e => e.event_type === "sos_triggered") },
                  { label: "Harsh Braking", value: `${safetyEvents.filter(e => e.event_type === "harsh_braking").length} events`, alert: safetyEvents.some(e => e.event_type === "harsh_braking") },
                  { label: "Over-speeding", value: `${safetyEvents.filter(e => e.event_type === "overspeeding").length} events`, alert: safetyEvents.some(e => e.event_type === "overspeeding") },
                  { label: "Route Deviation", value: safetyEvents.some(e => e.event_type === "route_deviation") ? "Detected ⚠️" : "None", alert: safetyEvents.some(e => e.event_type === "route_deviation") },
                  { label: "Long Stops", value: `${safetyEvents.filter(e => e.event_type === "long_stop").length} detected`, alert: safetyEvents.some(e => e.event_type === "long_stop") },
                  { label: "Total Safety Events", value: `${safetyEvents.length}`, alert: safetyEvents.length > 0 },
                ].map(s => (
                  <div key={s.label} className={`p-3 rounded-xl ${s.alert ? "bg-red-50 border border-red-100" : "bg-gray-50"}`}>
                    <p className="text-gray-500">{s.label}</p>
                    <p className={`font-semibold mt-0.5 ${s.alert ? "text-red-700" : "text-gray-700"}`}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trip Event Timeline */}
          {events.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><Clock className="h-4 w-4 text-blue-500" />Trip Event Timeline</h4>
              <div className="space-y-0">
                {events.map((e, i) => (
                  <div key={e.id} className="flex gap-3 pb-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full mt-1 ${i === 0 ? "bg-green-500" : i === events.length - 1 ? "bg-red-500" : "bg-gray-300"}`} />
                      {i < events.length - 1 && <div className="w-0.5 flex-1 bg-gray-200 mt-0.5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900">{EVENT_LABELS[e.event_type] || e.event_type}</p>
                      <p className="text-[10px] text-gray-400">{new Date(e.recorded_at).toLocaleTimeString()}</p>
                      {e.description && <p className="text-[10px] text-gray-500 mt-0.5">{e.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Admin Actions */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h4 className="text-xs font-semibold text-gray-500 mb-3">Admin Actions</h4>
            <div className="flex flex-wrap gap-2">
              <button className="px-4 py-2 text-xs border border-gray-200 rounded-xl hover:bg-gray-50"><User className="h-3.5 w-3.5 inline mr-1" />Open Rider</button>
              <button className="px-4 py-2 text-xs border border-gray-200 rounded-xl hover:bg-gray-50"><User className="h-3.5 w-3.5 inline mr-1" />Open Driver</button>
              <button className="px-4 py-2 text-xs border border-gray-200 rounded-xl hover:bg-gray-50"><CreditCard className="h-3.5 w-3.5 inline mr-1" />Payment Receipt</button>
              <button className="px-4 py-2 text-xs border border-gray-200 rounded-xl hover:bg-gray-50"><AlertTriangle className="h-3.5 w-3.5 inline mr-1" />Open Dispute</button>
              <button onClick={async () => { if (selectedTrip) { await supabase.rpc("admin_mark_trip_reviewed", { p_ride_id: selectedTrip.ride_id }); alert("Marked as reviewed"); } }} className="px-4 py-2 text-xs bg-green-50 border border-green-200 text-green-700 rounded-xl hover:bg-green-100"><CheckCircle className="h-3.5 w-3.5 inline mr-1" />Mark Reviewed</button>
              <button className="px-4 py-2 text-xs bg-orange-50 border border-orange-200 text-orange-700 rounded-xl hover:bg-orange-100"><FileText className="h-3.5 w-3.5 inline mr-1" />Create Incident</button>
              <button className="px-4 py-2 text-xs bg-red-50 border border-red-200 text-red-700 rounded-xl hover:bg-red-100"><RotateCcw className="h-3.5 w-3.5 inline mr-1" />Refund Trip</button>
              <button className="px-4 py-2 text-xs border border-gray-200 rounded-xl hover:bg-gray-50"><Ban className="h-3.5 w-3.5 inline mr-1" />Suspend Driver</button>
              <button className="px-4 py-2 text-xs border border-gray-200 rounded-xl hover:bg-gray-50 ml-auto"><FileSpreadsheet className="h-3.5 w-3.5 inline mr-1" />Export PDF</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}