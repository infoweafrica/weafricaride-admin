"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { AlertTriangle, Shield, UserX, MapPin, Gift, RefreshCw, Search } from "lucide-react";
import { formatDate } from "@/lib/utils";

type FraudCase = {
  id: string;
  type: string;
  status: string;
  severity: string;
  description: string;
  entity_id: string;
  entity_type: string;
  detected_at: string;
};

export default function FraudDetectionPage() {
  const [cases, setCases] = useState<FraudCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchCases = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("fraud_cases")
        .select("id, type, status, severity, description, entity_id, entity_type, detected_at")
        .order("detected_at", { ascending: false })
        .limit(50);

      if (data) setCases(data as FraudCase[]);
    } catch (err) {
      console.error("Fraud detection not available:", err);
      setCases([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  const fraudTypes = [
    { type: "fake_accounts", label: "Fake Accounts", icon: UserX, color: "text-red-600 bg-red-50" },
    { type: "fake_trips", label: "Fake Trips", icon: MapPin, color: "text-orange-600 bg-orange-50" },
    { type: "gps_spoofing", label: "GPS Spoofing", icon: MapPin, color: "text-yellow-600 bg-yellow-50" },
    { type: "payment_fraud", label: "Payment Fraud", icon: AlertTriangle, color: "text-purple-600 bg-purple-50" },
    { type: "promo_abuse", label: "Promo Abuse", icon: Gift, color: "text-pink-600 bg-pink-50" },
  ];

  const counts = fraudTypes.map((ft) => ({
    ...ft,
    count: cases.filter((c) => c.type === ft.type).length,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fraud Detection</h1>
          <p className="text-gray-500 mt-1">Monitor fake accounts, fake trips, GPS spoofing, payment fraud, and promo abuse</p>
        </div>
        <button onClick={fetchCases} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Fraud Type Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {counts.map((ft) => (
          <div key={ft.type} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className={`p-2 rounded-lg inline-block mb-2 ${ft.color}`}>
              <ft.icon className="h-5 w-5" />
            </div>
            <p className="text-lg font-bold">{ft.count}</p>
            <p className="text-xs text-gray-500">{ft.label}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input type="text" placeholder="Search fraud cases..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
      </div>

      {/* Fraud Cases Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Entity</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Severity</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Description</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Detected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Loading...</td></tr>
              ) : cases.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center">
                  <Shield className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-400 text-sm">No fraud cases detected</p>
                  <p className="text-xs text-gray-300 mt-1">Requires a <code className="bg-gray-100 px-1 rounded">fraud_cases</code> table</p>
                </td></tr>
              ) : (
                cases.filter((c) => c.type.includes(search) || c.description?.includes(search)).map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="capitalize text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700">
                        {c.type.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-500">{c.entity_id?.slice(0, 12)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${
                        c.status === "blocked" ? "text-red-600" :
                        c.status === "review" ? "text-amber-600" : "text-green-600"
                      }`}>{c.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${
                        c.severity === "high" || c.severity === "critical" ? "text-red-600" :
                        c.severity === "medium" ? "text-amber-600" : "text-gray-500"
                      }`}>{c.severity}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-xs truncate">{c.description}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(c.detected_at)}</td>
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