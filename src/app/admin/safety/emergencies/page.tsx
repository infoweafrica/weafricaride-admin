"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import { RefreshCw, Siren, Phone, MapPin, Clock, AlertCircle } from "lucide-react";
import type { EmergencyAlert, EmergencyStatus } from "@/lib/types";

const STATUS_COLORS: Record<EmergencyStatus, string> = {
  active: "bg-red-100 text-red-700",
  responding: "bg-amber-100 text-amber-700",
  resolved: "bg-green-100 text-green-700",
  false_alarm: "bg-gray-100 text-gray-600",
};

export default function EmergenciesPage() {
  return (
    <PermissionGuard permission="manage_emergencies">
      <EmergenciesContent />
    </PermissionGuard>
  );
}

function EmergenciesContent() {
  const [emergencies, setEmergencies] = useState<EmergencyAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEmergencies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("emergency_alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (err) throw new Error(err.message);
      setEmergencies((data as EmergencyAlert[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load emergencies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmergencies();
    const interval = setInterval(fetchEmergencies, 10000);
    return () => clearInterval(interval);
  }, [fetchEmergencies]);

  const activeCount = emergencies.filter((e) => e.status === "active").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Emergency Alerts</h1>
          <p className="text-sm text-gray-500 mt-1">Active SOS alerts and emergency responses</p>
        </div>
        <button
          onClick={fetchEmergencies}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {activeCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="h-6 w-6 text-red-600 flex-shrink-0" />
          <div>
            <p className="font-semibold text-red-700">{activeCount} active emergency alert(s)</p>
            <p className="text-sm text-red-600">Immediate attention required</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total" value={emergencies.length} color="text-gray-700" />
        <StatCard label="Active" value={activeCount} color="text-red-600" />
        <StatCard label="Responding" value={emergencies.filter((e) => e.status === "responding").length} color="text-amber-600" />
        <StatCard label="Resolved" value={emergencies.filter((e) => e.status === "resolved").length} color="text-green-600" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">All Alerts</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {loading ? (
            <div className="p-6 text-center text-sm text-gray-400">Loading...</div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-red-500">{error}</div>
          ) : emergencies.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No emergencies reported</div>
          ) : (
            emergencies.map((em) => (
              <div key={em.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Siren className={`h-4 w-4 ${em.status === "active" ? "text-red-500" : "text-gray-400"}`} />
                      <span className="text-sm font-medium">{em.type}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[em.status]}`}>
                        {em.status.replace("_", " ")}
                      </span>
                    </div>
                    {em.description && (
                      <p className="text-sm text-gray-600 mt-1">{em.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {em.city}</span>
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(em.created_at).toLocaleString()}</span>
                      <span>Lat: {em.latitude.toFixed(4)}, Lng: {em.longitude.toFixed(4)}</span>
                    </div>
                  </div>
                  {em.status === "active" && (
                    <button className="ml-4 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700">
                      Respond
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}