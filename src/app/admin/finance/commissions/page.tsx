"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { RefreshCw, TrendingUp, DollarSign, Edit2, Save, X } from "lucide-react";

interface CommissionConfig {
  id: string;
  vehicle_class: string;
  commission_percent: number;
  driver_percent: number;
  min_commission: number;
  max_commission: number;
  is_active: boolean;
  notes: string | null;
  updated_at: string;
}

export default function CommissionsPage() {
  return (
    <PermissionGuard permission="manage_pricing">
      <CommissionsContent />
    </PermissionGuard>
  );
}

function CommissionsContent() {
  const [configs, setConfigs] = useState<CommissionConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingClass, setEditingClass] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<CommissionConfig>>({});

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/commissions");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load commission configs");
      setConfigs((body.data as CommissionConfig[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load commission configs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const startEdit = (c: CommissionConfig) => {
    setEditingClass(c.vehicle_class);
    setEditForm({ ...c });
  };

  const saveEdit = async () => {
    if (!editingClass) return;
    try {
      const res = await fetch(`/api/admin/commissions/${editingClass}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Save failed");
      setEditingClass(null);
      fetchConfigs();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Commission Configuration</h1>
          <p className="text-sm text-gray-500 mt-1">Platform commission and driver split per vehicle class</p>
        </div>
        <button onClick={fetchConfigs} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <TrendingUp className="h-5 w-5 text-green-600 mb-2" />
          <p className="text-xs text-gray-500">Vehicle Classes</p>
          <p className="text-2xl font-bold">{configs.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <TrendingUp className="h-5 w-5 text-blue-600 mb-2" />
          <p className="text-xs text-gray-500">Active</p>
          <p className="text-2xl font-bold">{configs.filter((c) => c.is_active).length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <DollarSign className="h-5 w-5 text-amber-600 mb-2" />
          <p className="text-xs text-gray-500">Avg Commission</p>
          <p className="text-2xl font-bold">
            {configs.length > 0
              ? `${(configs.reduce((s, c) => s + c.commission_percent, 0) / configs.length).toFixed(0)}%`
              : "—"}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Vehicle Class</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">Commission %</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">Driver %</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">Min Commission</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">Max Commission</th>
                <th className="text-center px-4 py-3 font-medium text-gray-700">Active</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Last Updated</th>
                <th className="text-center px-4 py-3 font-medium text-gray-700"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="p-6 text-center text-gray-400">Loading...</td></tr>
              ) : error ? (
                <tr><td colSpan={8} className="p-6 text-center text-red-500">{error}</td></tr>
              ) : configs.length === 0 ? (
                <tr><td colSpan={8} className="p-6 text-center text-gray-400">No commission configs</td></tr>
              ) : (
                configs.map((c) => (
                  <tr key={c.vehicle_class} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium capitalize">{c.vehicle_class}</td>
                    {editingClass === c.vehicle_class ? (
                      <>
                        <td className="px-2 py-3">
                          <input type="number" step="0.1" value={editForm.commission_percent ?? 0}
                            onChange={(e) => setEditForm({ ...editForm, commission_percent: +e.target.value })}
                            className="w-20 border rounded px-1 py-1 text-right text-xs" />
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-gray-400">
                          {editForm.commission_percent !== undefined ? (100 - editForm.commission_percent).toFixed(1) : "—"}
                        </td>
                        <td className="px-2 py-3">
                          <input type="number" value={editForm.min_commission ?? 0}
                            onChange={(e) => setEditForm({ ...editForm, min_commission: +e.target.value })}
                            className="w-20 border rounded px-1 py-1 text-right text-xs" />
                        </td>
                        <td className="px-2 py-3">
                          <input type="number" value={editForm.max_commission ?? 0}
                            onChange={(e) => setEditForm({ ...editForm, max_commission: +e.target.value })}
                            className="w-20 border rounded px-1 py-1 text-right text-xs" />
                        </td>
                        <td className="px-4 py-3 text-center">—</td>
                        <td className="px-4 py-3">—</td>
                        <td className="px-3 py-3">
                          <div className="flex gap-1 justify-center">
                            <button onClick={saveEdit} className="p-1 text-green-600 hover:bg-green-50 rounded"><Save className="h-4 w-4" /></button>
                            <button onClick={() => setEditingClass(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X className="h-4 w-4" /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-right">{c.commission_percent}%</td>
                        <td className="px-4 py-3 text-right text-gray-500">{c.driver_percent}%</td>
                        <td className="px-4 py-3 text-right">{c.min_commission?.toFixed(2) ?? "—"}</td>
                        <td className="px-4 py-3 text-right">{c.max_commission?.toFixed(2) ?? "—"}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${c.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                            {c.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{new Date(c.updated_at).toLocaleDateString()}</td>
                        <td className="px-3 py-3 text-center">
                          <button onClick={() => startEdit(c)} className="p-1 text-blue-600 hover:bg-blue-50 rounded"><Edit2 className="h-4 w-4" /></button>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
