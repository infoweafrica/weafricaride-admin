"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import { RefreshCw, Tag, Plus } from "lucide-react";
import type { PromoCode, PromoStatus } from "@/lib/types";

const STATUS_COLORS: Record<PromoStatus, string> = {
  active: "bg-green-100 text-green-700",
  scheduled: "bg-blue-100 text-blue-700",
  expired: "bg-gray-100 text-gray-500",
  disabled: "bg-red-100 text-red-700",
};

export default function PromosPage() {
  return (
    <PermissionGuard permission="manage_promotions">
      <PromosContent />
    </PermissionGuard>
  );
}

function PromosContent() {
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPromos = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from("promo_codes").select("*").order("created_at", { ascending: false }).limit(100);
      setPromos((data as PromoCode[]) || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchPromos(); }, [fetchPromos]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Promo Codes</h1>
          <p className="text-sm text-gray-500 mt-1">Create and manage promotional campaigns</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchPromos} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
            <Plus className="h-4 w-4" /> Create Promo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total" value={promos.length} />
        <StatCard label="Active" value={promos.filter((p) => p.status === "active").length} color="text-green-600" />
        <StatCard label="Scheduled" value={promos.filter((p) => p.status === "scheduled").length} color="text-blue-600" />
        <StatCard label="Expired" value={promos.filter((p) => p.status === "expired").length} color="text-gray-500" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Code</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Type</th>
              <th className="text-right px-4 py-3 font-medium text-gray-700">Value</th>
              <th className="text-center px-4 py-3 font-medium text-gray-700">Uses</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Target</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Expires</th>
              <th className="text-center px-4 py-3 font-medium text-gray-700">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? <tr><td colSpan={7} className="p-6 text-center text-gray-400">Loading...</td></tr>
            : promos.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-gray-400">No promo codes found</td></tr>
            : promos.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono font-medium">{p.code}</td>
                <td className="px-4 py-3 text-gray-500 capitalize">{p.type}</td>
                <td className="px-4 py-3 text-right">{p.type === "percentage" ? `${p.value}%` : `$${p.value}`}</td>
                <td className="px-4 py-3 text-center">{p.current_uses}{p.max_uses ? ` / ${p.max_uses}` : ""}</td>
                <td className="px-4 py-3 text-gray-500 capitalize">{p.recipient_type.replace(/_/g, " ")}</td>
                <td className="px-4 py-3 text-gray-500">{p.expires_at ? new Date(p.expires_at).toLocaleDateString() : "Never"}</td>
                <td className="px-4 py-3 text-center"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status]}`}>{p.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, color = "text-gray-700" }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}