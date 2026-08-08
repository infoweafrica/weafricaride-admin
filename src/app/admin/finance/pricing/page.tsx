"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { RefreshCw, Edit2, Save, X, Car, Bike, Truck } from "lucide-react";
import type { PricingConfig } from "@/lib/types";

const VEHICLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  economy: Car, comfort: Car, xl: Truck, boda: Bike,
  luxury: Car, delivery: Truck,
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<PricingConfig>>({});

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pricing");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load pricing");
      setConfigs((body.data as PricingConfig[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pricing");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const startEdit = (c: PricingConfig) => {
    setEditingId(c.id);
    setEditForm({ ...c });
  };

  const saveEdit = async () => {
    if (!editingId || !editForm) return;
    try {
      const res = await fetch(`/api/admin/pricing/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Save failed");
      setEditingId(null);
      fetchConfigs();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    }
  };

  const cities = [...new Set(configs.map(c => c.city).filter(Boolean))];
  const vehicleTypes = [...new Set(configs.map(c => c.vehicle_type))];

  const totalConfigs = configs.length;
  const activeConfigs = configs.filter(c => c.is_active).length;
  const avgCommission = configs.length > 0
    ? (configs.reduce((s, c) => s + (c.commission_percent || 0), 0) / configs.length).toFixed(1)
    : "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pricing Configuration</h1>
          <p className="text-sm text-gray-500 mt-1">Manage fare rates per vehicle type, city, and country</p>
        </div>
        <button onClick={fetchConfigs} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Configs</p>
          <p className="text-xl font-bold mt-1">{totalConfigs}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Active</p>
          <p className="text-xl font-bold mt-1 text-green-600">{activeConfigs}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Vehicle Types</p>
          <p className="text-xl font-bold mt-1">{vehicleTypes.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Avg Commission</p>
          <p className="text-xl font-bold mt-1 text-purple-600">{avgCommission}%</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-3 font-medium text-gray-700">Vehicle</th>
                <th className="text-left px-3 py-3 font-medium text-gray-700">City</th>
                <th className="text-right px-3 py-3 font-medium text-gray-700">Base</th>
                <th className="text-right px-3 py-3 font-medium text-gray-700">Min</th>
                <th className="text-right px-3 py-3 font-medium text-gray-700">/KM</th>
                <th className="text-right px-3 py-3 font-medium text-gray-700">/Min</th>
                <th className="text-right px-3 py-3 font-medium text-gray-700">Book</th>
                <th className="text-right px-3 py-3 font-medium text-gray-700">Wait</th>
                <th className="text-right px-3 py-3 font-medium text-gray-700">Cancel</th>
                <th className="text-right px-3 py-3 font-medium text-gray-700">Surge</th>
                <th className="text-right px-3 py-3 font-medium text-gray-700">Comm%</th>
                <th className="text-center px-3 py-3 font-medium text-gray-700">Active</th>
                <th className="text-center px-3 py-3 font-medium text-gray-700"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={13} className="p-6 text-center text-gray-400">Loading...</td></tr>
              ) : error ? (
                <tr><td colSpan={13} className="p-6 text-center text-red-500">{error}</td></tr>
              ) : configs.length === 0 ? (
                <tr><td colSpan={13} className="p-6 text-center text-gray-400">No pricing configs</td></tr>
              ) : (
                configs.map((c) => {
                  const Icon = VEHICLE_ICONS[c.vehicle_type] || Car;
                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-gray-400" />
                          <span className="font-medium capitalize text-xs">{c.vehicle_type}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500">{c.city || "All"}</td>
                      {editingId === c.id ? (
                        <>
                          <td className="px-2 py-3"><input type="number" value={editForm.base_fare || 0} onChange={e => setEditForm({...editForm, base_fare: +e.target.value})} className="w-16 border rounded px-1 py-1 text-right text-xs" /></td>
                          <td className="px-2 py-3"><input type="number" value={editForm.minimum_fare || 0} onChange={e => setEditForm({...editForm, minimum_fare: +e.target.value})} className="w-16 border rounded px-1 py-1 text-right text-xs" /></td>
                          <td className="px-2 py-3"><input type="number" value={editForm.per_km || 0} onChange={e => setEditForm({...editForm, per_km: +e.target.value})} className="w-16 border rounded px-1 py-1 text-right text-xs" /></td>
                          <td className="px-2 py-3"><input type="number" value={editForm.per_min || 0} onChange={e => setEditForm({...editForm, per_min: +e.target.value})} className="w-16 border rounded px-1 py-1 text-right text-xs" /></td>
                          <td className="px-2 py-3"><input type="number" value={editForm.booking_fee || 0} onChange={e => setEditForm({...editForm, booking_fee: +e.target.value})} className="w-14 border rounded px-1 py-1 text-right text-xs" /></td>
                          <td className="px-2 py-3"><input type="number" value={editForm.waiting_fee || 0} onChange={e => setEditForm({...editForm, waiting_fee: +e.target.value})} className="w-14 border rounded px-1 py-1 text-right text-xs" /></td>
                          <td className="px-2 py-3"><input type="number" value={editForm.cancellation_fee || 0} onChange={e => setEditForm({...editForm, cancellation_fee: +e.target.value})} className="w-14 border rounded px-1 py-1 text-right text-xs" /></td>
                          <td className="px-2 py-3"><input type="number" step="0.1" value={editForm.surge_multiplier || 0} onChange={e => setEditForm({...editForm, surge_multiplier: +e.target.value})} className="w-14 border rounded px-1 py-1 text-right text-xs" /></td>
                          <td className="px-2 py-3"><input type="number" value={editForm.commission_percent || 0} onChange={e => setEditForm({...editForm, commission_percent: +e.target.value})} className="w-14 border rounded px-1 py-1 text-right text-xs" /></td>
                          <td className="px-3 py-3 text-center">—</td>
                          <td className="px-3 py-3">
                            <div className="flex gap-1 justify-center">
                              <button onClick={saveEdit} className="p-1 text-green-600 hover:bg-green-50 rounded"><Save className="h-4 w-4" /></button>
                              <button onClick={() => setEditingId(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X className="h-4 w-4" /></button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-3 text-right text-xs">{c.currency} {c.base_fare.toFixed(0)}</td>
                          <td className="px-3 py-3 text-right text-xs">{c.currency} {c.minimum_fare.toFixed(0)}</td>
                          <td className="px-3 py-3 text-right text-xs">{c.per_km.toFixed(0)}</td>
                          <td className="px-3 py-3 text-right text-xs">{c.per_min.toFixed(0)}</td>
                          <td className="px-3 py-3 text-right text-xs">{c.booking_fee > 0 ? c.booking_fee.toFixed(0) : "—"}</td>
                          <td className="px-3 py-3 text-right text-xs">{c.waiting_fee.toFixed(0)}</td>
                          <td className="px-3 py-3 text-right text-xs">{c.cancellation_fee.toFixed(0)}</td>
                          <td className="px-3 py-3 text-right text-xs">{c.surge_multiplier}x</td>
                          <td className="px-3 py-3 text-right text-xs">{c.commission_percent}%</td>
                          <td className="px-3 py-3 text-center">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${c.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                              {c.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <button onClick={() => startEdit(c)} className="p-1 text-blue-600 hover:bg-blue-50 rounded"><Edit2 className="h-4 w-4" /></button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}