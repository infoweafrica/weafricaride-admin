"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { RefreshCw, Wallet, Search, Eye } from "lucide-react";
import { formatCurrency, getStatusColor } from "@/lib/utils";
import Link from "next/link";

type WalletRecord = {
  id: string;
  owner_type: string;
  owner_name: string;
  owner_id: string;
  available: number;
  pending: number;
  currency: string;
  status: string;
  updated_at: string;
};

export default function WalletManagementPage() {
  const [wallets, setWallets] = useState<WalletRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [summary, setSummary] = useState({ rider: 0, driver: 0, platform: 0, frozen: 0 });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const allWallets: WalletRecord[] = [];

      // 1. Fetch rider wallets
      const { data: riderWallets } = await supabase
        .from("wallets")
        .select("*, rider:riders(id, user:users(full_name))")
        .order("created_at", { ascending: false })
        .limit(100);

      if (riderWallets) {
        riderWallets.forEach((w: any) => {
          const riderObj = w.rider as Record<string, any> | undefined;
          const userObj = riderObj?.user as Record<string, any> | undefined;
          allWallets.push({
            id: w.id,
            owner_type: "Rider",
            owner_name: userObj?.full_name || "Unknown Rider",
            owner_id: riderObj?.id || w.user_id || "",
            available: w.balance || w.available_balance || 0,
            pending: w.pending_balance || 0,
            currency: w.currency || "MWK",
            status: w.status || "active",
            updated_at: w.updated_at || w.created_at,
          });
        });
      }

      // 2. Fetch driver wallets
      const { data: driverWallets } = await supabase
        .from("driver_wallets")
        .select("*, driver:drivers(id, user:users(full_name))")
        .order("available_balance", { ascending: false })
        .limit(100);

      if (driverWallets) {
        driverWallets.forEach((w: any) => {
          const driverObj = w.driver as Record<string, any> | undefined;
          const userObj = driverObj?.user as Record<string, any> | undefined;
          allWallets.push({
            id: w.id,
            owner_type: "Driver",
            owner_name: userObj?.full_name || "Unknown Driver",
            owner_id: driverObj?.id || w.driver_id || "",
            available: w.available_balance || 0,
            pending: w.pending_balance || 0,
            currency: w.currency || "MWK",
            status: w.status || "active",
            updated_at: w.updated_at || w.created_at,
          });
        });
      }

      // 3. Platform wallet — sum of company_transactions if any
      const { data: platformData } = await supabase
        .from("company_transactions")
        .select("amount, type")
        .order("created_at", { ascending: false })
        .limit(1000);

      let platformBalance = 0;
      if (platformData) {
        platformData.forEach((t: any) => {
          platformBalance += t.type === "credit" ? (t.amount || 0) : -(t.amount || 0);
        });
      }

      allWallets.push({
        id: "platform",
        owner_type: "Platform",
        owner_name: "WeAfrica",
        owner_id: "platform",
        available: Math.max(0, platformBalance),
        pending: 0,
        currency: "MWK",
        status: "active",
        updated_at: new Date().toISOString(),
      });

      setWallets(allWallets);
      setSummary({
        rider: allWallets.filter(w => w.owner_type === "Rider").reduce((s, w) => s + w.available, 0),
        driver: allWallets.filter(w => w.owner_type === "Driver").reduce((s, w) => s + w.available, 0),
        platform: platformBalance > 0 ? platformBalance : 0,
        frozen: allWallets.filter(w => w.status === "frozen").reduce((s, w) => s + w.available, 0),
      });
    } catch (err) {
      console.error("Failed to load wallets:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = wallets.filter((w) =>
    w.owner_name.toLowerCase().includes(search.toLowerCase()) ||
    w.owner_type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Wallet Management</h1>
          <p className="text-gray-500 mt-1">Track rider wallets, driver wallets, and platform wallet</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="h-5 w-5 text-blue-600" />
            <p className="text-xs text-gray-500 font-medium">Rider Wallets</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{loading ? "..." : formatCurrency(summary.rider)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="h-5 w-5 text-green-600" />
            <p className="text-xs text-gray-500 font-medium">Driver Wallets</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{loading ? "..." : formatCurrency(summary.driver)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="h-5 w-5 text-purple-600" />
            <p className="text-xs text-gray-500 font-medium">Platform Wallet</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{loading ? "..." : formatCurrency(summary.platform)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="h-5 w-5 text-red-600" />
            <p className="text-xs text-gray-500 font-medium">Frozen Balances</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{loading ? "..." : formatCurrency(summary.frozen)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name or wallet type..."
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
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Owner</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Available</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Pending</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Loading wallets...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">No wallets found</td></tr>
              ) : (
                filtered.map((w) => (
                  <tr key={`${w.owner_type}-${w.id}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        w.owner_type === "Rider" ? "bg-blue-100 text-blue-700" :
                        w.owner_type === "Driver" ? "bg-green-100 text-green-700" :
                        "bg-purple-100 text-purple-700"
                      }`}>
                        {w.owner_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{w.owner_name}</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-600">{formatCurrency(w.available)}</td>
                    <td className="px-4 py-3 text-right text-amber-600">{formatCurrency(w.pending)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(w.status)}`}>
                        {w.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {w.owner_type === "Driver" && w.owner_id && (
                        <Link
                          href={`/admin/drivers/${w.owner_id}`}
                          className="inline-flex p-1.5 hover:bg-gray-100 rounded text-gray-500"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                      )}
                      {w.owner_type === "Rider" && w.owner_id && (
                        <Link
                          href={`/admin/users?id=${w.owner_id}`}
                          className="inline-flex p-1.5 hover:bg-gray-100 rounded text-gray-500"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                      )}
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