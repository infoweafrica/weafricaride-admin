"use client";

import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { ErrorBoundary, ApiErrorDisplay, EmptyState } from "@/components/ErrorBoundary";
import { supabase } from "@/lib/supabase";
import { useCityContext } from "@/lib/city-context";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  MapPin,
  Users,
  TrendingUp,
  Calendar,
  RefreshCw,
  Eye,
  Radio,
} from "lucide-react";

type DriverResponseStatus = "interested" | "going" | "arrived" | "completed" | "dismissed";

interface DemandEventResponse {
  id: string;
  event_id: string;
  driver_id: string;
  status: DriverResponseStatus;
  notes: string | null;
  responded_at: string | null;
  updated_at: string | null;
  driver?: {
    id: string;
    city?: string | null;
    user?: {
      full_name?: string | null;
      phone?: string | null;
      email?: string | null;
    } | null;
  } | null;
}

interface DemandEvent {
  id: string;
  title: string;
  description: string | null;
  location_name: string | null;
  city: string | null;
  category: string;
  source: string;
  accent_color: string;
  badge: string | null;
  estimated_rides: number;
  drivers_needed: number;
  max_drivers: number | null;
  earning_estimate: string | null;
  time_window: string | null;
  starts_at: string | null;
  ends_at: string | null;
  instructions: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  responses: DemandEventResponse[];
}

const inputClass = "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

const CATEGORIES = [
  { value: "transport", label: "🚗 Transport" },
  { value: "event", label: "🎉 Event" },
  { value: "hotzone", label: "🔥 Hot Zone" },
  { value: "peak", label: "⏰ Peak Hours" },
  { value: "weather", label: "🌧️ Weather" },
  { value: "market", label: "🏪 Market" },
];

const COLORS = [
  { value: "#2563EB", label: "🔵 Blue" },
  { value: "#DC2626", label: "🔴 Red" },
  { value: "#059669", label: "🟢 Green" },
  { value: "#D97706", label: "🟠 Orange" },
  { value: "#7C3AED", label: "🟣 Purple" },
  { value: "#4F46E5", label: "💜 Indigo" },
  { value: "#0891B2", label: "🩵 Cyan" },
];

const BADGES = [
  { value: "", label: "None" },
  { value: "PEAK", label: "PEAK" },
  { value: "EVENT", label: "EVENT" },
  { value: "HOT", label: "HOT" },
  { value: "BUSY", label: "BUSY" },
  { value: "ALERT", label: "ALERT" },
];

const emptyResponseCounts: Record<DriverResponseStatus, number> = {
  interested: 0,
  going: 0,
  arrived: 0,
  completed: 0,
  dismissed: 0,
};

const cityLabel = (selectedCityName: string) =>
  selectedCityName === "All Cities" ? "" : selectedCityName.split(",")[0]?.trim() || selectedCityName;

const localInputValue = (value: string | null) => (value ? value.slice(0, 16) : "");

const isTodayEvent = (event: DemandEvent) => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(startOfDay.getDate() + 1);

  const startsAt = event.starts_at ? new Date(event.starts_at) : null;
  const endsAt = event.ends_at ? new Date(event.ends_at) : null;

  return (!startsAt || startsAt < endOfDay) && (!endsAt || endsAt >= startOfDay);
};

const parseMoneyEstimate = (estimate: string | null) => {
  if (!estimate) return 0;
  const values = estimate.match(/[\d,]+(?:\.\d+)?/g) as string[] | null;
  return (values || []).reduce<number>((max, raw) => Math.max(max, Number.parseFloat(raw.replace(/,/g, "")) || 0), 0);
};

const formatPotential = (value: number) =>
  value > 0 ? `MWK ${Math.round(value).toLocaleString()}` : "MWK 0";

export default function DemandEventsPage() {
  return (
    <ErrorBoundary>
      <DemandEventsContent />
    </ErrorBoundary>
  );
}

function DemandEventsContent() {
  const { selectedCityName, cities } = useCityContext();
  const selectedCityLabel = useMemo(() => cityLabel(selectedCityName), [selectedCityName]);
  const [events, setEvents] = useState<DemandEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<DemandEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<DemandEvent | null>(null);
  const [saving, setSaving] = useState(false);

  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formCity, setFormCity] = useState("");
  const [formCategory, setFormCategory] = useState("event");
  const [formColor, setFormColor] = useState("#D97706");
  const [formBadge, setFormBadge] = useState("");
  const [formRides, setFormRides] = useState("0");
  const [formDrivers, setFormDrivers] = useState("0");
  const [formMaxDrivers, setFormMaxDrivers] = useState("");
  const [formEarnings, setFormEarnings] = useState("");
  const [formTimeWindow, setFormTimeWindow] = useState("");
  const [formStartsAt, setFormStartsAt] = useState("");
  const [formEndsAt, setFormEndsAt] = useState("");
  const [formInstructions, setFormInstructions] = useState("");
  const [formSource, setFormSource] = useState("ADMIN");
  const [formActive, setFormActive] = useState(true);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("demand_events")
        .select("*")
        .order("created_at", { ascending: false });

      if (err) throw new Error(err.message);

      const baseEvents = ((data as Omit<DemandEvent, "responses">[]) || []).map((event) => ({
        ...event,
        max_drivers: event.max_drivers ?? null,
        instructions: event.instructions ?? null,
        responses: [],
      }));

      let responses: DemandEventResponse[] = [];
      if (baseEvents.length > 0) {
        const eventIds = baseEvents.map((event) => event.id);
        const responseResult = await supabase
          .from("demand_event_responses")
          .select("*, driver:drivers(id, city, user:users(full_name, phone, email))")
          .in("event_id", eventIds)
          .order("responded_at", { ascending: false });

        if (!responseResult.error && responseResult.data) {
          responses = responseResult.data as DemandEventResponse[];
        }
      }

      setEvents(
        baseEvents.map((event) => ({
          ...event,
          responses: responses.filter((response) => response.event_id === event.id),
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const openCreate = () => {
    setEditingEvent(null);
    setFormTitle("");
    setFormDescription("");
    setFormLocation("");
    setFormCity(selectedCityLabel);
    setFormCategory("event");
    setFormColor("#D97706");
    setFormBadge("EVENT");
    setFormRides("0");
    setFormDrivers("0");
    setFormMaxDrivers("");
    setFormEarnings("");
    setFormTimeWindow("");
    setFormStartsAt("");
    setFormEndsAt("");
    setFormInstructions("");
    setFormSource("ADMIN");
    setFormActive(true);
    setShowForm(true);
  };

  const openEdit = (event: DemandEvent) => {
    setEditingEvent(event);
    setFormTitle(event.title);
    setFormDescription(event.description || "");
    setFormLocation(event.location_name || "");
    setFormCity(event.city || "");
    setFormCategory(event.category);
    setFormColor(event.accent_color);
    setFormBadge(event.badge || "");
    setFormRides(String(event.estimated_rides || 0));
    setFormDrivers(String(event.drivers_needed || 0));
    setFormMaxDrivers(event.max_drivers ? String(event.max_drivers) : "");
    setFormEarnings(event.earning_estimate || "");
    setFormTimeWindow(event.time_window || "");
    setFormStartsAt(localInputValue(event.starts_at));
    setFormEndsAt(localInputValue(event.ends_at));
    setFormInstructions(event.instructions || "");
    setFormSource(event.source);
    setFormActive(event.is_active);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formTitle.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: formTitle.trim(),
        description: formDescription.trim() || null,
        location_name: formLocation.trim() || null,
        city: formCity.trim() || null,
        category: formCategory,
        source: formSource,
        accent_color: formColor,
        badge: formBadge || null,
        estimated_rides: Number.parseInt(formRides, 10) || 0,
        drivers_needed: Number.parseInt(formDrivers, 10) || 0,
        max_drivers: formMaxDrivers ? Number.parseInt(formMaxDrivers, 10) || null : null,
        earning_estimate: formEarnings.trim() || null,
        time_window: formTimeWindow.trim() || null,
        starts_at: formStartsAt ? new Date(formStartsAt).toISOString() : null,
        ends_at: formEndsAt ? new Date(formEndsAt).toISOString() : null,
        instructions: formInstructions.trim() || null,
        is_active: formActive,
        updated_at: new Date().toISOString(),
      };

      const result = editingEvent
        ? await supabase.from("demand_events").update(payload).eq("id", editingEvent.id)
        : await supabase.from("demand_events").insert({ ...payload, created_at: new Date().toISOString() });

      if (result.error) throw new Error(result.error.message);

      setShowForm(false);
      await loadEvents();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (event: DemandEvent) => {
    try {
      const { error: toggleError } = await supabase
        .from("demand_events")
        .update({ is_active: !event.is_active, updated_at: new Date().toISOString() })
        .eq("id", event.id);
      if (toggleError) throw new Error(toggleError.message);
      await loadEvents();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Toggle failed");
    }
  };

  const handleDelete = async (event: DemandEvent) => {
    if (!confirm(`Delete "${event.title}"? Driver responses will also be removed.`)) return;
    try {
      const { error: deleteError } = await supabase.from("demand_events").delete().eq("id", event.id);
      if (deleteError) throw new Error(deleteError.message);
      await loadEvents();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const selectedCityEvents = useMemo(() => {
    if (!selectedCityLabel) return events;
    return events.filter((event) => (event.city || "").toLowerCase() === selectedCityLabel.toLowerCase());
  }, [events, selectedCityLabel]);

  const filtered = useMemo(() => {
    return selectedCityEvents.filter((event) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        event.title.toLowerCase().includes(q) ||
        (event.location_name || "").toLowerCase().includes(q) ||
        (event.city || "").toLowerCase().includes(q) ||
        (event.category || "").toLowerCase().includes(q) ||
        (event.badge || "").toLowerCase().includes(q);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && event.is_active) ||
        (statusFilter === "inactive" && !event.is_active) ||
        (statusFilter === "joined" && event.responses.some((response) => response.status !== "dismissed"));

      return matchesSearch && matchesStatus;
    });
  }, [selectedCityEvents, search, statusFilter]);

  const stats = useMemo(() => {
    const joined = events.reduce(
      (sum, event) => sum + event.responses.filter((response) => response.status !== "dismissed").length,
      0
    );
    const todayEvents = events.filter((event) => event.is_active && isTodayEvent(event));
    const todayPotentialRevenue = todayEvents.reduce(
      (sum, event) => sum + parseMoneyEstimate(event.earning_estimate) * Math.max(Number(event.drivers_needed || 1), 1),
      0
    );
    return {
      total: events.length,
      active: events.filter((event) => event.is_active).length,
      driversNeeded: events.reduce((sum, event) => sum + Number(event.drivers_needed || 0), 0),
      joined,
      todayEvents: todayEvents.length,
      todayPotentialRevenue,
    };
  }, [events]);

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] bg-gradient-to-r from-zinc-950 via-zinc-900 to-emerald-700 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-emerald-200">WeAfrica Ride</p>
            <h1 className="mt-2 text-3xl font-black">Demand Events</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-300">
              Create city demand opportunities in admin and let drivers join them in the Driver App Discover page.
            </p>
            <p className="mt-1 text-xs text-emerald-100">
              {selectedCityLabel ? `${selectedCityEvents.length} event(s) in ${selectedCityLabel}` : `${events.length} event(s) across all cities`}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={loadEvents}
              className="inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white ring-1 ring-white/20 hover:bg-white/20"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-black text-black hover:bg-emerald-300"
            >
              <Plus className="h-4 w-4" /> Create Event
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Stat icon={<Calendar className="h-5 w-5" />} label="Total Events" value={stats.total} />
        <Stat icon={<Radio className="h-5 w-5" />} label="Active" value={stats.active} />
        <Stat icon={<TrendingUp className="h-5 w-5" />} label="Drivers Needed" value={stats.driversNeeded} />
        <Stat icon={<Users className="h-5 w-5" />} label="Drivers Joined" value={stats.joined} />
        <Stat icon={<TrendingUp className="h-5 w-5" />} label="Today Potential" value={formatPotential(stats.todayPotentialRevenue)} />
      </div>

      <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        <span className="font-black">Today&apos;s admin potential:</span>{" "}
        {formatPotential(stats.todayPotentialRevenue)} from {stats.todayEvents} active demand {stats.todayEvents === 1 ? "event" : "events"} scheduled for today.
      </div>

      <ApiErrorDisplay error={error} onRetry={loadEvents} />

      <div className="rounded-[24px] border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px]">
          <div className="relative">
            <Search className="absolute left-4 top-3.5 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search events by title, location, city..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 py-3 pl-11 pr-4 text-sm outline-none focus:border-emerald-400"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none"
          >
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
            <option value="joined">Has Drivers</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-zinc-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-zinc-50 text-left text-zinc-500">
                <th className="px-4 py-3 font-bold">Event</th>
                <th className="px-4 py-3 font-bold">Location</th>
                <th className="px-4 py-3 font-bold">Category</th>
                <th className="px-4 py-3 font-bold">Drivers</th>
                <th className="px-4 py-3 font-bold">Time</th>
                <th className="px-4 py-3 font-bold">Status</th>
                <th className="px-4 py-3 text-right font-bold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-zinc-400">Loading events...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-12"><EmptyState icon={MapPin} title="No demand events" description='Click "Create Event" to add one and publish it to drivers' /></td></tr>
              ) : (
                filtered.map((event) => {
                  const responseCounts = getResponseCounts(event.responses);
                  const joinedCount = event.responses.filter((response) => response.status !== "dismissed").length;
                  const capacity = event.max_drivers || event.drivers_needed || 0;
                  return (
                    <tr key={event.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: event.accent_color }} />
                          <div>
                            <p className="font-bold text-zinc-900">{event.title}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-bold ${event.source === "SYSTEM" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>{event.source}</span>
                              {event.badge && <span className="inline-flex rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-bold text-zinc-700">{event.badge}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        {event.location_name || "—"}<br />
                        {event.city && <span className="text-zinc-400">{event.city}</span>}
                      </td>
                      <td className="px-4 py-3 text-xs capitalize text-zinc-600">{event.category.replace("_", " ")}</td>
                      <td className="px-4 py-3 text-xs text-zinc-600">
                        <div className="font-bold text-zinc-900">{joinedCount}/{capacity || "∞"} joined</div>
                        <div className="text-zinc-400">{event.drivers_needed || 0} needed</div>
                        {responseCounts.arrived > 0 && <div className="text-emerald-600">{responseCounts.arrived} arrived</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        {event.time_window || "—"}
                        {event.starts_at && <div className="text-zinc-400">{new Date(event.starts_at).toLocaleString()}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggle(event)}
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${event.is_active ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"}`}
                        >
                          {event.is_active ? "Active" : "Inactive"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setSelectedEvent(event)} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100" title="View driver responses"><Eye className="h-4 w-4" /></button>
                          <button onClick={() => openEdit(event)} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100" title="Edit"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => handleDelete(event)} className="rounded p-1.5 text-red-500 hover:bg-red-50" title="Delete"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b bg-white px-6 py-4">
              <h2 className="text-lg font-black text-zinc-900">{editingEvent ? "Edit Event" : "Create Demand Event"}</h2>
              <button onClick={() => setShowForm(false)} className="rounded p-1 hover:bg-zinc-100"><X className="h-5 w-5 text-zinc-500" /></button>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid grid-cols-2 gap-4">
                <Field className="col-span-2" label="Title *">
                  <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} className={inputClass} placeholder="e.g. STADIUM MATCH DAY" />
                </Field>
                <Field className="col-span-2" label="Description">
                  <textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} rows={3} className={inputClass} placeholder="Describe the demand opportunity shown to drivers..." />
                </Field>
                <Field label="Location Name">
                  <input value={formLocation} onChange={(e) => setFormLocation(e.target.value)} className={inputClass} placeholder="e.g. Kamuzu Stadium" />
                </Field>
                <Field label="City">
                  <input list="demand-event-cities" value={formCity} onChange={(e) => setFormCity(e.target.value)} className={inputClass} placeholder="e.g. Lilongwe" />
                  <datalist id="demand-event-cities">
                    {cities.map((city) => <option key={city.id} value={city.name} />)}
                  </datalist>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Category"><select value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className={inputClass}>{CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></Field>
                <Field label="Source"><select value={formSource} onChange={(e) => setFormSource(e.target.value)} className={inputClass}><option value="ADMIN">ADMIN</option><option value="SYSTEM">SYSTEM</option></select></Field>
                <Field label="Color"><select value={formColor} onChange={(e) => setFormColor(e.target.value)} className={inputClass}>{COLORS.map((color) => <option key={color.value} value={color.value}>{color.label}</option>)}</select></Field>
                <Field label="Badge"><select value={formBadge} onChange={(e) => setFormBadge(e.target.value)} className={inputClass}>{BADGES.map((badge) => <option key={badge.value} value={badge.value}>{badge.label}</option>)}</select></Field>
              </div>

              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Field label="Est. Rides"><input type="number" value={formRides} onChange={(e) => setFormRides(e.target.value)} className={inputClass} /></Field>
                <Field label="Drivers Needed"><input type="number" value={formDrivers} onChange={(e) => setFormDrivers(e.target.value)} className={inputClass} /></Field>
                <Field label="Max Drivers"><input type="number" value={formMaxDrivers} onChange={(e) => setFormMaxDrivers(e.target.value)} className={inputClass} placeholder="Optional" /></Field>
                <Field label="Est. Earning"><input value={formEarnings} onChange={(e) => setFormEarnings(e.target.value)} className={inputClass} placeholder="e.g. MK 15,000" /></Field>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Field label="Time Window"><input value={formTimeWindow} onChange={(e) => setFormTimeWindow(e.target.value)} className={inputClass} placeholder="e.g. Now – 10 PM" /></Field>
                <Field label="Starts At"><input type="datetime-local" value={formStartsAt} onChange={(e) => setFormStartsAt(e.target.value)} className={inputClass} /></Field>
                <Field label="Ends At"><input type="datetime-local" value={formEndsAt} onChange={(e) => setFormEndsAt(e.target.value)} className={inputClass} /></Field>
              </div>

              <Field label="Driver Instructions">
                <textarea value={formInstructions} onChange={(e) => setFormInstructions(e.target.value)} rows={3} className={inputClass} placeholder="e.g. Park near Gate B and stay online for dispatch." />
              </Field>

              <label className="flex items-center gap-2 text-sm font-bold text-zinc-700">
                <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} className="h-4 w-4 rounded border-zinc-300" />
                Publish to Driver App immediately
              </label>

              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowForm(false)} className="flex-1 rounded-xl border border-zinc-200 py-3 text-sm font-bold text-zinc-600 hover:bg-zinc-50">Cancel</button>
                <button onClick={handleSave} disabled={saving || !formTitle.trim()} className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50">
                  {saving ? "Saving..." : editingEvent ? "Update Event" : "Create Event"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedEvent && <EventResponsesModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}

function getResponseCounts(responses: DemandEventResponse[]) {
  return responses.reduce(
    (counts, response) => ({ ...counts, [response.status]: (counts[response.status] || 0) + 1 }),
    { ...emptyResponseCounts }
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
  return (
    <div className="rounded-[22px] border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">{icon}</div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-400">{label}</p>
          <p className="text-2xl font-black text-zinc-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-bold text-zinc-700">{label}</label>
      {children}
    </div>
  );
}

function EventResponsesModal({ event, onClose }: { event: DemandEvent; onClose: () => void }) {
  const counts = getResponseCounts(event.responses);
  const activeResponses = event.responses.filter((response) => response.status !== "dismissed");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-black text-zinc-900">Driver responses</h2>
            <p className="text-sm text-zinc-500">{event.title}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-zinc-100"><X className="h-5 w-5 text-zinc-500" /></button>
        </div>
        <div className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {Object.entries(counts).map(([status, count]) => (
              <div key={status} className="rounded-2xl bg-zinc-50 p-3 text-center">
                <p className="text-lg font-black text-zinc-900">{count}</p>
                <p className="text-[11px] font-bold uppercase text-zinc-400">{status}</p>
              </div>
            ))}
          </div>

          {activeResponses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center">
              <Users className="mx-auto h-10 w-10 text-zinc-300" />
              <p className="mt-3 font-bold text-zinc-900">No drivers have joined yet</p>
              <p className="text-sm text-zinc-500">Drivers will appear here when they tap Join Event in the driver app.</p>
            </div>
          ) : (
            <div className="divide-y rounded-2xl border border-zinc-200">
              {activeResponses.map((response) => {
                const driverName = response.driver?.user?.full_name || "Driver";
                const contact = response.driver?.user?.phone || response.driver?.user?.email || response.driver_id;
                return (
                  <div key={response.id} className="flex items-center justify-between gap-4 p-4">
                    <div>
                      <p className="font-bold text-zinc-900">{driverName}</p>
                      <p className="text-xs text-zinc-500">{contact}</p>
                      {response.driver?.city && <p className="text-xs text-zinc-400">{response.driver.city}</p>}
                    </div>
                    <div className="text-right">
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold capitalize text-emerald-700">{response.status}</span>
                      {response.responded_at && <p className="mt-1 text-xs text-zinc-400">{new Date(response.responded_at).toLocaleString()}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
