"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import { RefreshCw, TrendingUp, DollarSign } from "lucide-react";

interface CommissionRule {
  id: string;
  country_code: string;
  driver_commission_pct: number;
  platform_fee_pct: number;
  min_commission_amount: number;
  is_active: boolean;
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
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("commission_rules")
        .select("*")
        .order("country_code")
        .limit(50);
      if (err) throw new Error(err.message);
      setRules((data as CommissionRule[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load commission rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Commission Rules</h1>
          <p className="text-sm text-gray-500 mt-1">Platform commission and fee structures per country</p>
        </div>
        <button onClick={fetchRules} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <TrendingUp className="h-5 w-5 text-green-600 mb-2" />
          <p className="text-xs text-gray-500">Rules Defined</p>
          <p className="text-2xl font-bold">{rules.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <TrendingUp className="h-5 w-5 text-blue-600 mb-2" />
          <p className="text-xs text-gray-500">Active Rules</p>
          <p className="text-2xl font-bold">{rules.filter((r) => r.is_active).length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <DollarSign className="h-5 w-5 text-amber-600 mb-2" />
          <p className="text-xs text-gray-500">Avg Commission</p>
          <p className="text-2xl font-bold">
            {rules.length > 0
              ? `${(rules.reduce((s, r) => s + r.driver_commission_pct, 0) / rules.length).toFixed(0)}%`
              : "—"}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Country</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">Driver Commission %</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">Platform Fee %</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">Min Commission</th>
                <th className="text-center px-4 py-3 font-medium text-gray-700">Active</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="p-6 text-center text-gray-400">Loading...</td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="p-6 text-center text-red-500">{error}</td></tr>
              ) : rules.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-gray-400">No commission rules defined</td></tr>
              ) : (
                rules.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{r.country_code.toUpperCase()}</td>
                    <td className="px-4 py-3 text-right">{r.driver_commission_pct}%</td>
                    <td className="px-4 py-3 text-right">{r.platform_fee_pct}%</td>
                    <td className="px-4 py-3 text-right">${r.min_commission_amount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${r.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {r.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{new Date(r.updated_at).toLocaleDateString()}</td>
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