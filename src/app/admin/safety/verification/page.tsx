"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { Shield, CheckCircle, XCircle, Clock, Search, RefreshCw } from "lucide-react";

function VerificationPageInner() {
  const [stats, setStats] = useState({ verified: 0, pending: 0, rejected: 0, expired: 0 });
  const [loading, setLoading] = useState(true);

  // drivers has no anon/authenticated RLS policy -- querying it directly
  // with the browser's anon-key client silently returns zero rows, no
  // error, which is why every stat here always showed 0. The
  // service-role-backed /api/drivers/verification-stats route already
  // existed and computed this correctly; this page just wasn't calling it.
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/drivers/verification-stats");
      const body = await res.json();
      if (res.ok && body.stats) setStats(body.stats);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const items = [
    { label: "Identity Verified", value: stats.verified, icon: CheckCircle, color: "text-green-600 bg-green-50" },
    { label: "Pending Review", value: stats.pending, icon: Clock, color: "text-amber-600 bg-amber-50" },
    { label: "Rejected", value: stats.rejected, icon: XCircle, color: "text-red-600 bg-red-50" },
    { label: "Expired Documents", value: stats.expired, icon: Shield, color: "text-gray-600 bg-gray-50" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Driver Verification</h1>
          <p className="text-gray-500 mt-1">License status, vehicle insurance, inspection, criminal checks, identity verification</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {items.map((item) => (
          <div key={item.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className={`p-2 rounded-lg inline-block mb-2 ${item.color}`}>
              <item.icon className="h-5 w-5" />
            </div>
            <p className="text-xs text-gray-500 font-medium">{item.label}</p>
            <p className="text-2xl font-bold">{loading ? "..." : item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function VerificationPage() {
  return (
    <PermissionGuard permission="approve_drivers">
      <VerificationPageInner />
    </PermissionGuard>
  );
}