"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import {
  RefreshCw, AlertTriangle, Shield, Search, Filter, Plus, Eye,
  CheckCircle, XCircle, Clock, Flag, Ban, Download, Calendar,
  User, MapPin, Car, Phone, ChevronDown, X, FileText,
  AlertCircle, TrendingUp, Activity, ArrowUpRight, ChevronLeft,
} from "lucide-react";
import { formatCurrency, formatNumber, timeAgo, formatDate } from "@/lib/utils";

// ─── TYPES ──────────────────────────────────────────────────

interface IncidentStats { total: number; open: number; investigating: number; escalated: number; resolved: number; closed: number; high_severity: number; avg_resolution_hours: number; }

interface Incident {
  id: string; incident_type: string; severity: string; status: string;
  city?: string; description?: string; resolution?: string;
  ride_id?: string; rider_id?: string; driver_id?: string;
  assigned_admin_id?: string; resolved_at?: string;
  created_at: string; updated_at?: string;
  rider_name?: string; driver_name?: string; driver_phone?: string;
  pickup_address?: string; dropoff_address?: string;
  fare?: number; ride_status?: string; plate_number?: string;
  evidence_count?: number; timeline_count?: number;
}

// ─── HELPERS ────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-blue-100 text-blue-700", medium: "bg-amber-100 text-amber-700",
  high: "bg-orange-100 text-orange-700", critical: "bg-red-100 text-red-700",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-700", new: "bg-red-100 text-red-700",
  investigating: "bg-amber-100 text-amber-700", under_review: "bg-amber-100 text-amber-700",
  escalated: "bg-purple-100 text-purple-700",
  resolved: "bg-green-100 text-green-700", closed: "bg-gray-100 text-gray-500",
};

const INCIDENT_TYPES: Record<string, string> = {
  accident: "🚨 Accident", harassment: "⚠️ Harassment", safety: "🛡️ Safety",
  lost_item: "📦 Lost Item", payment_issue: "💳 Payment", fraud: "🔍 Fraud",
  vehicle_issue: "🔧 Vehicle", driver_report: "🧑‍✈️ Driver Report",
  rider_report: "🧑 Rider Report", emergency: "🆘 Emergency", other: "📢 Other",
};

type TabKey = "all" | "open" | "investigating" | "escalated" | "resolved" | "closed";

const TABS: { key: TabKey; label: string; color: string }[] = [
  { key: "all", label: "All", color: "text-gray-600" },
  { key: "open", label: "Open", color: "text-red-600" },
  { key: "investigating", label: "Investigating", color: "text-amber-600" },
  { key: "escalated", label: "Escalated", color: "text-purple-600" },
  { key: "resolved", label: "Resolved", color: "text-green-600" },
  { key: "closed", label: "Closed", color: "text-gray-500" },
];

// ─── PAGE ───────────────────────────────────────────────────

export default function IncidentsPage() {
  return (
    <PermissionGuard permission="manage_incidents">
      <IncidentsContent />
    </PermissionGuard>
  );
}

function IncidentsContent() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stats
  const [stats, setStats] = useState<IncidentStats>({ total: 0, open: 0, investigating: 0, escalated: 0, resolved: 0, closed: 0, high_severity: 0, avg_resolution_hours: 0 });

  // Data
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  // Filters
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newIncident, setNewIncident] = useState({ type: "other", severity: "medium", city: "", description: "" });
  const [creating, setCreating] = useState(false);

  // ── Fetch ──
  const fetchStats = useCallback(async () => {
    try { const { data } = await supabase.rpc("admin_incident_stats"); if (data) setStats(data as IncidentStats); } catch { /* */ }
  }, []);

  const fetchIncidents = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.rpc("admin_list_incidents_enriched", {
        p_status: activeTab !== "all" ? activeTab : null,
        p_severity: severityFilter !== "all" ? severityFilter : null,
        p_city: cityFilter !== "all" ? cityFilter : null,
        p_type: typeFilter !== "all" ? typeFilter : null,
        p_limit: 25,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setIncidents(((data as any)?.data || []) as Incident[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }, [activeTab, severityFilter, cityFilter, typeFilter]);

  const fetchAll = useCallback(async () => { await fetchStats(); await fetchIncidents(); }, [fetchStats, fetchIncidents]);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Actions ──
  const handleCreate = async () => {
    setCreating(true);
    try {
      await supabase.rpc("admin_create_incident", {
        p_type: newIncident.type, p_severity: newIncident.severity,
        p_city: newIncident.city || null, p_description: newIncident.description || null,
      });
      setShowCreate(false); setNewIncident({ type: "other", severity: "medium", city: "", description: "" }); fetchAll();
    } catch { /* */ } finally { setCreating(false); }
  };

  const handleUpdateStatus = async (id: string, status: string) => {
    await supabase.rpc("admin_update_incident", { p_incident_id: id, p_status: status });
    fetchAll(); if (selectedIncident?.id === id) setSelectedIncident(null);
  };

  const filtered = search ? incidents.filter(i => (i.rider_name || "").toLowerCase().includes(search.toLowerCase()) || (i.driver_name || "").toLowerCase().includes(search.toLowerCase()) || (i.description || "").toLowerCase().includes(search.toLowerCase())) : incidents;

  // ─── RENDER ───────────────────────────────────────────────

  return (
    <div className="space-y-6" style={{ padding: 32, background: "#F8FAFC", minHeight: "100vh" }}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700 }} className="text-gray-900">Safety Incidents</h1>
          <p style={{ fontSize: 15 }} className="text-gray-500 mt-1">Monitor, investigate, and resolve rider/driver safety cases</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={fetchAll} className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50" style={{ height: 44 }}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700" style={{ height: 44 }}>
            <Plus className="h-4 w-4" /> Create Incident
          </button>
          <button className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50" style={{ height: 44 }}>
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700"><AlertTriangle className="h-4 w-4 inline mr-1" />{error}</div>}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {([
          { label: "Total Incidents", value: stats.total, icon: Activity, bg: "bg-blue-50", text: "text-blue-600" },
          { label: "Open", value: stats.open, icon: AlertCircle, bg: "bg-red-50", text: "text-red-600" },
          { label: "Investigating", value: stats.investigating, icon: Search, bg: "bg-amber-50", text: "text-amber-600" },
          { label: "Escalated", value: stats.escalated, icon: Flag, bg: "bg-purple-50", text: "text-purple-600" },
          { label: "High Severity", value: stats.high_severity, icon: AlertTriangle, bg: "bg-orange-50", text: "text-orange-600" },
          { label: "Resolved", value: stats.resolved, icon: CheckCircle, bg: "bg-green-50", text: "text-green-600" },
          { label: "Avg Resolution", value: `${stats.avg_resolution_hours}h`, icon: Clock, bg: "bg-indigo-50", text: "text-indigo-600" },
        ]).map(c => (
          <div key={c.label} className="bg-white rounded-2xl border p-4" style={{ minHeight: 100, borderRadius: 18, minWidth: 180 }}>
            <div className="flex items-center gap-2 mb-1"><div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.bg} ${c.text}`}><c.icon className="h-4 w-4" /></div><p style={{ fontSize: 12 }} className="text-gray-400 font-medium">{c.label}</p></div>
            <p style={{ fontSize: 28, fontWeight: 800 }} className="text-gray-900">{typeof c.value === "number" ? formatNumber(c.value) : c.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs + Filters */}
      <div className="bg-white rounded-2xl border border-gray-200">
        <div className="flex items-center gap-1 border-b border-gray-200 px-4 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setActiveTab(t.key); setSelectedIncident(null); }}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === t.key ? `border-${t.color.split("-")[1]}-600 ${t.color}` : "border-transparent text-gray-500 hover:text-gray-700"}`}
              style={{ height: 48 }}>{t.label}</button>
          ))}
          <div className="ml-auto flex items-center gap-2 py-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input type="text" placeholder="Search rider, driver, description..." value={search} onChange={e => setSearch(e.target.value)}
                className="pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-xs w-56" />
            </div>
            <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-1 px-3 py-2 border rounded-xl text-xs text-gray-500 hover:bg-gray-50">
              <Filter className="h-3.5 w-3.5" /> Filters <ChevronDown className={`h-3 w-3 transition ${showFilters ? "rotate-180" : ""}`} /></button>
          </div>
        </div>
        {showFilters && (
          <div className="flex flex-wrap gap-3 px-4 py-3 border-b border-gray-100">
            <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)} className="px-3 py-2 border rounded-xl text-xs bg-white">
              <option value="all">All Severity</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
            <select value={cityFilter} onChange={e => setCityFilter(e.target.value)} className="px-3 py-2 border rounded-xl text-xs bg-white">
              <option value="all">All Cities</option><option value="blantyre">Blantyre</option><option value="lilongwe">Lilongwe</option><option value="mzuzu">Mzuzu</option><option value="zomba">Zomba</option>
            </select>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="px-3 py-2 border rounded-xl text-xs bg-white">
              <option value="all">All Types</option>{Object.entries(INCIDENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center"><CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-400" /><p className="text-gray-500 text-sm">No incidents found</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 bg-gray-50 border-b" style={{ height: 48 }}>
                  <th className="px-4 py-3 text-xs font-medium">ID</th><th className="px-4 py-3 text-xs font-medium">Type</th>
                  <th className="px-4 py-3 text-xs font-medium">Severity</th><th className="px-4 py-3 text-xs font-medium">Status</th>
                  <th className="px-4 py-3 text-xs font-medium">Rider</th><th className="px-4 py-3 text-xs font-medium">Driver</th>
                  <th className="px-4 py-3 text-xs font-medium">Ride</th><th className="px-4 py-3 text-xs font-medium">City</th>
                  <th className="px-4 py-3 text-xs font-medium">Date</th><th className="px-4 py-3 text-xs font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(i => (
                  <tr key={i.id} onClick={() => setSelectedIncident(i)} className="hover:bg-gray-50 cursor-pointer" style={{ height: 56 }}>
                    <td className="px-4 py-3 text-xs font-mono text-gray-500">{i.id?.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-xs">{INCIDENT_TYPES[i.incident_type] || i.incident_type}</td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${SEVERITY_COLORS[i.severity] || ""}`}>{i.severity}</span></td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[i.status] || ""}`}>{i.status?.replace(/_/g, " ")}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-700">{i.rider_name || "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{i.driver_name || "—"}</td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-400">{i.ride_id?.slice(0, 8) || "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{i.city || "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{timeAgo(i.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={e => { e.stopPropagation(); setSelectedIncident(i); }} className="px-2 py-1 text-[11px] bg-gray-100 rounded-lg hover:bg-gray-200"><Eye className="h-3 w-3" /></button>
                        {i.status === "open" && <button onClick={e => { e.stopPropagation(); handleUpdateStatus(i.id, "investigating"); }} className="px-2 py-1 text-[11px] bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200"><Search className="h-3 w-3 inline mr-0.5" />Investigate</button>}
                        {i.status === "investigating" && <button onClick={e => { e.stopPropagation(); handleUpdateStatus(i.id, "resolved"); }} className="px-2 py-1 text-[11px] bg-green-100 text-green-700 rounded-lg hover:bg-green-200"><CheckCircle className="h-3 w-3 inline mr-0.5" />Resolve</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Incident Detail Drawer ── */}
      {selectedIncident && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedIncident(null)} />
          <div className="relative ml-auto bg-white h-full shadow-2xl overflow-y-auto" style={{ width: 480, padding: 24 }}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Incident #{selectedIncident.id?.slice(0, 8)}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[selectedIncident.status]}`}>{selectedIncident.status?.replace(/_/g, " ")}</span>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${SEVERITY_COLORS[selectedIncident.severity]}`}>{selectedIncident.severity}</span>
                </div>
              </div>
              <button onClick={() => setSelectedIncident(null)} className="p-2 hover:bg-gray-100 rounded-xl"><X className="h-5 w-5 text-gray-400" /></button>
            </div>

            <div className="space-y-4">
              <div className="bg-gray-50 rounded-2xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-2">Details</h4>
                <div className="space-y-1.5 text-xs">
                  {[
                    { l: "Type", v: INCIDENT_TYPES[selectedIncident.incident_type] || selectedIncident.incident_type },
                    { l: "Rider", v: selectedIncident.rider_name || "—" },
                    { l: "Driver", v: selectedIncident.driver_name || "—" },
                    { l: "Ride", v: selectedIncident.ride_id?.slice(0, 8) || "—", mono: true },
                    { l: "City", v: selectedIncident.city || "—" },
                    { l: "Fare", v: selectedIncident.fare ? formatCurrency(selectedIncident.fare) : "—" },
                    { l: "Evidence", v: `${selectedIncident.evidence_count || 0} files` },
                    { l: "Created", v: formatDate(selectedIncident.created_at) },
                  ].map(f => (
                    <div key={f.l} className="flex justify-between"><span className="text-gray-400">{f.l}</span><span className={`text-gray-700 ${f.mono ? "font-mono" : ""}`}>{f.v}</span></div>
                  ))}
                </div>
                {selectedIncident.description && <p className="text-xs text-gray-600 mt-2 bg-white p-2 rounded-lg">{selectedIncident.description}</p>}
                {selectedIncident.resolution && <p className="text-xs text-green-700 mt-2 bg-green-50 p-2 rounded-lg">✅ {selectedIncident.resolution}</p>}
              </div>

              {/* Actions */}
              <div className="bg-gray-50 rounded-2xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-3">Actions</h4>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { status: "investigating", label: "Investigate", color: "bg-amber-50 border-amber-200 text-amber-700", icon: Search },
                    { status: "escalated", label: "Escalate", color: "bg-purple-50 border-purple-200 text-purple-700", icon: Flag },
                    { status: "resolved", label: "Resolve", color: "bg-green-50 border-green-200 text-green-700", icon: CheckCircle },
                    { status: "closed", label: "Close", color: "bg-gray-50 border-gray-200 text-gray-600", icon: Ban },
                  ].filter(a => a.status !== selectedIncident.status).map(a => (
                    <button key={a.status} onClick={() => handleUpdateStatus(selectedIncident.id, a.status)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium ${a.color} hover:opacity-80`}>
                      <a.icon className="h-3.5 w-3.5" />{a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Incident Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCreate(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b"><h2 className="text-lg font-bold">Create Incident</h2><button onClick={() => setShowCreate(false)} className="p-1.5 hover:bg-gray-100 rounded-lg"><X className="h-5 w-5 text-gray-400" /></button></div>
            <div className="p-6 space-y-4">
              <div><label className="text-xs font-medium text-gray-700 mb-1 block">Type</label>
                <select value={newIncident.type} onChange={e => setNewIncident({ ...newIncident, type: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-sm bg-white">
                  {Object.entries(INCIDENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div><label className="text-xs font-medium text-gray-700 mb-1 block">Severity</label>
                <select value={newIncident.severity} onChange={e => setNewIncident({ ...newIncident, severity: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-sm bg-white">
                  <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
                </select>
              </div>
              <div><label className="text-xs font-medium text-gray-700 mb-1 block">City</label>
                <select value={newIncident.city} onChange={e => setNewIncident({ ...newIncident, city: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-sm bg-white">
                  <option value="">— Select —</option><option value="blantyre">Blantyre</option><option value="lilongwe">Lilongwe</option><option value="mzuzu">Mzuzu</option><option value="zomba">Zomba</option>
                </select>
              </div>
              <div><label className="text-xs font-medium text-gray-700 mb-1 block">Description</label><textarea value={newIncident.description} onChange={e => setNewIncident({ ...newIncident, description: e.target.value })} rows={3} placeholder="Describe the incident..." className="w-full px-3 py-2 border rounded-xl text-sm" /></div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
              <button onClick={() => setShowCreate(false)} className="px-5 py-2.5 text-sm border rounded-xl">Cancel</button>
              <button onClick={handleCreate} disabled={creating} className="flex items-center gap-2 px-6 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                {creating ? "Creating..." : "Create Incident"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}