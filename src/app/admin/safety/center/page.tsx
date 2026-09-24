"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { Shield, AlertTriangle, PhoneCall, Search, RefreshCw } from "lucide-react";
import { formatDate } from "@/lib/utils";

export default function SafetyCenterPage() {
  return (
    <PermissionGuard permission="manage_incidents">
      <SafetyCenterContent />
    </PermissionGuard>
  );
}

function SafetyCenterContent() {
  const [sosEvents, setSosEvents] = useState(0);
  const [driverComplaints, setDriverComplaints] = useState(0);
  const [riderComplaints, setRiderComplaints] = useState(0);
  const [harassmentReports, setHarassmentReports] = useState(0);
  const [fraudReports, setFraudReports] = useState(0);
  const [fakeTrips, setFakeTrips] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { count: sosCount } = await supabase.from("emergency_alerts").select("*", { count: "exact", head: true }).eq("type", "sos").maybeSingle();
      setSosEvents(sosCount || 0);

      const { count: driverComp } = await supabase.from("support_tickets").select("*", { count: "exact", head: true }).eq("category", "driver_complaint").maybeSingle();
      setDriverComplaints(driverComp || 0);

      const { count: riderComp } = await supabase.from("support_tickets").select("*", { count: "exact", head: true }).eq("category", "rider_complaint").maybeSingle();
      setRiderComplaints(riderComp || 0);

      // incidents has no anon/authenticated RLS policy -- a direct
      // supabase.from("incidents") read here silently returned 0 even
      // though real rows exist.
      const incidentsRes = await fetch("/api/admin/incidents?status=all");
      const incidentsBody = await incidentsRes.json();
      setFraudReports(incidentsRes.ok ? (incidentsBody.totalCount || 0) : 0);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const metrics = [
    { label: "SOS Events", value: sosEvents, icon: AlertTriangle, color: "text-red-600 bg-red-50" },
    { label: "Driver Complaints", value: driverComplaints, icon: PhoneCall, color: "text-green-600 bg-green-50" },
    { label: "Rider Complaints", value: riderComplaints, icon: PhoneCall, color: "text-amber-600 bg-amber-50" },
    { label: "Harassment Reports", value: harassmentReports, icon: Shield, color: "text-purple-600 bg-purple-50" },
    { label: "Fraud Reports", value: fraudReports, icon: AlertTriangle, color: "text-red-600 bg-red-50" },
    { label: "Fake Trips", value: fakeTrips, icon: AlertTriangle, color: "text-pink-600 bg-pink-50" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Safety Center</h1>
          <p className="text-gray-500 mt-1">SOS events, complaints, harassment, fraud, and fake trip monitoring</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className={`p-2 rounded-lg inline-block mb-2 ${m.color}`}>
              <m.icon className="h-5 w-5" />
            </div>
            <p className="text-xs text-gray-500 font-medium">{m.label}</p>
            <p className="text-2xl font-bold">{loading ? "..." : m.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}