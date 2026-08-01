"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import { RefreshCw, AlertTriangle } from "lucide-react";
import type { Incident } from "@/lib/types";

export default function DisputesPage() {
  return (
    <PermissionGuard permission="manage_disputes">
      <DisputesContent />
    </PermissionGuard>
  );
}

function DisputesContent() {
  const [disputes, setDisputes] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from("ride_disputes").select("*").order("created_at", { ascending: false }).limit(100);
      setDisputes((data as Incident[]) || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  const open = disputes.filter((d) => d.status === "open" || d.status === "investigating");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ride Disputes</h1>
          <p className="text-sm text-gray-500 mt-1">Investigate and resolve rider/driver disputes</p>
        </div>
        <button onClick={fetchDisputes} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500">Total</p><p className="text-2xl font-bold">{disputes.length}</p></div>
        <div className="bg-white rounded-xl border border-red-200 p-4"><div className="flex items-center gap-2 mb-1"><AlertTriangle className="h-4 w-4 text-red-500" /><span className="text-xs font-medium text-red-600">Open</span></div><p className="text-2xl font-bold text-red-600">{open.length}</p></div>
        <div className="bg-white rounded-xl border border-green-200 p-4"><p className="text-xs text-gray-500">Resolved</p><p className="text-2xl font-bold text-green-600">{disputes.filter((d) => d.status === "resolved").length}</p></div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="divide-y divide-gray-100">
          {loading ? <div className="p-6 text-center text-sm text-gray-400">Loading...</div>
          : disputes.length === 0 ? <div className="p-6 text-center text-sm text-gray-400">No disputes found</div>
          : disputes.map((d) => (
            <div key={d.id} className="px-6 py-4 hover:bg-gray-50">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${d.severity === "high" || d.severity === "critical" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{d.severity}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${d.status === "open" ? "bg-red-100 text-red-700" : d.status === "investigating" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{d.status}</span>
                  </div>
                  <p className="text-sm text-gray-900 mt-1">{d.description}</p>
                  <p className="text-xs text-gray-400 mt-1">{d.city} • {new Date(d.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}