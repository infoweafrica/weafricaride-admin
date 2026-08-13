"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

// ride_disputes' real columns — the generic Incident type (built for a
// different table) doesn't match this shape (e.g. it has no `priority`,
// `ride_payment_method`, `refund_amount`), so this page defines its own.
type RideDispute = {
  id: string;
  dispute_number: string;
  ride_id: string | null;
  opened_by: string;
  dispute_type: string;
  priority: string;
  status: string;
  rider_id: string | null;
  driver_id: string | null;
  city: string | null;
  description: string;
  ride_fare: number;
  ride_payment_method: string | null;
  refund_amount: number;
  penalty_amount: number;
  resolution: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
};

const RESOLUTION_OPTIONS = [
  { value: "confirmed_driver", label: "Confirm Driver" },
  { value: "confirmed_rider", label: "Confirm Rider" },
  { value: "marked_partial", label: "Mark Partial" },
  { value: "marked_paid", label: "Mark Paid" },
  { value: "reversed", label: "Reverse Payment" },
];

export default function DisputesPage() {
  return (
    <PermissionGuard permission="manage_disputes">
      <DisputesContent />
    </PermissionGuard>
  );
}

function DisputesContent() {
  const { adminProfile } = useAuth();
  const [disputes, setDisputes] = useState<RideDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionChoice, setResolutionChoice] = useState<Record<string, string>>({});
  const [resolutionNote, setResolutionNote] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from("ride_disputes").select("*").order("created_at", { ascending: false }).limit(100);
      setDisputes((data as RideDispute[]) || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  const open = disputes.filter((d) => d.status === "open" || d.status === "investigating");

  const submitResolution = async (dispute: RideDispute) => {
    const resolutionStatus = resolutionChoice[dispute.id];
    const note = resolutionNote[dispute.id]?.trim();
    if (!resolutionStatus || !note) {
      setError("Pick a resolution and enter a reason before submitting.");
      return;
    }
    if (!adminProfile?.id) {
      setError("Missing admin session — please re-login.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("resolve_cash_dispute", {
        p_dispute_id: dispute.id,
        p_admin_id: adminProfile.id,
        p_resolution_status: resolutionStatus,
        p_resolution_note: note,
      });
      if (rpcError) throw rpcError;
      if (!data?.success) throw new Error(data?.error || "Could not resolve dispute");
      setResolvingId(null);
      await fetchDisputes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve dispute");
    } finally {
      setSubmitting(false);
    }
  };

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

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="divide-y divide-gray-100">
          {loading ? <div className="p-6 text-center text-sm text-gray-400">Loading...</div>
          : disputes.length === 0 ? <div className="p-6 text-center text-sm text-gray-400">No disputes found</div>
          : disputes.map((d) => (
            <div key={d.id} className="px-6 py-4 hover:bg-gray-50">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${d.priority === "high" || d.priority === "critical" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{d.priority}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${d.status === "open" ? "bg-red-100 text-red-700" : d.status === "investigating" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{d.status}</span>
                    {d.dispute_type === "payment" && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">payment</span>
                    )}
                    <span className="text-xs text-gray-400">{d.dispute_number}</span>
                  </div>
                  <p className="text-sm text-gray-900 mt-1">{d.description}</p>
                  {d.dispute_type === "payment" && (
                    <p className="text-xs text-gray-500 mt-1">
                      Fare: MWK {d.ride_fare?.toLocaleString() ?? "—"} · Method: {d.ride_payment_method ?? "—"}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">{d.city} • {new Date(d.created_at).toLocaleDateString()}</p>
                  {d.status === "resolved" && d.resolution && (
                    <p className="text-xs text-green-700 mt-2 bg-green-50 rounded px-2 py-1 inline-block">Resolved: {d.resolution}</p>
                  )}
                </div>
                {d.status !== "resolved" && (
                  <button
                    onClick={() => setResolvingId(resolvingId === d.id ? null : d.id)}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
                  >
                    {resolvingId === d.id ? "Cancel" : "Resolve"}
                  </button>
                )}
              </div>

              {resolvingId === d.id && (
                <div className="mt-3 bg-gray-50 rounded-lg p-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {RESOLUTION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setResolutionChoice((s) => ({ ...s, [d.id]: opt.value }))}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                          resolutionChoice[d.id] === opt.value
                            ? "bg-green-600 text-white border-green-600"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={resolutionNote[d.id] || ""}
                    onChange={(e) => setResolutionNote((s) => ({ ...s, [d.id]: e.target.value }))}
                    placeholder="Reason for this resolution (required, becomes part of the audit trail)"
                    className="w-full text-sm rounded-lg border border-gray-300 px-3 py-2"
                    rows={2}
                  />
                  <button
                    onClick={() => submitResolution(d)}
                    disabled={submitting}
                    className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    {submitting ? "Submitting..." : "Confirm Resolution"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
