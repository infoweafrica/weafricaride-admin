"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Wallet, WalletTransaction } from "@/lib/types";
import { Search } from "lucide-react";
import { formatCurrency, formatDate, timeAgo } from "@/lib/utils";

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);

  const fetchWallets = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from("wallets").select("*, user:users(full_name, phone, email)").order("created_at", { ascending: false });
      setWallets((data as Wallet[]) || []);
    } catch {
      setWallets([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchWallets(); }, [fetchWallets]);

  const viewWalletDetail = async (wallet: Wallet) => {
    setSelectedWallet(wallet);
    setShowDetail(true);
    try {
      const { data } = await supabase.from("wallet_transactions").select("*").eq("wallet_id", wallet.id).order("created_at", { ascending: false }).limit(20);
      setTransactions((data as WalletTransaction[]) || []);
    } catch {
      setTransactions([]);
    }
  };

  const filtered = wallets.filter(w => {
    if (!search) return true;
    const s = search.toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (w as any).user?.full_name?.toLowerCase().includes(s) || (w as any).user?.phone?.includes(s);
  });

  const totalBalance = wallets.reduce((sum, w) => sum + (w.balance || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Wallets</h1>
        <p className="text-gray-500 mt-1">Manage rider and driver wallets</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-400">Total Balance</p><p className="text-xl font-bold">{formatCurrency(totalBalance)}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-400">Total Wallets</p><p className="text-xl font-bold">{wallets.length}</p></div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input type="text" placeholder="Search by name or phone..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 font-medium">User</th><th className="px-4 py-3 font-medium">Phone</th><th className="px-4 py-3 font-medium text-right">Balance</th><th className="px-4 py-3 font-medium text-right">Credits</th><th className="px-4 py-3 font-medium text-right">Promo</th><th className="px-4 py-3 font-medium text-right">Refunds</th><th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr></thead>
              <tbody>
                {filtered.map(w => (
                  <tr key={w.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-xs">{(w as Record<string, unknown> & { user?: { full_name?: string } }).user?.full_name || "N/A"}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{(w as Record<string, unknown> & { user?: { phone?: string } }).user?.phone || "N/A"}</td>
                    <td className="px-4 py-3 text-right font-medium text-xs">{formatCurrency(w.balance)}</td>
                    <td className="px-4 py-3 text-right text-xs">—</td>
                    <td className="px-4 py-3 text-right text-xs">—</td>
                    <td className="px-4 py-3 text-right text-xs">—</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => viewWalletDetail(w)} className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">View</button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">No wallets found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showDetail && selectedWallet && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto">
            <div className="p-6 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">Wallet: {(selectedWallet as Record<string, unknown> & { user?: { full_name?: string } }).user?.full_name || "N/A"}</h2>
              <button onClick={() => setShowDetail(false)} className="text-xl">&times;</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-50 rounded-lg p-3 text-center"><p className="text-xs text-gray-400">Balance</p><p className="text-lg font-bold text-green-700">{formatCurrency(selectedWallet.balance)}</p></div>
                <div className="bg-blue-50 rounded-lg p-3 text-center"><p className="text-xs text-gray-400">Status</p><p className="text-lg font-bold text-blue-700 capitalize">{selectedWallet.status || "active"}</p></div>
              </div>
              <h3 className="text-sm font-semibold mt-4">Transaction History</h3>
              <div className="space-y-2">
                {transactions.map(t => (
                  <div key={t.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="text-xs font-medium capitalize">{t.type?.replace(/_/g, " ")}</p>
                      <p className="text-xs text-gray-400">{t.description || t.reference}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-medium ${t.amount >= 0 ? "text-green-600" : "text-red-600"}`}>{t.amount >= 0 ? "+" : ""}{formatCurrency(Math.abs(t.amount))}</p>
                      <p className="text-xs text-gray-400">{t.created_at ? timeAgo(t.created_at) : ""}</p>
                    </div>
                  </div>
                ))}
                {transactions.length === 0 && <p className="text-center text-gray-400 py-4 text-sm">No transactions</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}