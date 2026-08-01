"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Activity,
  Ban,
  BarChart3,
  Building2,
  CheckCircle,
  Clock,
  Edit,
  Eye,
  MapPin,
  Plane,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Trash2,
  TrendingUp,
  Users,
  X,
  Zap,
} from "lucide-react";
import { ApiErrorDisplay, EmptyState, ErrorBoundary } from "@/components/ErrorBoundary";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { useAuth } from "@/lib/auth-context";
import {
  DEFAULT_AIRPORT_FEES,
  DEFAULT_AUTO_SURGE_RULES,
  DEFAULT_PRICING_RULES,
  DEFAULT_RESTRICTED_RULES,
  DEFAULT_SURGE_SETTINGS,
  deleteServiceZone,
  fetchServiceZoneAuditLogs,
  fetchServiceZones,
  saveServiceZone,
  setManualSurge,
  updateServiceZoneStatus,
  type AirportFeeSettings,
  type AutomaticSurgeRules,
  type RestrictedZoneRules,
  type ServiceZone,
  type ServiceZoneAuditLog,
  type ServiceZonePayload,
  type ServiceZoneType,
  type SurgeSettings,
  type ZoneCoordinate,
  type ZonePricingRules,
  type ZoneStatus,
} from "@/lib/api/service-zones";

const ServiceZonesMap = dynamic(() => import("./ServiceZonesMap"), {
  ssr: false,
  loading: () => <div className="flex min-h-[520px] items-center justify-center rounded-2xl border bg-white"><RefreshCw className="h-7 w-7 animate-spin text-green-600" /></div>,
});

const inputClass = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500";

const ZONE_TYPES: Array<{ type: ServiceZoneType; label: string; icon: any; color: string; description: string }> = [
  { type: "operating", label: "Operating", icon: Building2, color: "bg-green-50 text-green-700 border-green-200", description: "Normal pickup/dropoff service area" },
  { type: "airport", label: "Airport", icon: Plane, color: "bg-blue-50 text-blue-700 border-blue-200", description: "Airport fees and queue rules" },
  { type: "surge", label: "Surge", icon: TrendingUp, color: "bg-amber-50 text-amber-700 border-amber-200", description: "Demand-based multiplier zone" },
  { type: "restricted", label: "Restricted", icon: Ban, color: "bg-red-50 text-red-700 border-red-200", description: "Pickup/dropoff/entry controls" },
];

const CITY_OPTIONS = ["Lilongwe", "Blantyre", "Mzuzu", "Zomba", "Mangochi", "Kasungu", "Salima", "Karonga"];

type PanelMode = "overview" | "drivers" | "trips" | "analytics" | "audit";

function emptyPayload(): ServiceZonePayload {
  return {
    name: "",
    city: "Lilongwe",
    zone_type: "operating",
    status: "active",
    description: "",
    center_lat: null,
    center_lng: null,
    boundary_coordinates: [],
    pricing_rules: { ...DEFAULT_PRICING_RULES },
    airport_fees: { ...DEFAULT_AIRPORT_FEES },
    surge_settings: { ...DEFAULT_SURGE_SETTINGS },
    restricted_rules: { ...DEFAULT_RESTRICTED_RULES },
    auto_surge_rules: { ...DEFAULT_AUTO_SURGE_RULES },
    metadata: {},
  };
}

function payloadFromZone(zone: ServiceZone): ServiceZonePayload {
  return {
    name: zone.name,
    city: zone.city,
    zone_type: zone.zone_type,
    status: zone.status,
    description: zone.description || "",
    center_lat: zone.center_lat,
    center_lng: zone.center_lng,
    boundary_coordinates: [...zone.boundary_coordinates],
    pricing_rules: { ...DEFAULT_PRICING_RULES, ...zone.pricing_rules },
    airport_fees: { ...DEFAULT_AIRPORT_FEES, ...zone.airport_fees },
    surge_settings: { ...DEFAULT_SURGE_SETTINGS, ...zone.surge_settings },
    restricted_rules: { ...DEFAULT_RESTRICTED_RULES, ...zone.restricted_rules },
    auto_surge_rules: { ...DEFAULT_AUTO_SURGE_RULES, ...zone.auto_surge_rules },
    metadata: zone.metadata || {},
  };
}

function money(value: number | null | undefined) {
  return `MWK ${Number(value || 0).toLocaleString()}`;
}

function typeInfo(type: ServiceZoneType) {
  return ZONE_TYPES.find((item) => item.type === type) || ZONE_TYPES[0];
}

function statusColor(status: ZoneStatus) {
  if (status === "active") return "bg-green-100 text-green-800";
  if (status === "draft") return "bg-amber-100 text-amber-800";
  return "bg-gray-100 text-gray-700";
}

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function boundaryText(coordinates: ZoneCoordinate[]) {
  return coordinates.map((point) => `${point.lat},${point.lng}`).join("\n");
}

function parseBoundaryText(text: string): ZoneCoordinate[] {
  return text.split(/\n|;/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [lat, lng] = line.split(",").map((part) => Number(part.trim()));
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }).filter(Boolean) as ZoneCoordinate[];
}

export default function ServiceZonesPage() {
  return (
    <PermissionGuard permission="manage_rides">
      <ErrorBoundary>
        <ServiceZonesContent />
      </ErrorBoundary>
    </PermissionGuard>
  );
}

function ServiceZonesContent() {
  const { adminProfile } = useAuth();
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [audits, setAudits] = useState<ServiceZoneAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCity, setFilterCity] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [selectedZone, setSelectedZone] = useState<ServiceZone | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>("overview");
  const [showModal, setShowModal] = useState(false);
  const [editingZone, setEditingZone] = useState<ServiceZone | null>(null);
  const [form, setForm] = useState<ServiceZonePayload>(() => emptyPayload());
  const [boundaryEditor, setBoundaryEditor] = useState("");

  const admin = useMemo(() => ({ id: adminProfile?.id || null, email: adminProfile?.email || null }), [adminProfile]);

  const loadZones = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchServiceZones({ search, city: filterCity, status: filterStatus, type: filterType });
    if (result.error) setError(result.error);
    setZones(result.data);
    setSelectedZone((current) => result.data.find((zone) => zone.id === current?.id) || result.data[0] || null);
    setLoading(false);
  }, [search, filterCity, filterStatus, filterType]);

  const loadAudits = useCallback(async (zoneId?: string) => {
    const result = await fetchServiceZoneAuditLogs(zoneId);
    if (!result.error) setAudits(result.data);
  }, []);

  useEffect(() => { loadZones(); }, [loadZones]);
  useEffect(() => { if (panelMode === "audit") loadAudits(selectedZone?.id); }, [panelMode, selectedZone?.id, loadAudits]);

  const cities = useMemo(() => Array.from(new Set([...CITY_OPTIONS, ...zones.map((zone) => zone.city).filter(Boolean)])).sort(), [zones]);
  const stats = useMemo(() => ({
    total: zones.length,
    active: zones.filter((zone) => zone.status === "active").length,
    disabled: zones.filter((zone) => zone.status === "disabled").length,
    polygons: zones.filter((zone) => zone.boundary_coordinates.length >= 3).length,
    totalDrivers: zones.reduce((sum, zone) => sum + (zone.metrics?.online_drivers || 0), 0),
    demand: zones.reduce((sum, zone) => sum + (zone.metrics?.demand_24h || 0), 0),
    manualSurge: zones.filter((zone) => zone.surge_settings.manual_active).length,
  }), [zones]);

  function openCreate() {
    const next = emptyPayload();
    setEditingZone(null);
    setForm(next);
    setBoundaryEditor("");
    setShowModal(true);
  }

  function openEdit(zone: ServiceZone) {
    const next = payloadFromZone(zone);
    setEditingZone(zone);
    setForm(next);
    setBoundaryEditor(boundaryText(next.boundary_coordinates));
    setSelectedZone(zone);
    setShowModal(true);
  }

  function updateForm<K extends keyof ServiceZonePayload>(key: K, value: ServiceZonePayload[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }
  function updatePricing(key: keyof ZonePricingRules, value: number) { setForm((prev) => ({ ...prev, pricing_rules: { ...prev.pricing_rules, [key]: value } })); }
  function updateAirport(key: keyof AirportFeeSettings, value: number | boolean) { setForm((prev) => ({ ...prev, airport_fees: { ...prev.airport_fees, [key]: value } })); }
  function updateSurge(key: keyof SurgeSettings, value: number | boolean | string | null) { setForm((prev) => ({ ...prev, surge_settings: { ...prev.surge_settings, [key]: value } })); }
  function updateRestricted(key: keyof RestrictedZoneRules, value: boolean | string) { setForm((prev) => ({ ...prev, restricted_rules: { ...prev.restricted_rules, [key]: value } })); }
  function updateAutoSurge(key: keyof AutomaticSurgeRules, value: number | boolean) { setForm((prev) => ({ ...prev, auto_surge_rules: { ...prev.auto_surge_rules, [key]: value } })); }

  function applyDraftCoordinates(coordinates: ZoneCoordinate[]) {
    setForm((prev) => {
      const center = coordinates.length ? coordinates.reduce((acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }), { lat: 0, lng: 0 }) : null;
      return {
        ...prev,
        boundary_coordinates: coordinates,
        center_lat: center ? Number((center.lat / coordinates.length).toFixed(6)) : prev.center_lat,
        center_lng: center ? Number((center.lng / coordinates.length).toFixed(6)) : prev.center_lng,
      };
    });
    setBoundaryEditor(boundaryText(coordinates));
  }

  async function handleSave() {
    if (!form.name.trim()) return setError("Zone name is required");
    if (!form.city.trim()) return setError("City is required");
    if (form.boundary_coordinates.length < 3) return setError("Please add at least 3 polygon points for the zone boundary before saving.");
    setSaving(true);
    setError(null);
    const result = await saveServiceZone({ ...form, name: form.name.trim(), city: form.city.trim() }, editingZone?.id, admin);
    setSaving(false);
    if (result.error) return setError(result.error);
    setShowModal(false);
    setEditingZone(null);
    setBoundaryEditor("");
    await loadZones();
    if (result.data) setSelectedZone(result.data);
  }

  async function handleStatus(zone: ServiceZone, status: ZoneStatus) {
    if (!confirm(`Are you sure you want to ${status === "disabled" ? "disable" : "activate"} ${zone.name}?`)) return;
    const result = await updateServiceZoneStatus(zone, status, admin);
    if (result.error) setError(result.error);
    await loadZones();
  }

  async function handleDelete(zone: ServiceZone) {
    if (!confirm(`Delete ${zone.name}? This removes pricing, boundary, queue, surge and restriction settings for this zone.`)) return;
    const result = await deleteServiceZone(zone, admin);
    if (result.error) setError(result.error);
    setSelectedZone(null);
    await loadZones();
  }

  async function handleManualSurge(zone: ServiceZone, active: boolean) {
    const result = await setManualSurge(zone, active, admin);
    if (result.error) setError(result.error);
    await loadZones();
  }

  const selectedInfo = selectedZone ? typeInfo(selectedZone.zone_type) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Service Zones</h1>
          <p className="mt-1 text-gray-500">Supabase-backed zone operations, boundary polygons, pricing, surge, restrictions, airport queues and live metrics.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={loadZones} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
          <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"><Plus className="h-4 w-4" /> Add Zone</button>
        </div>
      </div>

      <ApiErrorDisplay error={error} onRetry={loadZones} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-7">
        <StatCard icon={MapPin} label="Zones" value={stats.total} />
        <StatCard icon={CheckCircle} label="Active" value={stats.active} tone="green" />
        <StatCard icon={Ban} label="Disabled" value={stats.disabled} tone="gray" />
        <StatCard icon={ShieldAlert} label="Polygons" value={`${stats.polygons}/${stats.total}`} tone="blue" />
        <StatCard icon={Users} label="Live Drivers" value={stats.totalDrivers} tone="green" />
        <StatCard icon={Activity} label="Demand 24h" value={stats.demand} tone="amber" />
        <StatCard icon={Zap} label="Manual Surge" value={stats.manualSurge} tone="amber" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(360px,0.9fr)_minmax(640px,1.4fr)]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="relative md:col-span-2"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search zone, city, description..." className="w-full rounded-xl border border-gray-200 py-2 pl-10 pr-4 text-sm outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100" /></div>
              <select value={filterCity} onChange={(event) => setFilterCity(event.target.value)} className={inputClass}><option value="all">All cities</option>{cities.map((city) => <option key={city} value={city}>{city}</option>)}</select>
              <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)} className={inputClass}><option value="all">All statuses</option><option value="active">Active</option><option value="draft">Draft</option><option value="disabled">Disabled</option></select>
              <select value={filterType} onChange={(event) => setFilterType(event.target.value)} className={`${inputClass} md:col-span-2`}><option value="all">All zone types</option>{ZONE_TYPES.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select>
            </div>
          </div>

          <div className="space-y-3">
            {loading ? <div className="flex h-40 items-center justify-center rounded-2xl border border-gray-200 bg-white"><RefreshCw className="h-7 w-7 animate-spin text-green-600" /></div> : zones.length === 0 ? <div className="rounded-2xl border border-gray-200 bg-white"><EmptyState icon={MapPin} title="No service zones" description="Add your first zone and draw its map boundary." /></div> : zones.map((zone) => {
              const info = typeInfo(zone.zone_type);
              const Icon = info.icon;
              return (
                <button key={zone.id} onClick={() => { setSelectedZone(zone); setPanelMode("overview"); }} className={`w-full rounded-2xl border bg-white p-4 text-left transition hover:border-green-300 hover:shadow-sm ${selectedZone?.id === zone.id ? "border-green-400 ring-2 ring-green-100" : "border-gray-200"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3"><div className={`rounded-xl border p-2 ${info.color}`}><Icon className="h-5 w-5" /></div><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-gray-900">{zone.name}</h3><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${statusColor(zone.status)}`}>{zone.status}</span></div><p className="mt-1 text-xs text-gray-500"><MapPin className="mr-1 inline h-3 w-3" />{zone.city} · {info.description}</p></div></div>
                    <div className="text-right text-xs text-gray-500"><p className="font-semibold text-gray-900">x{zone.surge_settings.multiplier || 1}</p><p>Surge</p></div>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs"><Metric label="Drivers" value={zone.metrics?.online_drivers || 0} /><Metric label="Trips" value={zone.metrics?.trips_24h || 0} /><Metric label="Demand" value={zone.metrics?.demand_24h || 0} /><Metric label="Points" value={zone.boundary_coordinates.length} /></div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <ServiceZonesMap zones={zones} selectedZoneId={selectedZone?.id || null} onSelectZone={(zone) => { setSelectedZone(zone); setPanelMode("overview"); }} />

          {selectedZone && selectedInfo && (
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold text-gray-900">{selectedZone.name}</h2><span className={`rounded-full border px-2 py-1 text-xs font-semibold ${selectedInfo.color}`}>{selectedInfo.label}</span><span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${statusColor(selectedZone.status)}`}>{selectedZone.status}</span>{selectedZone.surge_settings.manual_active && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Manual surge active</span>}</div><p className="mt-1 text-sm text-gray-500">{selectedZone.description || "No description"}</p></div>
                <div className="flex flex-wrap gap-2"><button onClick={() => openEdit(selectedZone)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50"><Edit className="h-3.5 w-3.5" /> Edit</button>{selectedZone.status === "active" ? <button onClick={() => handleStatus(selectedZone, "disabled")} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50"><Ban className="h-3.5 w-3.5" /> Disable</button> : <button onClick={() => handleStatus(selectedZone, "active")} className="inline-flex items-center gap-1 rounded-lg border border-green-200 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-50"><CheckCircle className="h-3.5 w-3.5" /> Activate</button>}<button onClick={() => handleManualSurge(selectedZone, !selectedZone.surge_settings.manual_active)} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50"><Zap className="h-3.5 w-3.5" /> {selectedZone.surge_settings.manual_active ? "Stop Surge" : "Start Surge"}</button><button onClick={() => handleDelete(selectedZone)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button></div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2 border-b border-gray-100 pb-3">
                {[["overview", Eye, "Overview"], ["drivers", Users, "View Drivers"], ["trips", Clock, "View Trips"], ["analytics", BarChart3, "Analytics"], ["audit", ShieldAlert, "Audit Logs"]].map(([mode, Icon, label]) => <button key={mode as string} onClick={() => setPanelMode(mode as PanelMode)} className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold ${panelMode === mode ? "bg-green-100 text-green-800" : "text-gray-600 hover:bg-gray-50"}`}><Icon className="h-3.5 w-3.5" />{label as string}</button>)}
              </div>

              {panelMode === "overview" && <OverviewPanel zone={selectedZone} />}
              {panelMode === "drivers" && <DriversPanel zone={selectedZone} />}
              {panelMode === "trips" && <TripsPanel zone={selectedZone} />}
              {panelMode === "analytics" && <AnalyticsPanel zone={selectedZone} />}
              {panelMode === "audit" && <AuditPanel audits={audits} onReload={() => loadAudits(selectedZone.id)} />}
            </div>
          )}
        </div>
      </div>

      {showModal && <ZoneModal editingZone={editingZone} form={form} zones={zones} cities={cities} boundaryEditor={boundaryEditor} saving={saving} setBoundaryEditor={setBoundaryEditor} updateForm={updateForm} updatePricing={updatePricing} updateAirport={updateAirport} updateSurge={updateSurge} updateRestricted={updateRestricted} updateAutoSurge={updateAutoSurge} applyDraftCoordinates={applyDraftCoordinates} onClose={() => { setShowModal(false); setEditingZone(null); }} onSave={handleSave} />}
    </div>
  );
}

function ZoneModal({ editingZone, form, zones, cities, boundaryEditor, saving, setBoundaryEditor, updateForm, updatePricing, updateAirport, updateSurge, updateRestricted, updateAutoSurge, applyDraftCoordinates, onClose, onSave }: any) {
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [drawingMode, setDrawingMode] = useState(true);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-6 w-full max-w-6xl rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4"><div><h2 className="text-lg font-bold text-gray-900">{editingZone ? "Edit Zone" : "Add Zone"}</h2><p className="text-sm text-gray-500">Configure Supabase zone data, polygon boundaries, fees, pricing, surge and rules.</p></div><button onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button></div>
        <div className="grid gap-6 p-6 xl:grid-cols-[1fr_0.9fr]">
          <div className="space-y-6">
            <Section title="Zone details" icon={Settings2}><div className="grid gap-4 md:grid-cols-2"><Field label="Zone name"><input value={form.name} onChange={(e) => updateForm("name", e.target.value)} className={inputClass} /></Field><Field label="City"><input value={form.city} onChange={(e) => updateForm("city", e.target.value)} list="zone-cities" className={inputClass} /><datalist id="zone-cities">{cities.map((city) => <option key={city} value={city} />)}</datalist></Field><Field label="Type"><select value={form.zone_type} onChange={(e) => updateForm("zone_type", e.target.value)} className={inputClass}>{ZONE_TYPES.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select></Field><Field label="Status"><select value={form.status} onChange={(e) => updateForm("status", e.target.value)} className={inputClass}><option value="active">Active</option><option value="draft">Draft</option><option value="disabled">Disabled</option></select></Field><Field label="Description"><textarea value={form.description || ""} onChange={(e) => updateForm("description", e.target.value)} className={`${inputClass} min-h-20 md:col-span-2`} /></Field><Field label="Center latitude"><input type="number" step="0.000001" value={form.center_lat ?? ""} onChange={(e) => updateForm("center_lat", e.target.value ? Number(e.target.value) : null)} className={inputClass} /></Field><Field label="Center longitude"><input type="number" step="0.000001" value={form.center_lng ?? ""} onChange={(e) => updateForm("center_lng", e.target.value ? Number(e.target.value) : null)} className={inputClass} /></Field></div></Section>
            <Section title="Zone pricing rules" icon={BarChart3}><div className="grid gap-4 md:grid-cols-4"><MoneyField label="Base fare" value={form.pricing_rules.base_fare} onChange={(v) => updatePricing("base_fare", v)} /><MoneyField label="Per km" value={form.pricing_rules.per_km} onChange={(v) => updatePricing("per_km", v)} /><MoneyField label="Per minute" value={form.pricing_rules.per_minute} onChange={(v) => updatePricing("per_minute", v)} /><MoneyField label="Minimum fare" value={form.pricing_rules.minimum_fare} onChange={(v) => updatePricing("minimum_fare", v)} /></div></Section>
            <Section title="Airport pickup/dropoff and queue" icon={Plane}><div className="grid gap-4 md:grid-cols-4"><MoneyField label="Pickup fee" value={form.airport_fees.pickup_fee} onChange={(v) => updateAirport("pickup_fee", v)} /><MoneyField label="Dropoff fee" value={form.airport_fees.dropoff_fee} onChange={(v) => updateAirport("dropoff_fee", v)} /><Field label="Queue capacity"><input type="number" value={form.airport_fees.queue_capacity} onChange={(e) => updateAirport("queue_capacity", numberValue(e.target.value))} className={inputClass} /></Field><Toggle label="Airport queue enabled" checked={form.airport_fees.queue_enabled} onChange={(v) => updateAirport("queue_enabled", v)} /></div></Section>
            <Section title="Surge multiplier settings" icon={Zap}><div className="grid gap-4 md:grid-cols-5"><Toggle label="Surge enabled" checked={form.surge_settings.enabled} onChange={(v) => updateSurge("enabled", v)} /><Toggle label="Manual active" checked={form.surge_settings.manual_active} onChange={(v) => updateSurge("manual_active", v)} /><Field label="Multiplier"><input type="number" step="0.05" min="1" value={form.surge_settings.multiplier} onChange={(e) => updateSurge("multiplier", numberValue(e.target.value))} className={inputClass} /></Field><Field label="Starts at"><input type="datetime-local" value={form.surge_settings.starts_at?.slice(0, 16) || ""} onChange={(e) => updateSurge("starts_at", e.target.value ? new Date(e.target.value).toISOString() : null)} className={inputClass} /></Field><Field label="Ends at"><input type="datetime-local" value={form.surge_settings.ends_at?.slice(0, 16) || ""} onChange={(e) => updateSurge("ends_at", e.target.value ? new Date(e.target.value).toISOString() : null)} className={inputClass} /></Field></div></Section>
            <Section title="Automatic surge rules" icon={Radio}><div className="grid gap-4 md:grid-cols-4"><Toggle label="Auto surge enabled" checked={form.auto_surge_rules.enabled} onChange={(v) => updateAutoSurge("enabled", v)} /><Field label="Min demand"><input type="number" value={form.auto_surge_rules.min_demand_requests} onChange={(e) => updateAutoSurge("min_demand_requests", numberValue(e.target.value))} className={inputClass} /></Field><Field label="Shortage ratio"><input type="number" step="0.1" value={form.auto_surge_rules.min_driver_shortage_ratio} onChange={(e) => updateAutoSurge("min_driver_shortage_ratio", numberValue(e.target.value))} className={inputClass} /></Field><Field label="Auto multiplier"><input type="number" step="0.05" value={form.auto_surge_rules.multiplier} onChange={(e) => updateAutoSurge("multiplier", numberValue(e.target.value))} className={inputClass} /></Field></div></Section>
            <Section title="Restricted-zone rules" icon={ShieldAlert}><div className="grid gap-4 md:grid-cols-4"><Toggle label="No pickup" checked={form.restricted_rules.no_pickup} onChange={(v) => updateRestricted("no_pickup", v)} /><Toggle label="No dropoff" checked={form.restricted_rules.no_dropoff} onChange={(v) => updateRestricted("no_dropoff", v)} /><Toggle label="No entry" checked={form.restricted_rules.no_entry} onChange={(v) => updateRestricted("no_entry", v)} /><Field label="Reason"><input value={form.restricted_rules.reason} onChange={(e) => updateRestricted("reason", e.target.value)} className={inputClass} /></Field></div></Section>
          </div>
          <div className="space-y-4"><Section title="Draw zone boundary" icon={MapPin}><ServiceZonesMap zones={editingZone ? zones.filter((zone) => zone.id !== editingZone.id) : zones} draftCoordinates={form.boundary_coordinates} drawingEnabled={drawingMode} onDraftCoordinatesChange={applyDraftCoordinates} /><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => setDrawingMode(true)} className="rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700">Draw Zone</button><button onClick={() => setDrawingMode(false)} className="rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-gray-50">Finish Drawing</button><button onClick={() => applyDraftCoordinates(form.boundary_coordinates.slice(0, -1))} className="rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-gray-50">Undo Point</button><button onClick={() => applyDraftCoordinates([])} className="rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-gray-50">Reset Polygon</button><span className={`rounded-lg px-3 py-2 text-xs font-semibold ${form.boundary_coordinates.length >= 3 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{form.boundary_coordinates.length} points</span></div><p className="mt-3 text-xs text-gray-500">Click the map to draw the service area. Add at least 3 points, then click Finish Drawing before saving.</p><button type="button" onClick={() => setShowCoordinates(!showCoordinates)} className="mt-3 text-xs font-semibold text-green-700 hover:text-green-800">Advanced: {showCoordinates ? "Hide coordinates" : "View coordinates"}</button>{showCoordinates && <Field label="Polygon coordinates"><textarea value={boundaryEditor} onChange={(e) => { setBoundaryEditor(e.target.value); applyDraftCoordinates(parseBoundaryText(e.target.value)); }} className={`${inputClass} mt-2 min-h-32 font-mono text-xs`} placeholder="-13.9626,33.7741" /></Field>}</Section></div>
        </div>
        <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:justify-end"><button onClick={onClose} className="rounded-xl border px-5 py-2 text-sm font-semibold hover:bg-gray-50">Cancel</button><button onClick={onSave} disabled={saving} className="rounded-xl bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60">{saving ? "Saving..." : editingZone ? "Save changes" : "Add zone"}</button></div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone = "default" }: { icon: any; label: string; value: string | number; tone?: "default" | "green" | "amber" | "blue" | "gray" }) {
  const tones = { default: "bg-white text-gray-900", green: "bg-green-50 text-green-800 border-green-200", amber: "bg-amber-50 text-amber-800 border-amber-200", blue: "bg-blue-50 text-blue-800 border-blue-200", gray: "bg-gray-50 text-gray-700" };
  return <div className={`rounded-2xl border border-gray-200 p-4 ${tones[tone]}`}><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-500"><Icon className="h-4 w-4" />{label}</div><p className="text-2xl font-bold">{value}</p></div>;
}
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-lg bg-gray-50 px-2 py-2"><p className="font-bold text-gray-900">{value}</p><p className="text-[11px] text-gray-500">{label}</p></div>; }
function Section({ title, icon: Icon, children }: { title: string; icon: any; children: ReactNode }) { return <div className="rounded-2xl border border-gray-200 bg-white p-4"><div className="mb-4 flex items-center gap-2"><Icon className="h-4 w-4 text-green-600" /><h3 className="font-bold text-gray-900">{title}</h3></div>{children}</div>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className={labelClass}>{label}</span>{children}</label>; }
function MoneyField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <Field label={label}><input type="number" min="0" value={value} onChange={(e) => onChange(numberValue(e.target.value))} className={inputClass} /></Field>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="flex min-h-[64px] items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700"><span>{label}</span><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-green-600" /></label>; }
function InfoBox({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-gray-100 bg-gray-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p><p className="mt-2 text-sm font-bold text-gray-900">{value}</p></div>; }
function OverviewPanel({ zone }: { zone: ServiceZone }) { return <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><InfoBox label="Base fare" value={money(zone.pricing_rules.base_fare)} /><InfoBox label="Per km / minute" value={`${money(zone.pricing_rules.per_km)} / ${money(zone.pricing_rules.per_minute)}`} /><InfoBox label="Minimum fare" value={money(zone.pricing_rules.minimum_fare)} /><InfoBox label="Airport fees" value={`${money(zone.airport_fees.pickup_fee)} pickup · ${money(zone.airport_fees.dropoff_fee)} dropoff`} /><InfoBox label="Restriction rules" value={[zone.restricted_rules.no_pickup && "No pickup", zone.restricted_rules.no_dropoff && "No dropoff", zone.restricted_rules.no_entry && "No entry"].filter(Boolean).join(", ") || "None"} /><InfoBox label="Auto surge" value={zone.auto_surge_rules.enabled ? `${zone.auto_surge_rules.min_demand_requests}+ demand · x${zone.auto_surge_rules.multiplier}` : "Disabled"} /><InfoBox label="Airport queue" value={zone.airport_fees.queue_enabled ? `${zone.metrics?.airport_queue || 0}/${zone.airport_fees.queue_capacity} waiting` : "Disabled"} /><InfoBox label="Boundary" value={`${zone.boundary_coordinates.length} polygon points`} /></div>; }
function DriversPanel({ zone }: { zone: ServiceZone }) { const drivers = zone.drivers || []; return <div className="mt-5 overflow-hidden rounded-xl border border-gray-100"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">Driver</th><th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Last seen</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody>{drivers.map((driver) => <tr key={driver.id} className="border-t border-gray-100"><td className="px-4 py-3"><p className="font-semibold text-gray-900">{driver.name}</p><p className="text-xs text-gray-500">{driver.phone || "No phone"}</p></td><td className="px-4 py-3 text-gray-600">{driver.vehicle_label}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${driver.is_online ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>{driver.is_online ? "Online" : "Offline"}</span></td><td className="px-4 py-3 text-xs text-gray-500">{driver.updated_at ? new Date(driver.updated_at).toLocaleString() : "—"}</td><td className="px-4 py-3 text-right"><Link className="text-xs font-semibold text-green-700 hover:underline" href={`/admin/drivers/${driver.id}`}>Profile</Link></td></tr>)}{drivers.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">No live drivers detected inside this boundary</td></tr>}</tbody></table></div>; }
function TripsPanel({ zone }: { zone: ServiceZone }) { const trips = zone.trips || []; return <div className="mt-5 overflow-hidden rounded-xl border border-gray-100"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">Trip</th><th className="px-4 py-3">Route</th><th className="px-4 py-3">People</th><th className="px-4 py-3">Fare</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody>{trips.map((trip) => <tr key={trip.id} className="border-t border-gray-100"><td className="px-4 py-3"><p className="font-semibold text-gray-900">{trip.status}</p><p className="text-xs text-gray-500">{new Date(trip.created_at).toLocaleString()}</p></td><td className="px-4 py-3"><p className="text-xs text-gray-700">{trip.pickup_address}</p><p className="text-xs text-gray-400">→ {trip.dropoff_address}</p></td><td className="px-4 py-3 text-xs text-gray-600">{trip.rider_name}<br />{trip.driver_name}</td><td className="px-4 py-3 font-semibold text-gray-900">{money(trip.fare)}</td><td className="px-4 py-3 text-right"><Link className="text-xs font-semibold text-green-700 hover:underline" href={`/admin/rides/${trip.id}`}>Open</Link></td></tr>)}{trips.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">No trips detected in this zone over the last 24 hours</td></tr>}</tbody></table></div>; }
function AnalyticsPanel({ zone }: { zone: ServiceZone }) { const demand = zone.metrics?.demand_24h || 0; const drivers = zone.metrics?.online_drivers || 0; const shortage = drivers === 0 ? demand : Number((demand / Math.max(drivers, 1)).toFixed(1)); return <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><InfoBox label="Rider demand heatmap" value={`${demand} pickup signals / 24h`} /><InfoBox label="Driver heatmap" value={`${drivers} online drivers in zone`} /><InfoBox label="Supply-demand ratio" value={`${shortage}:1 demand per online driver`} /><InfoBox label="Trips completed" value={`${zone.metrics?.trips_24h || 0} in last 24h`} /><div className="rounded-xl border border-amber-100 bg-amber-50 p-4 md:col-span-2 xl:col-span-4"><p className="text-sm font-bold text-amber-900">Zone analytics page</p><p className="mt-1 text-sm text-amber-800">This embedded analytics panel uses the same Supabase zone metrics that can power a dedicated deep-link analytics page.</p></div></div>; }
function AuditPanel({ audits, onReload }: { audits: ServiceZoneAuditLog[]; onReload: () => void }) { return <div className="mt-5"><div className="mb-3 flex justify-end"><button onClick={onReload} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-gray-50"><RefreshCw className="h-3.5 w-3.5" />Reload audit logs</button></div><div className="space-y-2">{audits.map((audit) => <div key={audit.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-bold text-gray-900">{audit.action.replaceAll("_", " ")}</p><p className="text-xs text-gray-500">{new Date(audit.created_at).toLocaleString()}</p></div><p className="mt-1 text-xs text-gray-500">By {audit.admin_email || audit.admin_id || "system trigger"}</p></div>)}{audits.length === 0 && <div className="rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">No audit logs yet</div>}</div></div>; }
