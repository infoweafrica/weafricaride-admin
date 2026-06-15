"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import { RefreshCw, Plus, Edit2, X, Car, Bike, Truck, Search } from "lucide-react";
import type { PricingConfig } from "@/lib/types";

const VEHICLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  economy: Car, comfort: Car, xl: Truck, boda: Bike,
  luxury: Car, delivery: Truck,
};

const VEHICLE_LABELS: Record<string, string> = {
  economy: "Economy", comfort: "Comfort", xl: "XL",
  boda: "Boda", luxury: "Luxury", delivery: "Delivery",
  all: "All Vehicles",
};

export default function PricingPage() {
  return (
    <PermissionGuard permission="manage_pricing">
      <PricingContent />
    </PermissionGuard>
  );
}

function PricingContent() {
  const [configs, setConfigs] = useState<PricingConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCity, setFilterCity] = useState("all");
  const [filterVehicle, setFilterVehicle] = useState("all");
  const [filterStatus, setFilterStatus] = useState("active");
  const [editItem, setEditItem] = useState<PricingConfig | null>(null);
  const [editForm, setEditForm] = useState<Partial<PricingConfig>>({});
  const [saving, setSaving] = useState(false);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("pricing_config")
        .select("*")
        .order("country_code")
        .order("city")
        .order("vehicle_type")
        .limit(200);
      if (err) throw new Error(err.message);
      setConfigs((data as PricingConfig[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pricing");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  // ── Filters ──
  const cities = [...new Set(configs.map(c => c.city).filter(Boolean))].sort();
  const vehicleTypes = [...new Set(configs.map(c => c.vehicle_type))].sort();

  const filtered = configs.filter(c => {
    if (filterCity !== "all" && c.city !== filterCity) return false;
    if (filterVehicle !== "all" && c.vehicle_type !== filterVehicle) return false;
    if (filterStatus === "active" && !c.is_active) return false;
    if (filterStatus === "inactive" && c.is_active) return false;
    if (search) {
      const q = search.toLowerCase();
      const label = VEHICLE_LABELS[c.vehicle_type] || c.vehicle_type;
      return label.toLowerCase().includes(q) || (c.city || "").toLowerCase().includes(q);
    }
    return true;
  });

  const resetFilters = () => {
    setSearch("");
    setFilterCity("all");
    setFilterVehicle("all");
    setFilterStatus("active");
  };

  const activeCount = filtered.filter(c => c.is_active).length;
  const filteredCities = [...new Set(filtered.map(c => c.city).filter(Boolean))].length;
  const filteredVehicleTypes = [...new Set(filtered.map(c => c.vehicle_type))].length;

  // ── Edit modal ──
  const openEdit = (c: PricingConfig) => {
    setEditItem(c);
    setEditForm({ ...c });
  };

  const closeEdit = () => {
    setEditItem(null);
    setEditForm({});
  };

  const saveEdit = async () => {
    if (!editItem || !editForm) return;
    setSaving(true);
    try {
      const { error: err } = await supabase.rpc("admin_update_pricing_config", {
        p_config_id: editItem.id,
        p_base_fare: editForm.base_fare,
        p_minimum_fare: editForm.minimum_fare,
        p_per_km: editForm.per_km,
        p_per_min: editForm.per_min,
        p_booking_fee: editForm.booking_fee,
        p_waiting_fee: editForm.waiting_fee,
        p_cancellation_fee: editForm.cancellation_fee,
        p_commission_percent: editForm.commission_percent,
        p_is_active: editForm.is_active,
      });
      if (err) throw new Error(err.message);
      closeEdit();
      fetchConfigs();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c: PricingConfig) => {
    try {
      const { error: err } = await supabase.rpc("admin_update_pricing_config", {
        p_config_id: c.id,
        p_is_active: !c.is_active,
      });
      if (err) throw new Error(err.message);
      fetchConfigs();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Toggle failed");
    }
  };

  const formatCurrency = (v: number, currency?: string) => {
    const sym = currency || "MWK";
    if (v >= 1000) return `${sym} ${(v / 1000).toFixed(1)}k`;
    return `${sym} ${v}`;
  };

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pricing Configuration</h1>
          <p className="text-sm text-gray-500 mt-1">Manage fares for each city and vehicle type</p>
        </div>
        <button onClick={fetchConfigs} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      )}

      {/* ── Filter Bar ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search vehicle/city..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <select value={filterCity} onChange={e => setFilterCity(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="all">All Cities</option>
            {cities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterVehicle} onChange={e => setFilterVehicle(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="all">All Vehicles</option>
            {vehicleTypes.map(v => <option key={v} value={v}>{VEHICLE_LABELS[v] || v}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button onClick={resetFilters} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">
            Reset
          </button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Cities</p>
          <p className="text-2xl font-bold mt-1 text-gray-900">{filteredCities}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Vehicle Types</p>
          <p className="text-2xl font-bold mt-1 text-gray-900">{filteredVehicleTypes}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Active Rules</p>
          <p className="text-2xl font-bold mt-1 text-green-600">{activeCount}</p>
        </div>
      </div>

      {/* ── Pricing Cards ── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
          <p className="text-gray-400 text-sm">No pricing rules match your filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(c => {
            const Icon = VEHICLE_ICONS[c.vehicle_type] || Car;
            const label = VEHICLE_LABELS[c.vehicle_type] || c.vehicle_type;
            return (
              <div key={c.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                {/* Card header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-50 rounded-lg">
                      <Icon className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{label}</p>
                      <p className="text-xs text-gray-400">{c.city || "All Cities"}</p>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                    c.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${c.is_active ? "bg-green-500" : "bg-gray-400"}`}></span>
                    {c.is_active ? "Active" : "Inactive"}
                  </span>
                </div>

                {/* Card body — fare grid */}
                <div className="px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-3">
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Base Fare</span>
                    <span className="text-xs font-semibold text-gray-900">{formatCurrency(c.base_fare, c.currency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Minimum Fare</span>
                    <span className="text-xs font-semibold text-gray-900">{formatCurrency(c.minimum_fare, c.currency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Per Kilometer</span>
                    <span className="text-xs font-semibold text-gray-900">{formatCurrency(c.per_km, c.currency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Per Minute</span>
                    <span className="text-xs font-semibold text-gray-900">{formatCurrency(c.per_min, c.currency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Booking Fee</span>
                    <span className="text-xs font-semibold text-gray-900">{c.booking_fee > 0 ? formatCurrency(c.booking_fee, c.currency) : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Waiting Fee</span>
                    <span className="text-xs font-semibold text-gray-900">{formatCurrency(c.waiting_fee, c.currency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Cancellation</span>
                    <span className="text-xs font-semibold text-gray-900">{formatCurrency(c.cancellation_fee, c.currency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Surge</span>
                    <span className="text-xs font-semibold text-gray-900">{c.surge_multiplier}x</span>
                  </div>
                  <div className="flex justify-between col-span-2">
                    <span className="text-xs text-gray-500">Commission</span>
                    <span className="text-xs font-semibold text-gray-900">{c.commission_percent}%</span>
                  </div>
                </div>

                {/* Card footer — actions */}
                <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/50">
                  <button
                    onClick={() => openEdit(c)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    <Edit2 className="h-3.5 w-3.5" /> Edit Pricing
                  </button>
                  <button
                    onClick={() => toggleActive(c)}
                    className={`flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
                      c.is_active
                        ? "text-red-600 bg-red-50 hover:bg-red-100"
                        : "text-green-600 bg-green-50 hover:bg-green-100"
                    }`}
                  >
                    {c.is_active ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeEdit}></div>
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Edit Pricing Rule</h2>
              <button onClick={closeEdit} className="p-1 hover:bg-gray-100 rounded-lg"><X className="h-5 w-5 text-gray-400" /></button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Vehicle Type</label>
                <select
                  disabled
                  value={editForm.vehicle_type || ""}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500"
                >
                  <option>{VEHICLE_LABELS[editForm.vehicle_type || ""] || editForm.vehicle_type}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">City</label>
                <select
                  disabled
                  value={editForm.city || ""}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500"
                >
                  <option>{editForm.city || "All Cities"}</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Base Fare</label>
                  <input type="number" value={editForm.base_fare || 0} onChange={e => setEditForm({...editForm, base_fare: +e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Minimum Fare</label>
                  <input type="number" value={editForm.minimum_fare || 0} onChange={e => setEditForm({...editForm, minimum_fare: +e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Per Kilometer</label>
                  <input type="number" value={editForm.per_km || 0} onChange={e => setEditForm({...editForm, per_km: +e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Per Minute</label>
                  <input type="number" value={editForm.per_min || 0} onChange={e => setEditForm({...editForm, per_min: +e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Booking Fee</label>
                  <input type="number" value={editForm.booking_fee || 0} onChange={e => setEditForm({...editForm, booking_fee: +e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Waiting Fee</label>
                  <input type="number" value={editForm.waiting_fee || 0} onChange={e => setEditForm({...editForm, waiting_fee: +e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Cancellation Fee</label>
                  <input type="number" value={editForm.cancellation_fee || 0} onChange={e => setEditForm({...editForm, cancellation_fee: +e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Surge Multiplier</label>
                  <input type="number" step="0.1" value={editForm.surge_multiplier || 1.0} onChange={e => setEditForm({...editForm, surge_multiplier: +e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Commission %</label>
                  <input type="number" value={editForm.commission_percent || 0} onChange={e => setEditForm({...editForm, commission_percent: +e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                  <select value={editForm.is_active ? "active" : "inactive"} onChange={e => setEditForm({...editForm, is_active: e.target.value === "active"})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl">
              <button onClick={closeEdit} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-100">Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50">
                {saving ? (
                  <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> Saving...</>
                ) : (
                  "Save Pricing"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}