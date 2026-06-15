"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import {
  RefreshCw, Siren, Phone, MapPin, Clock, AlertCircle, Shield,
  RotateCcw, CheckCircle, ChevronRight, X, Filter, Download,
  User, Car, Navigation, Calendar, TrendingUp, Eye, Flag,
  ChevronDown, Send, PhoneCall, Share2, AlertTriangle, Ban,
  Volume2, VolumeX,
} from "lucide-react";
import { formatCurrency, timeAgo, formatDate } from "@/lib/utils";

// ─── TYPES ──────────────────────────────────────────────────

interface EmergencyStats { active: number; responding: number; resolved_today: number; avg_response_seconds: number; }

interface EmergencyAlert {
  id: string; ride_id?: string; driver_id?: string; rider_id?: string;
  triggered_by?: string; alert_type: string; role?: string; priority?: string;
  status: string; city?: string; latitude?: number; longitude?: number;
  address?: string; description?: string; notes?: string;
  responded_at?: string; resolved_at?: string; resolved_by?: string;
  created_at: string;
  user_name?: string; user_phone?: string;
  rider_name?: string; rider_phone?: string;
  driver_name?: string; driver_phone?: string;
  pickup_address?: string; dropoff_address?: string;
  fare?: number; payment_method?: string; ride_status?: string;
  plate_number?: string; vehicle_make?: string; vehicle_model?: string;
  response_count?: number;
  recent_responses?: EmergencyResponse[];
}

interface EmergencyResponse { id: string; alert_id: string; action: string; notes?: string; created_at: string; }

interface NearbyDriver { driver_id: string; driver_name: string; driver_phone: string; latitude: number; longitude: number; distance_km: number; }

// ─── HELPERS ────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: "bg-red-100 text-red-700 border-red-200",
  responding: "bg-amber-100 text-amber-700 border-amber-200",
  resolved: "bg-green-100 text-green-700 border-green-200",
  false_alarm: "bg-gray-100 text-gray-500 border-gray-200",
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-200 text-red-800",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-blue-100 text-blue-700",
};

const ALERT_TYPE_ICONS: Record<string, string> = {
  accident: "🚨", panic: "🆘", harassment: "⚠️", breakdown: "🔧",
  medical: "🏥", security: "🛡️", fire: "🔥", other: "📢",
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  accident: "Accident", panic: "Panic Button", harassment: "Harassment",
  breakdown: "Breakdown", medical: "Medical", security: "Security Threat",
  fire: "Fire", other: "Other",
};

const ACTION_LABELS: Record<string, string> = {
  called_rider: "Called Rider", called_driver: "Called Driver",
  called_emergency_contact: "Called Emergency Contact",
  assigned_driver: "Assigned Nearby Driver",
  marked_responding: "Marked Responding", marked_resolved: "Marked Resolved",
  escalated: "Escalated", sent_police: "Sent Police/Security",
  marked_false_alarm: "Marked False Alarm",
};

const formatSeconds = (s: number) => {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
};

// ─── PAGE ───────────────────────────────────────────────────

export default function EmergenciesPage() {
  return (
    <PermissionGuard permission="manage_emergencies">
      <EmergenciesContent />
    </PermissionGuard>
  );
}

function EmergenciesContent() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stats
  const [stats, setStats] = useState<EmergencyStats>({ active: 0, responding: 0, resolved_today: 0, avg_response_seconds: 0 });

  // Alerts
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<EmergencyAlert | null>(null);
  const [nearbyDrivers, setNearbyDrivers] = useState<NearbyDriver[]>([]);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [soundOn, setSoundOn] = useState(false);

  // Response
  const [responseNotes, setResponseNotes] = useState("");
  const [processing, setProcessing] = useState(false);

  // ── Fetch ──
  const fetchStats = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_emergency_stats");
      if (data) setStats(data as EmergencyStats);
    } catch { /* */ }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_list_emergencies_enriched", {
        p_status: statusFilter !== "all" ? statusFilter : null,
        p_city: cityFilter !== "all" ? cityFilter : null,
        p_limit: 50,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setAlerts(((data as any)?.data || []) as EmergencyAlert[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }, [statusFilter, cityFilter]);

  const selectAlert = useCallback(async (alert: EmergencyAlert) => {
    setSelectedAlert(alert);
    if (alert.latitude && alert.longitude) {
      try {
        const { data } = await supabase.rpc("admin_get_nearby_drivers", { p_lat: alert.latitude, p_lng: alert.longitude, p_radius_km: 5 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setNearbyDrivers(((data as any)?.data || []) as NearbyDriver[]);
      } catch { setNearbyDrivers([]); }
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    await fetchStats();
    await fetchAlerts();
  }, [fetchStats, fetchAlerts]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Actions ──
  const handleAction = async (alertId: string, action: string) => {
    setProcessing(true);
    try {
      await supabase.rpc("admin_respond_to_emergency", {
        p_alert_id: alertId,
        p_action: action,
        p_notes: responseNotes || null,
      });
      setResponseNotes("");
      fetchAll();
      if (selectedAlert?.id === alertId) {
        // Refresh selected alert
        const { data } = await supabase.rpc("admin_list_emergencies_enriched", { p_limit: 50 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const all = ((data as any)?.data || []) as EmergencyAlert[];
        const updated = all.find(a => a.id === alertId);
        if (updated) setSelectedAlert(updated);
      }
    } catch { /* */ } finally { setProcessing(false); }
  };

  // ─── RENDER ───────────────────────────────────────────────

  return (
    <div className="space-y-6" style={{ padding: 32, background: "#F6F8FB", minHeight: "100vh" }}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4" style={{ minHeight: 72 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "#111827" }}>Emergency Command Center</h1>
          <p style={{ fontSize: 15, color: "#6B7280", marginTop: 4 }}>Live SOS alerts, driver/rider safety, and response tracking</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={cityFilter} onChange={e => setCityFilter(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white" style={{ height: 44 }}>
            <option value="all">All Cities</option>
            <option value="blantyre">Blantyre</option><option value="lilongwe">Lilongwe</option>
            <option value="mzuzu">Mzuzu</option><option value="zomba">Zomba</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white" style={{ height: 44 }}>
            <option value="all">All Status</option>
            <option value="active">Active</option><option value="responding">Responding</option>
            <option value="resolved">Resolved</option><option value="false_alarm">False Alarm</option>
          </select>
          <button onClick={fetchAll} className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50" style={{ height: 44 }}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button onClick={() => setSoundOn(!soundOn)} className={`p-2.5 rounded-xl border text-sm ${soundOn ? "bg-red-50 border-red-200 text-red-600" : "border-gray-200 text-gray-500"}`} style={{ height: 44 }} title="Emergency sound toggle">
            {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <button className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50" style={{ height: 44 }}>
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700"><AlertTriangle className="h-4 w-4 inline mr-1" />{error}</div>}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" style={{ maxWidth: 1040 }}>
        {([
          { label: "Active SOS", value: stats.active, sub: "Requires immediate action", icon: Siren, bg: "bg-red-50", text: "text-red-600", border: "border-red-200" },
          { label: "Responding", value: stats.responding, sub: "Admin/driver responding", icon: Shield, bg: "bg-amber-50", text: "text-amber-600", border: "border-amber-200" },
          { label: "Resolved Today", value: stats.resolved_today, sub: "Closed emergency cases", icon: CheckCircle, bg: "bg-green-50", text: "text-green-600", border: "border-green-200" },
          { label: "Avg Response Time", value: formatSeconds(stats.avg_response_seconds), sub: "From SOS to first response", icon: Clock, bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200" },
        ]).map(c => (
          <div key={c.label} className={`bg-white rounded-2xl border ${c.border} p-5 flex flex-col justify-between`}
            style={{ minHeight: 120, padding: 20, borderRadius: 18, width: 260 }}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${c.bg} ${c.text}`}><c.icon className="h-4.5 w-4.5" /></div>
              <p style={{ fontSize: 13, color: "#6B7280" }} className="font-medium uppercase">{c.label}</p>
            </div>
            <div>
              <p style={{ fontSize: 34, fontWeight: 800, color: "#111827" }}>{typeof c.value === "number" ? String(c.value) : c.value}</p>
              <p style={{ fontSize: 11, color: "#9CA3AF" }}>{c.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-7 gap-6">
        {/* LEFT: Emergency Alert List — 35% */}
        <div className="lg:col-span-3 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Siren className="h-4 w-4 text-red-500" />Live Emergency Alerts</h3>
          {loading ? (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600" /></div>
          ) : alerts.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
              <CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-400" />
              <p className="text-gray-500 text-sm">No active emergencies</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {alerts.map(a => (
                <div key={a.id} onClick={() => selectAlert(a)}
                  className={`bg-white rounded-2xl border-2 p-4 cursor-pointer transition-all hover:shadow-md ${
                    selectedAlert?.id === a.id ? "border-red-400 shadow-lg" : a.status === "active" ? "border-red-200" : "border-gray-200"
                  }`} style={{ minHeight: 150 }}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{ALERT_TYPE_ICONS[a.alert_type] || "📢"}</span>
                      <span className="text-sm font-bold text-gray-900" style={{ fontSize: 16 }}>{ALERT_TYPE_LABELS[a.alert_type] || a.alert_type}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[a.status]}`}>{a.status?.replace(/_/g, " ")}</span>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${PRIORITY_COLORS[a.priority || "medium"]}`}>{a.priority || "medium"}</span>
                    </div>
                  </div>
                  <div className="space-y-1 text-xs text-gray-500">
                    <p className="flex items-center gap-1"><User className="h-3 w-3" />{a.user_name || a.rider_name || a.driver_name || "Unknown"} · {a.user_phone || a.rider_phone || a.driver_phone || "—"}</p>
                    <p className="flex items-center gap-1"><MapPin className="h-3 w-3" />{a.city || "—"} · {a.address || `${a.latitude?.toFixed(5)}, ${a.longitude?.toFixed(5)}`}</p>
                    <p className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(a.created_at)}</p>
                    {a.description && <p className="text-gray-600 mt-1 line-clamp-2">{a.description}</p>}
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={e => { e.stopPropagation(); selectAlert(a); }} className="px-3 py-1.5 text-[11px] bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"><Eye className="h-3 w-3 inline mr-1" />View</button>
                    <button className="px-3 py-1.5 text-[11px] bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"><Phone className="h-3 w-3 inline mr-1" />Call</button>
                    <button className="px-3 py-1.5 text-[11px] bg-green-100 text-green-700 rounded-lg hover:bg-green-200"><User className="h-3 w-3 inline mr-1" />Assign</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: Live Map — 65% */}
        <div className="lg:col-span-4">
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden" style={{ height: 600 }}>
            <div className="relative w-full h-full bg-slate-100 flex flex-col items-center justify-center">
              {selectedAlert?.latitude ? (
                <>
                  <div className="absolute inset-0 p-4">
                    <svg viewBox="0 0 400 400" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
                      {/* Map grid */}
                      {Array.from({ length: 8 }, (_, i) => (
                        <line key={`h${i}`} x1={0} y1={i * 50} x2={400} y2={i * 50} stroke="#e5e7eb" strokeWidth="0.5" />
                      ))}
                      {Array.from({ length: 8 }, (_, i) => (
                        <line key={`v${i}`} x1={i * 50} y1={0} x2={i * 50} y2={400} stroke="#e5e7eb" strokeWidth="0.5" />
                      ))}
                      {/* SOS Pin */}
                      <circle cx={200} cy={200} r="8" fill="#DC2626" stroke="white" strokeWidth="3" />
                      <circle cx={200} cy={200} r="16" fill="none" stroke="#DC2626" strokeWidth="2" opacity="0.4">
                        <animate attributeName="r" from="16" to="30" dur="1.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" from="0.4" to="0" dur="1.5s" repeatCount="indefinite" />
                      </circle>
                      <text x={200} y={185} textAnchor="middle" fill="#DC2626" fontSize="11" fontWeight="bold">SOS</text>
                      {/* Nearby drivers */}
                      {nearbyDrivers.slice(0, 5).map((d, i) => {
                        const angle = (i / 5) * 360;
                        const rad = (angle - 90) * Math.PI / 180;
                        const dx = 200 + Math.cos(rad) * 80;
                        const dy = 200 + Math.sin(rad) * 80;
                        return (
                          <g key={d.driver_id}>
                            <circle cx={dx} cy={dy} r="5" fill="#3b82f6" stroke="white" strokeWidth="1.5" />
                            <text x={dx} y={dy - 8} textAnchor="middle" fontSize="8" fill="#3b82f6" fontWeight="bold">🚗</text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                  {/* Map info overlay */}
                  <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
                    <div className="bg-white/90 rounded-lg px-3 py-1.5 text-[10px]">
                      <span className="font-semibold text-red-600">SOS Location</span>
                      <span className="text-gray-500 ml-2">{selectedAlert.latitude?.toFixed(5)}, {selectedAlert.longitude?.toFixed(5)}</span>
                    </div>
                    <div className="bg-white/90 rounded-lg px-3 py-1.5 text-[10px] text-gray-500">
                      {nearbyDrivers.length} nearby drivers
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center text-gray-400">
                  <MapPin className="h-16 w-16 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">Select an alert to view location</p>
                  <p className="text-xs mt-1">Emergency location will appear here</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Emergency Detail Drawer ── */}
      {selectedAlert && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedAlert(null)} />
          <div className="relative ml-auto bg-white h-full shadow-2xl overflow-y-auto" style={{ width: 480, padding: 24 }}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Alert #{selectedAlert.id?.slice(0, 8)}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[selectedAlert.status]}`}>{selectedAlert.status?.replace(/_/g, " ")}</span>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${PRIORITY_COLORS[selectedAlert.priority || "medium"]}`}>{selectedAlert.priority || "medium"}</span>
                </div>
              </div>
              <button onClick={() => setSelectedAlert(null)} className="p-2 hover:bg-gray-100 rounded-xl"><X className="h-5 w-5 text-gray-400" /></button>
            </div>

            <div className="space-y-4">
              {/* Alert Summary */}
              <div className="bg-gray-50 rounded-2xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-2"><Siren className="h-3.5 w-3.5" />Alert Summary</h4>
                <div className="space-y-1.5 text-xs">
                  {[
                    { l: "Alert ID", v: selectedAlert.id?.slice(0, 12), mono: true },
                    { l: "Type", v: `${ALERT_TYPE_ICONS[selectedAlert.alert_type] || ""} ${ALERT_TYPE_LABELS[selectedAlert.alert_type] || selectedAlert.alert_type}` },
                    { l: "Triggered By", v: selectedAlert.role === "driver" ? "Driver" : "Rider" },
                    { l: "Time", v: formatDate(selectedAlert.created_at) },
                    { l: "City", v: selectedAlert.city || "—" },
                    { l: "Ride ID", v: selectedAlert.ride_id?.slice(0, 8) || "No active ride" },
                  ].map(f => (
                    <div key={f.l} className="flex justify-between"><span className="text-gray-400">{f.l}</span><span className={`text-gray-700 ${f.mono ? "font-mono" : ""}`}>{f.v}</span></div>
                  ))}
                </div>
                {selectedAlert.description && <p className="text-xs text-gray-600 mt-2 bg-white p-2 rounded-lg">{selectedAlert.description}</p>}
              </div>

              {/* User Details */}
              <div className="bg-gray-50 rounded-2xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-2"><User className="h-3.5 w-3.5" />User Details</h4>
                <div className="space-y-1.5 text-xs">
                  {[
                    { l: "Name", v: selectedAlert.user_name || selectedAlert.rider_name || selectedAlert.driver_name || "—" },
                    { l: "Phone", v: selectedAlert.user_phone || selectedAlert.rider_phone || selectedAlert.driver_phone || "—" },
                    { l: "Role", v: selectedAlert.role || "Rider" },
                  ].map(f => (
                    <div key={f.l} className="flex justify-between"><span className="text-gray-400">{f.l}</span><span className="text-gray-700 font-medium">{f.v}</span></div>
                  ))}
                </div>
              </div>

              {/* Trip Details (if connected) */}
              {selectedAlert.ride_id && (
                <div className="bg-gray-50 rounded-2xl p-4">
                  <h4 className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-2"><Car className="h-3.5 w-3.5" />Trip Details</h4>
                  <div className="space-y-1.5 text-xs">
                    {[
                      { l: "Pickup", v: selectedAlert.pickup_address || "—" },
                      { l: "Drop-off", v: selectedAlert.dropoff_address || "—" },
                      { l: "Driver", v: selectedAlert.driver_name || "—" },
                      { l: "Vehicle", v: `${selectedAlert.plate_number || "—"} ${selectedAlert.vehicle_make || ""} ${selectedAlert.vehicle_model || ""}` },
                      { l: "Fare", v: selectedAlert.fare ? formatCurrency(selectedAlert.fare) : "—" },
                      { l: "Status", v: selectedAlert.ride_status || "—" },
                    ].map(f => (
                      <div key={f.l} className="flex justify-between"><span className="text-gray-400">{f.l}</span><span className="text-gray-700">{f.v}</span></div>
                    ))}
                  </div>
                </div>
              )}

              {/* Location */}
              <div className="bg-gray-50 rounded-2xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-2"><MapPin className="h-3.5 w-3.5" />Location</h4>
                <div className="space-y-1.5 text-xs">
                  {[
                    { l: "Coordinates", v: `${selectedAlert.latitude?.toFixed(6) || "—"}, ${selectedAlert.longitude?.toFixed(6) || "—"}` },
                    { l: "Address", v: selectedAlert.address || "—" },
                    { l: "Nearby Drivers", v: `${nearbyDrivers.length} online nearby` },
                  ].map(f => (
                    <div key={f.l} className="flex justify-between"><span className="text-gray-400">{f.l}</span><span className="text-gray-700 font-mono">{f.v}</span></div>
                  ))}
                </div>
              </div>

              {/* Nearby Drivers */}
              {nearbyDrivers.length > 0 && (
                <div className="bg-gray-50 rounded-2xl p-4">
                  <h4 className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-2"><Navigation className="h-3.5 w-3.5" />Nearby Drivers</h4>
                  <div className="space-y-1">
                    {nearbyDrivers.slice(0, 4).map(d => (
                      <div key={d.driver_id} className="flex items-center justify-between text-xs py-1">
                        <span className="font-medium text-gray-700">{d.driver_name}</span>
                        <span className="text-gray-400">{d.distance_km} km</span>
                        <button className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px]">Assign</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Response Timeline */}
              {selectedAlert.recent_responses && selectedAlert.recent_responses.length > 0 && (
                <div className="bg-gray-50 rounded-2xl p-4">
                  <h4 className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-2"><Clock className="h-3.5 w-3.5" />Response Timeline</h4>
                  <div className="space-y-2">
                    {selectedAlert.recent_responses.map((r, i) => (
                      <div key={r.id} className="flex gap-2 text-xs">
                        <div className={`w-1.5 h-1.5 rounded-full mt-1 ${i === 0 ? "bg-red-500" : "bg-gray-300"}`} />
                        <div className="flex-1">
                          <p className="font-medium text-gray-700">{ACTION_LABELS[r.action] || r.action}</p>
                          <p className="text-gray-400">{timeAgo(r.created_at)}</p>
                          {r.notes && <p className="text-gray-500 italic">{r.notes}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Response Notes */}
              <div>
                <textarea value={responseNotes} onChange={e => setResponseNotes(e.target.value)} placeholder="Add response notes..." rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500 focus:outline-none" />
              </div>
            </div>

            {/* Emergency Actions */}
            <div className="mt-6 pt-4 border-t border-gray-100 space-y-3">
              <h4 className="text-xs font-semibold text-gray-500">Emergency Actions</h4>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { action: "marked_responding", label: "Mark Responding", color: "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100", icon: Shield },
                  { action: "marked_resolved", label: "Mark Resolved", color: "bg-green-50 border-green-200 text-green-700 hover:bg-green-100", icon: CheckCircle },
                  { action: "marked_false_alarm", label: "False Alarm", color: "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100", icon: Ban },
                  { action: "called_rider", label: "Call Rider", color: "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100", icon: Phone },
                  { action: "called_driver", label: "Call Driver", color: "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100", icon: Phone },
                  { action: "called_emergency_contact", label: "Call Emergency", color: "bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100", icon: PhoneCall },
                  { action: "assigned_driver", label: "Assign Driver", color: "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100", icon: Navigation },
                  { action: "escalated", label: "Escalate", color: "bg-red-50 border-red-200 text-red-700 hover:bg-red-100", icon: Flag },
                ].map(btn => (
                  <button key={btn.action} onClick={() => handleAction(selectedAlert.id, btn.action)} disabled={processing}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium disabled:opacity-50 ${btn.color}`}>
                    <btn.icon className="h-3.5 w-3.5" />{btn.label}
                  </button>
                ))}
              </div>
              <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700">
                <Send className="h-4 w-4" /> Send Police/Security
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}