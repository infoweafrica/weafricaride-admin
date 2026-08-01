"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { MapPin, RefreshCw, Save, RotateCcw, Undo2 } from "lucide-react";
import { ApiErrorDisplay, ErrorBoundary } from "@/components/ErrorBoundary";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { useAuth } from "@/lib/auth-context";
import {
  DEFAULT_AIRPORT_FEES,
  DEFAULT_AUTO_SURGE_RULES,
  DEFAULT_PRICING_RULES,
  DEFAULT_RESTRICTED_RULES,
  DEFAULT_SURGE_SETTINGS,
  fetchServiceZones,
  saveServiceZone,
  type ServiceZone,
  type ServiceZonePayload,
  type ServiceZoneType,
  type ZoneCoordinate,
  type ZoneStatus,
} from "@/lib/api/service-zones";

const ServiceZonesMap = dynamic(() => import("./ServiceZonesMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[720px] items-center justify-center rounded-2xl border bg-white">
      <RefreshCw className="h-7 w-7 animate-spin text-green-600" />
    </div>
  ),
});

const inputClass =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100";

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

export default function ServiceZonesPage() {
  return (
    <PermissionGuard permission="manage_rides">
      <ErrorBoundary>
        <ServiceZoneBuilder />
      </ErrorBoundary>
    </PermissionGuard>
  );
}

function ServiceZoneBuilder() {
  const { adminProfile } = useAuth();
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [form, setForm] = useState<ServiceZonePayload>(() => emptyPayload());
  const [drawing, setDrawing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const admin = useMemo(
    () => ({ id: adminProfile?.id || null, email: adminProfile?.email || null }),
    [adminProfile]
  );

  const loadZones = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchServiceZones({});
    if (result.error) setError(result.error);
    setZones(result.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadZones();
  }, [loadZones]);

  function updateForm<K extends keyof ServiceZonePayload>(key: K, value: ServiceZonePayload[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function applyDraftCoordinates(coordinates: ZoneCoordinate[]) {
    setForm((prev) => {
      const center =
        coordinates.length > 0
          ? coordinates.reduce(
              (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
              { lat: 0, lng: 0 }
            )
          : null;

      return {
        ...prev,
        boundary_coordinates: coordinates,
        center_lat: center ? Number((center.lat / coordinates.length).toFixed(6)) : null,
        center_lng: center ? Number((center.lng / coordinates.length).toFixed(6)) : null,
      };
    });
  }

  async function handleSave() {
    if (!form.name.trim()) return setError("Zone name is required.");
    if (!form.city.trim()) return setError("City is required.");
    if (form.boundary_coordinates.length < 3) {
      return setError("Draw the zone boundary first. You need at least 3 points.");
    }

    setSaving(true);
    setError(null);

    const result = await saveServiceZone(
      {
        ...form,
        name: form.name.trim(),
        city: form.city.trim(),
      },
      undefined,
      admin
    );

    setSaving(false);

    if (result.error) return setError(result.error);

    setForm(emptyPayload());
    setDrawing(true);
    await loadZones();
  }

  function resetDrawing() {
    applyDraftCoordinates([]);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Create Service Zone</h1>
        <p className="mt-1 text-sm text-gray-500">
          Draw the operating area on the map, then name and save the zone.
        </p>
      </div>

      <ApiErrorDisplay error={error} onRetry={loadZones} />

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-h-[720px] overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <ServiceZonesMap
            zones={zones}
            draftCoordinates={form.boundary_coordinates}
            drawingEnabled={drawing}
            onDraftCoordinatesChange={applyDraftCoordinates}
          />
        </div>

        <aside className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-gray-900">Create your zone</h2>
            <p className="mt-1 text-sm text-gray-500">
              Click the map to draw. Add at least 3 points.
            </p>
          </div>

          <div className="mb-5 rounded-xl bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase text-gray-500">Boundary points</p>
            <p className={`mt-1 text-2xl font-bold ${form.boundary_coordinates.length >= 3 ? "text-green-700" : "text-red-600"}`}>
              {form.boundary_coordinates.length}
            </p>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">Zone name</span>
              <input
                value={form.name}
                onChange={(event) => updateForm("name", event.target.value)}
                placeholder="Example: Lilongwe City Centre"
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">City</span>
              <input
                value={form.city}
                onChange={(event) => updateForm("city", event.target.value)}
                placeholder="Lilongwe"
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">Type</span>
              <select
                value={form.zone_type}
                onChange={(event) => updateForm("zone_type", event.target.value as ServiceZoneType)}
                className={inputClass}
              >
                <option value="operating">Operating</option>
                <option value="airport">Airport</option>
                <option value="surge">Surge</option>
                <option value="restricted">Restricted</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">Status</span>
              <select
                value={form.status}
                onChange={(event) => updateForm("status", event.target.value as ZoneStatus)}
                className={inputClass}
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">Description</span>
              <textarea
                value={form.description || ""}
                onChange={(event) => updateForm("description", event.target.value)}
                placeholder="Describe this zone"
                className={`${inputClass} min-h-24`}
              />
            </label>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDrawing(true)}
              className="rounded-xl bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700"
            >
              Draw
            </button>

            <button
              type="button"
              onClick={() => setDrawing(false)}
              className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold hover:bg-gray-50"
            >
              Finish
            </button>

            <button
              type="button"
              onClick={() => applyDraftCoordinates(form.boundary_coordinates.slice(0, -1))}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold hover:bg-gray-50"
            >
              <Undo2 className="h-4 w-4" />
              Undo
            </button>

            <button
              type="button"
              onClick={resetDrawing}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold hover:bg-gray-50"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-60"
          >
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Zone
          </button>

          <div className="mt-5 rounded-xl bg-gray-50 p-4 text-xs text-gray-500">
            <p className="font-semibold text-gray-700">How it works</p>
            <p className="mt-1">Draw the zone on the map. The system saves the polygon automatically.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
