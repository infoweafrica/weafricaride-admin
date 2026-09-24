"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Users,
  Wallet,
  FileText,
  RefreshCw,
  Plus,
  Search,
  CheckCircle2,
  PauseCircle,
  Loader2,
  X,
} from "lucide-react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import {
  createCorporateAccount,
  fetchCorporateAccounts,
  fetchCorporateMembers,
  fetchCorporateInvoices,
  activateCorporateAccount,
  suspendCorporateAccount,
  topUpCorporateWallet,
} from "@/lib/api/corporate";
import type {
  CorporateAccount,
  CorporateAccountMember,
  CorporateInvoice,
} from "@/lib/types";

function money(value: number | null | undefined) {
  return `MWK ${Number(value ?? 0).toLocaleString()}`;
}

function date(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-MW", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function CorporateAccountsPage() {
  const [accounts, setAccounts] = useState<CorporateAccount[]>([]);
  const [membersByAccount, setMembersByAccount] = useState<
    Record<string, CorporateAccountMember[]>
  >({});
  const [invoicesByAccount, setInvoicesByAccount] = useState<
    Record<string, CorporateInvoice[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "suspended">("all");

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState({
    name: "",
    billing_email: "",
    finance_email: "",
    phone: "",
    address: "",
    registration_number: "",
    billing_method: "monthly_invoice" as
      | "corporate_wallet"
      | "monthly_invoice",
    daily_employee_limit: "",
    monthly_account_limit: "",
    credit_limit: "",
  });

  async function load(showRefresh = false) {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    setError("");

    try {
      const result = await fetchCorporateAccounts(1, 100);

      if (result.error) {
        setError(result.error);
        setAccounts([]);
        return;
      }

      const rows = result.data ?? [];
      setAccounts(rows);

      const memberResults = await Promise.all(
        rows.map(async (account) => {
          const result = await fetchCorporateMembers(account.id);
          return [account.id, result.members] as const;
        })
      );

      const invoiceResults = await Promise.all(
        rows.map(async (account) => {
          const invoices = await fetchCorporateInvoices(account.id);
          return [account.id, invoices] as const;
        })
      );

      setMembersByAccount(Object.fromEntries(memberResults));
      setInvoicesByAccount(Object.fromEntries(invoiceResults));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load corporate accounts");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return accounts.filter((account) => {
      const matchesStatus =
        status === "all" || account.status === status;

      const matchesSearch =
        !q ||
        account.name.toLowerCase().includes(q) ||
        account.billing_email.toLowerCase().includes(q) ||
        (account.registration_number ?? "").toLowerCase().includes(q);

      return matchesStatus && matchesSearch;
    });
  }, [accounts, search, status]);

  const stats = useMemo(() => {
    const activeAccounts = accounts.filter(
      (account) => account.status === "active"
    ).length;

    const activeMembers = Object.values(membersByAccount)
      .flat()
      .filter((member) => member.status === "active").length;

    const walletBalance = accounts.reduce(
      (sum, account) => sum + Number(account.wallet_balance ?? 0),
      0
    );

    const outstandingInvoices = Object.values(invoicesByAccount)
      .flat()
      .filter((invoice) =>
        ["issued", "sent", "overdue", "pending"].includes(invoice.status)
      );

    const outstandingAmount = outstandingInvoices.reduce(
      (sum, invoice) => sum + Number(invoice.total_amount ?? 0),
      0
    );

    return {
      total: accounts.length,
      activeAccounts,
      activeMembers,
      walletBalance,
      outstandingInvoices: outstandingInvoices.length,
      outstandingAmount,
    };
  }, [accounts, membersByAccount, invoicesByAccount]);

  async function handleCreate() {
    if (!form.name.trim() || !form.billing_email.trim()) {
      setError("Company name and billing email are required.");
      return;
    }

    setCreating(true);
    setError("");

    const result = await createCorporateAccount({
      name: form.name.trim(),
      billing_email: form.billing_email.trim(),
      finance_email: form.finance_email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      address: form.address.trim() || undefined,
      registration_number: form.registration_number.trim() || undefined,
      billing_method: form.billing_method,
      daily_employee_limit: form.daily_employee_limit
        ? Number(form.daily_employee_limit)
        : undefined,
      monthly_account_limit: form.monthly_account_limit
        ? Number(form.monthly_account_limit)
        : undefined,
      credit_limit: form.credit_limit
        ? Number(form.credit_limit)
        : undefined,
    });

    setCreating(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    setShowCreate(false);
    setForm({
      name: "",
      billing_email: "",
      finance_email: "",
      phone: "",
      address: "",
      registration_number: "",
      billing_method: "monthly_invoice",
      daily_employee_limit: "",
      monthly_account_limit: "",
      credit_limit: "",
    });

    await load(true);
  }

  async function toggleAccount(account: CorporateAccount) {
    const ok =
      account.status === "active"
        ? await suspendCorporateAccount(account.id)
        : await activateCorporateAccount(account.id);

    if (!ok) {
      setError("Failed to update corporate account.");
      return;
    }

    await load(true);
  }

  async function topUp(account: CorporateAccount) {
    const value = window.prompt(
      `Top up ${account.name}.\nEnter amount in MWK:`
    );

    if (!value) return;

    const amount = Number(value.replace(/,/g, ""));

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid positive amount.");
      return;
    }

    const ok = await topUpCorporateWallet(account.id, amount);

    if (!ok) {
      setError("Failed to top up corporate wallet.");
      return;
    }

    await load(true);
  }

  return (
    <PermissionGuard permission="manage_finance">
      <div className="min-h-screen bg-zinc-50 text-zinc-950">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-950 text-white">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">
                    Corporate Accounts
                  </h1>
                  <p className="text-sm text-zinc-500">
                    Manage real WeAfrica Ride business accounts, employees and billing.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => load(true)}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </button>

              <button
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700"
              >
                <Plus className="h-4 w-4" />
                New Account
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              icon={<Building2 className="h-5 w-5" />}
              label="Corporate Accounts"
              value={stats.total}
            />
            <Stat
              icon={<Users className="h-5 w-5" />}
              label="Active Employees"
              value={stats.activeMembers}
            />
            <Stat
              icon={<Wallet className="h-5 w-5" />}
              label="Wallet Balance"
              value={money(stats.walletBalance)}
            />
            <Stat
              icon={<FileText className="h-5 w-5" />}
              label="Outstanding Invoices"
              value={money(stats.outstandingAmount)}
              detail={`${stats.outstandingInvoices} invoice${stats.outstandingInvoices === 1 ? "" : "s"}`}
            />
          </div>

          <div className="mb-5 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search company, billing email or registration number..."
                className="w-full rounded-lg border border-zinc-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-green-500"
              />
            </div>

            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "all" | "active" | "suspended")
              }
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50">
                  <tr>
                    <th className="px-5 py-4 font-semibold">Company</th>
                    <th className="px-5 py-4 font-semibold">Billing</th>
                    <th className="px-5 py-4 font-semibold">Employees</th>
                    <th className="px-5 py-4 font-semibold">Wallet</th>
                    <th className="px-5 py-4 font-semibold">Invoices</th>
                    <th className="px-5 py-4 font-semibold">Status</th>
                    <th className="px-5 py-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-zinc-100">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-16 text-center">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-green-600" />
                        <p className="mt-2 text-sm text-zinc-500">
                          Loading corporate accounts...
                        </p>
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-16 text-center">
                        <Building2 className="mx-auto h-8 w-8 text-zinc-300" />
                        <p className="mt-2 font-medium">No corporate accounts found</p>
                        <p className="text-sm text-zinc-500">
                          No fake accounts are displayed. Create a real account or adjust your search.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((account) => {
                      const members = membersByAccount[account.id] ?? [];
                      const invoices = invoicesByAccount[account.id] ?? [];

                      return (
                        <tr key={account.id} className="hover:bg-zinc-50">
                          <td className="px-5 py-4">
                            <div className="font-semibold">{account.name}</div>
                            {account.registration_number && (
                              <div className="mt-1 text-xs text-zinc-500">
                                Reg: {account.registration_number}
                              </div>
                            )}
                          </td>

                          <td className="px-5 py-4">
                            <div className="font-medium">
                              {account.billing_method === "corporate_wallet"
                                ? "Corporate Wallet"
                                : "Monthly Invoice"}
                            </div>
                            <div className="text-xs text-zinc-500">
                              {account.billing_email}
                            </div>
                          </td>

                          <td className="px-5 py-4">
                            <span className="font-semibold">
                              {members.filter((m) => m.status === "active").length}
                            </span>
                            <span className="text-zinc-500">
                              {" "}
                              active
                            </span>
                          </td>

                          <td className="px-5 py-4 font-medium">
                            {money(account.wallet_balance)}
                          </td>

                          <td className="px-5 py-4">
                            <span className="font-medium">
                              {invoices.length}
                            </span>
                            {invoices.length > 0 && (
                              <div className="text-xs text-zinc-500">
                                {money(
                                  invoices.reduce(
                                    (sum, invoice) =>
                                      sum + Number(invoice.total_amount ?? 0),
                                    0
                                  )
                                )}
                              </div>
                            )}
                          </td>

                          <td className="px-5 py-4">
                            {account.status === "active" ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-600">
                                <PauseCircle className="h-3.5 w-3.5" />
                                Suspended
                              </span>
                            )}
                          </td>

                          <td className="px-5 py-4">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => topUp(account)}
                                className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold hover:bg-zinc-100"
                              >
                                Top Up
                              </button>

                              <button
                                onClick={() => toggleAccount(account)}
                                className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                                  account.status === "active"
                                    ? "border border-red-200 text-red-600 hover:bg-red-50"
                                    : "bg-green-600 text-white hover:bg-green-700"
                                }`}
                              >
                                {account.status === "active"
                                  ? "Suspend"
                                  : "Activate"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 text-xs text-zinc-500">
            Showing {filtered.length} of {accounts.length} real corporate accounts.
          </div>
        </div>

        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-5">
                <div>
                  <h2 className="text-lg font-bold">Create Corporate Account</h2>
                  <p className="text-sm text-zinc-500">
                    Creates a real account in the existing corporate system.
                  </p>
                </div>
                <button
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg p-2 hover:bg-zinc-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid gap-4 p-6 sm:grid-cols-2">
                <Field
                  label="Company name"
                  value={form.name}
                  onChange={(value) => setForm({ ...form, name: value })}
                  required
                />
                <Field
                  label="Billing email"
                  type="email"
                  value={form.billing_email}
                  onChange={(value) =>
                    setForm({ ...form, billing_email: value })
                  }
                  required
                />
                <Field
                  label="Finance email"
                  type="email"
                  value={form.finance_email}
                  onChange={(value) =>
                    setForm({ ...form, finance_email: value })
                  }
                />
                <Field
                  label="Phone"
                  value={form.phone}
                  onChange={(value) => setForm({ ...form, phone: value })}
                />
                <Field
                  label="Registration number"
                  value={form.registration_number}
                  onChange={(value) =>
                    setForm({ ...form, registration_number: value })
                  }
                />
                <Field
                  label="Address"
                  value={form.address}
                  onChange={(value) => setForm({ ...form, address: value })}
                />

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">
                    Billing method
                  </span>
                  <select
                    value={form.billing_method}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        billing_method: e.target.value as
                          | "corporate_wallet"
                          | "monthly_invoice",
                      })
                    }
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm"
                  >
                    <option value="monthly_invoice">Monthly Invoice</option>
                    <option value="corporate_wallet">Corporate Wallet</option>
                  </select>
                </label>

                <Field
                  label="Daily employee limit"
                  type="number"
                  value={form.daily_employee_limit}
                  onChange={(value) =>
                    setForm({ ...form, daily_employee_limit: value })
                  }
                />
                <Field
                  label="Monthly account limit"
                  type="number"
                  value={form.monthly_account_limit}
                  onChange={(value) =>
                    setForm({ ...form, monthly_account_limit: value })
                  }
                />
                <Field
                  label="Credit limit (MWK)"
                  type="number"
                  value={form.credit_limit}
                  onChange={(value) =>
                    setForm({ ...form, credit_limit: value })
                  }
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-zinc-200 px-6 py-4">
                <button
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create Account
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PermissionGuard>
  );
}

function Stat({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
        {icon}
      </div>
      <div className="text-sm text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {detail && <div className="mt-1 text-xs text-zinc-500">{detail}</div>}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-green-500"
      />
    </label>
  );
}
