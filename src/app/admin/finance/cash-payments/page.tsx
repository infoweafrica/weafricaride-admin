"use client";

import { useState, useEffect, useCallback } from "react";
import { Banknote, Landmark, Gift, AlertTriangle, Wallet, RefreshCw, Search } from "lucide-react";
import StatCard from "@/components/StatCard";
import Pagination from "@/components/Pagination";
import Link from "next/link";

type CashTransaction = {
  ride_id: string;
  rider_name: string;
  driver_name: string;
  fare: number;
  cash_received: number;
  change_amount: number;
  rider_credit_amount: number;
  outstanding_amount: number;
  payment_status: string;
  settlement_status: string;
  cash_confirmed_at: string | null;
  completed_at: string | null;
};

type Summary = {
  cash_collected_today: number;
  rider_credits_created_today: number;
  pending_cash_today: number;
  disputed_amount: number;
  outstanding_driver_fees: number;
};

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "partially_paid", label: "Partial" },
  { value: "awaiting_cash", label: "Awaiting cash" },
];

const STATUS_STYLES: Record<string, string> = {
  paid: "bg-green-100 text-green-700",
  partially_paid: "bg-amber-100 text-amber-700",
  awaiting_cash: "bg-gray-100 text-gray-700",
};

function formatMwk(n: number) {
  return `MWK ${Math.round(n).toLocaleString()}`;
}

export default function CashPaymentsPage() {
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set("status", status);
      if (search) params.set("search", search);
      const res = await fetch(`/api/payments/cash?${params.toString()}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load cash payments");
      setTransactions(body.transactions || []);
      setSummary(body.summary);
      setTotalPages(body.pagination?.totalPages || 1);
      setTotalCount(body.pagination?.totalCount || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cash payments");
    } finally {
      setLoading(false);
    }
  }, [page, status, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cash Payments</h1>
          <p className="text-sm text-gray-500 mt-1">
            Every cash trip, what was collected, what was returned or credited, and what drivers still owe.
          </p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="Cash Collected Today" value={formatMwk(summary?.cash_collected_today || 0)} icon={Banknote} />
        <StatCard title="Rider Credits Created" value={formatMwk(summary?.rider_credits_created_today || 0)} icon={Gift} iconClassName="bg-blue-50" />
        <StatCard title="Pending Cash Today" value={formatMwk(summary?.pending_cash_today || 0)} icon={Wallet} iconClassName="bg-amber-50" />
        <StatCard title="Disputed" value={formatMwk(summary?.disputed_amount || 0)} icon={AlertTriangle} iconClassName="bg-red-50" />
        <StatCard title="Outstanding Driver Fees" value={formatMwk(summary?.outstanding_driver_fees || 0)} icon={Landmark} iconClassName="bg-purple-50" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search ride id, rider, or driver..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg"
          />
        </div>
        <div className="flex gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => { setStatus(f.value); setPage(1); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                status === f.value ? "bg-green-600 text-white border-green-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-xs font-medium text-gray-500 uppercase">
                <th className="px-4 py-3">Ride</th>
                <th className="px-4 py-3">Rider</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3 text-right">Fare</th>
                <th className="px-4 py-3 text-right">Cash</th>
                <th className="px-4 py-3 text-right">Credit</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : transactions.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No cash transactions found</td></tr>
              ) : (
                transactions.map((t) => (
                  <tr key={t.ride_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.ride_id.slice(0, 8)}</td>
                    <td className="px-4 py-3">{t.rider_name}</td>
                    <td className="px-4 py-3">{t.driver_name}</td>
                    <td className="px-4 py-3 text-right">{formatMwk(t.fare)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatMwk(t.cash_received)}</td>
                    <td className="px-4 py-3 text-right text-blue-600">{t.rider_credit_amount > 0 ? formatMwk(t.rider_credit_amount) : "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[t.payment_status] || "bg-gray-100 text-gray-700"}`}>
                        {t.payment_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/admin/rides/${t.ride_id}`} className="text-green-600 hover:underline text-xs font-medium">
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={50} onPageChange={setPage} />
      </div>
    </div>
  );
}
