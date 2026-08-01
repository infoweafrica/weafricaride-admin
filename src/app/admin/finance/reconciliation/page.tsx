"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { RefreshCw, CheckCircle, AlertTriangle, Search } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type ReconciliationRow = {
  method: string;
  ledger_total: number;
  provider_total: number;
  difference: number;
  status: string;
  transaction_count: number;
};

export default function ReconciliationPage() {
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ total_ledger: 0, total_provider: 0, total_difference: 0, matched_pct: 0 });
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const dayStart = new Date(date + "T00:00:00").toISOString();
      const dayEnd = new Date(date + "T23:59:59").toISOString();

      // Fetch completed rides grouped by payment method for the day
      const { data: rides } = await supabase
        .from("rides")
        .select("payment_method, fare_amount, commission_amount, status")
        .eq("status", "completed")
        .gte("completed_at", dayStart)
        .lte("completed_at", dayEnd);

      // Fetch payments table for the day
      const { data: payments } = await supabase
        .from("payments")
        .select("method, amount, status")
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd);

      // Fetch company commissions for the day
      const { data: commissions } = await supabase
        .from("company_commissions")
        .select("amount, payment_method, status")
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd);

      // Aggregate by payment method
      const methods = ["airtel_money", "tnm_mpamba", "cash", "card", "wallet"];
      const methodLabels: Record<string, string> = {
        airtel_money: "Airtel Money",
        tnm_mpamba: "TNM Mpamba",
        cash: "Cash",
        card: "Card",
        wallet: "Wallet",
      };

      // Ledger totals from rides
      const ledgerByMethod: Record<string, number> = {};
      const countByMethod: Record<string, number> = {};
      (rides || []).forEach((r: any) => {
        const m = r.payment_method || "cash";
        ledgerByMethod[m] = (ledgerByMethod[m] || 0) + (r.fare_amount || 0);
        countByMethod[m] = (countByMethod[m] || 0) + 1;
      });

      // Provider totals from payments
      const providerByMethod: Record<string, number> = {};
      (payments || []).forEach((p: any) => {
        const m = p.method || "cash";
        if (p.status === "completed" || p.status === "success") {
          providerByMethod[m] = (providerByMethod[m] || 0) + (p.amount || 0);
        }
      });

      const reconciledRows: ReconciliationRow[] = methods.map((m) => {
        const ledger = ledgerByMethod[m] || 0;
        const provider = providerByMethod[m] || 0;
        const diff = Math.abs(ledger - provider);
        const status = diff === 0 ? "Matched" : diff < 1000 ? "Minor Diff" : "Review";
        return {
          method: methodLabels[m] || m,
          ledger_total: ledger,
          provider_total: provider,
          difference: diff,
          status,
          transaction_count: countByMethod[m] || 0,
        };
      }).filter(r => r.ledger_total > 0 || r.provider_total > 0);

      const totalLedger = reconciledRows.reduce((s, r) => s + r.ledger_total, 0);
      const totalProvider = reconciledRows.reduce((s, r) => s + r.provider_total, 0);
      const totalDiff = reconciledRows.reduce((s, r) => s + r.difference, 0);
      const matchedCount = reconciledRows.filter(r => r.status === "Matched").length;

      setRows(reconciledRows);
      setSummary({
        total_ledger: totalLedger,
        total_provider: totalProvider,
        total_difference: totalDiff,
        matched_pct: reconciledRows.length > 0 ? Math.round((matchedCount / reconciledRows.length) * 100) : 100,
      });
    } catch (err) {
      console.error("Failed to load reconciliation:", err);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reconciliation</h1>
          <p className="text-gray-500 mt-1">Daily reconciliation across Airtel Money, TNM Mpamba, card, wallet, and cash</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <p className="text-xs text-gray-500 font-medium">Match Rate</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{loading ? "..." : `${summary.matched_pct}%`}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-xs text-gray-500 font-medium">Ledger Total</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{loading ? "..." : formatCurrency(summary.total_ledger)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-xs text-gray-500 font-medium">Provider Total</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{loading ? "..." : formatCurrency(summary.total_provider)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <p className="text-xs text-gray-500 font-medium">Total Difference</p>
          </div>
          <p className={`text-2xl font-bold ${summary.total_difference > 0 ? "text-red-600" : "text-green-600"}`}>
            {loading ? "..." : formatCurrency(summary.total_difference)}
          </p>
        </div>
      </div>

      {/* Reconciliation Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Payment Method</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Ledger Total</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Provider Total</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Difference</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Transactions</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Loading reconciliation...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">No transactions for {date}</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.method} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{r.method}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(r.ledger_total)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(r.provider_total)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${r.difference > 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatCurrency(r.difference)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{r.transaction_count}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        r.status === "Matched" ? "bg-green-100 text-green-700" :
                        r.status === "Minor Diff" ? "bg-yellow-100 text-yellow-700" :
                        "bg-red-100 text-red-700"
                      }`}>
                        {r.status}
                      </span>
                    </td>
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