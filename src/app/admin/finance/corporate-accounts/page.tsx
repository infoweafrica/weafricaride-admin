"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import PermissionGuard from "@/components/guards/PermissionGuard";
import StatCard from "@/components/StatCard";
import Pagination from "@/components/Pagination";
import { fetchCorporateAccounts, createCorporateAccount } from "@/lib/api/corporate";
import { Building2, Wallet, FileText, RefreshCw, Plus, X } from "lucide-react";
import type { CorporateAccount } from "@/lib/types";

function formatMwk(n: number) {
  return `MWK ${Math.round(n).toLocaleString()}`;
}

export default function CorporateAccountsPage() {
  return (
    <PermissionGuard permission="manage_finance">
      <CorporateAccountsContent />
    </PermissionGuard>
  );
}

const EMPTY_FORM = {
  name: "",
  billing_email: "",
  finance_email: "",
  phone: "",
  billing_method: "monthly_invoice" as "corporate_wallet" | "monthly_invoice",
  daily_employee_limit: "",
  monthly_account_limit: "",
};

function CorporateAccountsContent() {
  const [accounts, setAccounts] = useState<CorporateAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchCorporateAccounts(page, 50);
    if (result.error) setError(result.error);
    setAccounts(result.data || []);
    setTotalPages(result.totalPages || 1);
    setTotalCount(result.totalCount || 0);
    setLoading(false);
  }, [page]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    if (!form.name || !form.billing_email) return;
    setCreating(true);
    const result = await createCorporateAccount({
      name: form.name,
      billing_email: form.billing_email,
      finance_email: form.finance_email || undefined,
      phone: form.phone || undefined,
      billing_method: form.billing_method,
      daily_employee_limit: form.daily_employee_limit ? Number(form.daily_employee_limit) : undefined,
      monthly_account_limit: form.monthly_account_limit ? Number(form.monthly_account_limit) : undefined,
    });
    alert(result.message);
    if (result.success) {
      setShowCreate(false);
      setForm(EMPTY_FORM);
      loadData();
    }
    setCreating(false);
  };

  const activeCount = accounts.filter((a) => a.status === "active").length;
  const walletAccounts = accounts.filter((a) => a.billing_method === "corporate_wallet");
  const totalWalletBalance = walletAccounts.reduce((s, a) => s + (a.wallet_balance || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Corporate Accounts</h1>
          <p className="text-sm text-gray-500 mt-1">Businesses whose employees ride on the company&apos;s account</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadData} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
            <Plus className="h-4 w-4" /> New Account
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Corporate Accounts" value={totalCount} icon={Building2} />
        <StatCard title="Active Accounts" value={activeCount} icon={Building2} iconClassName="bg-green-50" />
        <StatCard title="Corporate Wallet Balance" value={formatMwk(totalWalletBalance)} icon={Wallet} iconClassName="bg-amber-50" />
      </div>

      {showCreate && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">New Corporate Account</h3>
            <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Billing Email</label>
              <input type="email" value={form.billing_email} onChange={(e) => setForm({ ...form, billing_email: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Finance Email (optional)</label>
              <input type="email" value={form.finance_email} onChange={(e) => setForm({ ...form, finance_email: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Billing Method</label>
              <select value={form.billing_method} onChange={(e) => setForm({ ...form, billing_method: e.target.value as typeof form.billing_method })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none">
                <option value="monthly_invoice">Monthly Invoice (postpaid)</option>
                <option value="corporate_wallet">Corporate Wallet (prepaid)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Daily Employee Limit (MWK)</label>
                <input type="number" value={form.daily_employee_limit} onChange={(e) => setForm({ ...form, daily_employee_limit: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Account Limit (MWK)</label>
                <input type="number" value={form.monthly_account_limit} onChange={(e) => setForm({ ...form, monthly_account_limit: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none" />
              </div>
            </div>
            <button onClick={handleCreate} disabled={creating}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50">
              {creating ? "Creating..." : "Create Account"}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-xs font-medium text-gray-500 uppercase">
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Billing Method</th>
                <th className="px-4 py-3 text-right">Wallet Balance</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : accounts.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No corporate accounts yet</td></tr>
              ) : (
                accounts.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{a.name}</div>
                      <div className="text-xs text-gray-500">{a.billing_email}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {a.billing_method === "corporate_wallet" ? "Corporate Wallet" : "Monthly Invoice"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {a.billing_method === "corporate_wallet" ? formatMwk(a.wallet_balance) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${a.status === "active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/admin/finance/corporate-accounts/${a.id}`} className="flex items-center gap-1 justify-end text-green-600 hover:underline text-xs font-medium">
                        <FileText className="h-3 w-3" /> Manage
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
