"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { RefreshCw, AlertTriangle, Shield, Search } from "lucide-react";
import type { Incident, IncidentSeverity, IncidentStatus } from "@/lib/types";

const SEVERITY_COLORS: Record<IncidentSeverity, string> = {
  low: "bg-blue-100 text-blue-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-green-100 text-green-700",
  critical: "bg-red-100 text-red-700",
};

const STATUS_COLORS: Record<IncidentStatus, string> = {
  open: "bg-red-100 text-red-700",
  investigating: "bg-amber-100 text-amber-700",
  resolved: "bg-green-100 text-green-700",
  escalated: "bg-purple-100 text-purple-700",
};

export default function IncidentsPage() {
  return (
    <PermissionGuard permission="manage_incidents">
      <IncidentsContent />
    </PermissionGuard>
  );
}

function IncidentsContent() {
  const [allIncidents, setAllIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<IncidentStatus | "all">("all");

  // Always fetched unfiltered -- filter only narrows the displayed list
  // client-side, so the stat tiles above always reflect true totals
  // instead of whatever subset the currently-selected tab narrowed the
  // fetch down to.
  const fetchIncidents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/incidents?status=all");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load incidents");
      setAllIncidents((body.data as Incident[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load incidents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  const incidents = filter === "all" ? allIncidents : allIncidents.filter((i) => i.status === filter);
  const open = allIncidents.filter((i) => i.status === "open" || i.status === "investigating");
  const critical = allIncidents.filter((i) => i.severity === "critical" || i.severity === "high");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Incidents</h1>
          <p className="text-sm text-gray-500 mt-1">Manage safety incidents and investigations</p>
        </div>
        <button
          onClick={fetchIncidents}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500">Total</p>
          <p className="text-2xl font-bold">{allIncidents.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-red-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <span className="text-xs font-medium text-red-600">Open / Investigating</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{open.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-green-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="h-4 w-4 text-green-500" />
            <span className="text-xs font-medium text-green-600">High Severity</span>
          </div>
          <p className="text-2xl font-bold text-green-600">{critical.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-green-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="h-4 w-4 text-green-500" />
            <span className="text-xs font-medium text-green-600">Resolved</span>
          </div>
          <p className="text-2xl font-bold text-green-600">
            {allIncidents.filter((i) => i.status === "resolved").length}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "open", "investigating", "resolved", "escalated"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${
              filter === s ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Incident list */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="divide-y divide-gray-100">
          {loading ? (
            <div className="p-6 text-center text-sm text-gray-400">Loading...</div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-red-500">{error}</div>
          ) : incidents.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No incidents found</div>
          ) : (
            incidents.map((inc) => (
              <div key={inc.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_COLORS[inc.severity]}`}>
                        {inc.severity}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inc.status]}`}>
                        {inc.status}
                      </span>
                      <span className="text-xs text-gray-400">{inc.type}</span>
                    </div>
                    <p className="text-sm text-gray-900 mt-1">{inc.description}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-gray-400">{inc.city}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(inc.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}