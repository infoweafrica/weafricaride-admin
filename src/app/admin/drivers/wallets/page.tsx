"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Wallet, DollarSign, TrendingUp, RefreshCw, Download, Eye } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";

type DriverWallet = {
  id: string;
  driver_id: string;
  available_balance: number;
  pending_balance: number;
  withdrawn_balance: number;
  cash_collected: number;
  commission_owed: number;
  currency: string;
  status: string;
  driver_name: string;
  driver_phone: string;
  updated_at: string;
};

export default function DriverWalletsPage() {
  const [wallets, setWallets] = useState<DriverWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [summary, setSummary] = useState({ available: 0, pending: 0, withdrawn: 0, cash: 0, commission: 0 });

  const fetchWallets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/drivers/wallets");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load wallets");
      setWallets(body.wallets || []);
      setSummary(body.summary || { available: 0, pending: 0, withdrawn: 0, cash: 0, commission: 0 });
    } catch (err) {
      console.error("Failed to load wallets:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchWallets(); }, [fetchWallets]);

  const filtered = wallets.filter((w) =>
    w.driver_name.toLowerCase().includes(search.toLowerCase()) ||
    w.driver_phone.includes(search)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Driver Wallets</h1>
          <p className="text-gray-500 mt-1">{wallets.length} drivers — balances, cash, and commission tracking</p>
        </div>
        <button onClick={fetchWallets} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="h-5 w-5 text-green-600" />
            <p className="text-xs text-gray-500 font-medium">Available Balance</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(summary.available)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-5 w-5 text-amber-600" />
            <p className="text-xs text-gray-500 font-medium">Pending Balance</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(summary.pending)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-5 w-5 text-blue-600" />
            <p className="text-xs text-gray-500 font-medium">Withdrawn</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(summary.withdrawn)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-5 w-5 text-purple-600" />
            <p className="text-xs text-gray-500 font-medium">Cash Collected</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(summary.cash)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-5 w-5 text-red-600" />
            <p className="text-xs text-gray-500 font-medium">Commission Owed</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(summary.commission)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by driver name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      {/* Wallets Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Driver</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Available</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Pending</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Withdrawn</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Cash</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Commission</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-400">Loading wallets...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-400">No wallets found</td></tr>
              ) : (
                filtered.map((w) => (
                  <tr key={w.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{w.driver_name}</p>
                      {w.driver_phone && <p className="text-xs text-gray-500">{w.driver_phone}</p>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-green-600">{formatCurrency(w.available_balance)}</td>
                    <td className="px-4 py-3 text-right text-amber-600">{formatCurrency(w.pending_balance)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(w.withdrawn_balance)}</td>
                    <td className="px-4 py-3 text-right text-purple-600">{formatCurrency(w.cash_collected)}</td>
                    <td className="px-4 py-3 text-right text-red-600">{formatCurrency(w.commission_owed)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/drivers/${w.driver_id}`}
                        className="inline-flex p-1.5 hover:bg-gray-100 rounded text-gray-500"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
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