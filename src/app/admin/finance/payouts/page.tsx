"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  Search, Filter, Eye, Download, RefreshCw, Plus, Ban,
  CheckCircle, XCircle, RotateCcw, Settings, User,
  Wallet, CreditCard, FileText,
  ChevronLeft, ChevronRight, DollarSign, AlertTriangle,
  Building2, ArrowUpDown, X, ChevronDown,
  Clock, Shield, Send, Landmark,
} from "lucide-react";
import { formatCurrency, formatNumber, timeAgo } from "@/lib/utils";

// ─── TYPES ──────────────────────────────────────────────────

interface PayoutStats {
  pending_count: number; pending_amount: number;
  approved_count: number; approved_amount: number;
  paid_this_week: number;
  failed_count: number; failed_amount: number;
  wallet_balance: number;
  commission_held: number;
  tax_collected: number;
  refund_impact: number;
}

interface PayoutRequest {
  id: string;
  driver_id: string;
  requested_amount: number;
  fee: number;
  net_amount: number;
  payout_method: string;
  account_number: string;
  account_name: string;
  status: string;
  transaction_reference: string;
  provider_reference: string;
  failure_reason: string;
  notes: string;
  processed_at: string;
  created_at: string;
  driver_name: string;
  driver_phone: string;
  driver_city: string;
  wallet_balance: number;
  available_for_withdrawal: number;
  trips_covered: number;
  commission_deducted: number;
  tax_deducted: number;
}

interface PayoutSettings {
  min_withdrawal_amount: string;
  max_withdrawal_amount: string;
  withdrawal_fee_percent: string;
  withdrawal_fee_fixed: string;
  payout_schedule: string;
  auto_approve_below: string;
  payout_methods_enabled: string;
  company_commission_percent: string;
  tax_vat_percent: string;
}

// ─── HELPERS ────────────────────────────────────────────────

const statusColor = (s: string) => {
  switch (s) {
    case "approved": return "bg-blue-100 text-blue-700";
    case "rejected": return "bg-red-100 text-red-700";
    case "pending": return "bg-amber-100 text-amber-700";
    case "processing": return "bg-purple-100 text-purple-700";
    case "paid": case "completed": return "bg-green-100 text-green-700";
    case "failed": return "bg-red-100 text-red-700";
    case "cancelled": return "bg-gray-100 text-gray-500";
    default: return "bg-gray-100 text-gray-600";
  }
};

const getMethodLabel = (m?: string) => {
  switch (m) {
    case "cash": return "Cash";
    case "airtel_money": return "Airtel Money";
    case "tnm_mpamba": return "TNM Mpamba";
    case "bank": return "Bank Transfer";
    case "wallet": return "Wallet";
    default: return m || "—";
  }
};

const maskAccount = (acct?: string) => {
  if (!acct) return "—";
  if (acct.length <= 4) return acct;
  return "••••" + acct.slice(-4);
};

type TabKey = "pending" | "approved" | "processing" | "paid" | "failed" | "rejected" | "adjustments" | "settings";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "pending", label: "Withdrawal Requests", icon: <Clock className="h-4 w-4" /> },
  { key: "approved", label: "Approved", icon: <CheckCircle className="h-4 w-4" /> },
  { key: "processing", label: "Processing", icon: <RotateCcw className="h-4 w-4" /> },
  { key: "paid", label: "Paid History", icon: <DollarSign className="h-4 w-4" /> },
  { key: "failed", label: "Failed", icon: <XCircle className="h-4 w-4" /> },
  { key: "rejected", label: "Rejected", icon: <Ban className="h-4 w-4" /> },
  { key: "adjustments", label: "Adjustments", icon: <ArrowUpDown className="h-4 w-4" /> },
  { key: "settings", label: "Payout Settings", icon: <Settings className="h-4 w-4" /> },
];

// ─── PAGE ───────────────────────────────────────────────────

export default function DriverPayoutsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stats
  const [stats, setStats] = useState<PayoutStats>({
    pending_count: 0, pending_amount: 0,
    approved_count: 0, approved_amount: 0,
    paid_this_week: 0, failed_count: 0, failed_amount: 0,
    wallet_balance: 0, commission_held: 0, tax_collected: 0, refund_impact: 0,
  });

  // Data
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [payoutSettings, setPayoutSettings] = useState<PayoutSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);

  // Drawer
  const [selectedRequest, setSelectedRequest] = useState<PayoutRequest | null>(null);
  const [drawerNotes, setDrawerNotes] = useState("");
  const [processing, setProcessing] = useState(false);

  // Manual payout modal
  const [showManualPayout, setShowManualPayout] = useState(false);
  const [manualDriverId, setManualDriverId] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualMethod, setManualMethod] = useState("wallet");
  const [manualNotes, setManualNotes] = useState("");

  // Settings edit
  const [editingSetting, setEditingSetting] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // ── Fetch ──
  const fetchStats = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_payout_stats_full");
      if (data) setStats(data as PayoutStats);
    } catch { /* */ }
  }, []);

  const fetchRequests = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_list_payout_requests_full", {
        p_search: search,
        p_status: activeTab !== "settings" && activeTab !== "adjustments" ? activeTab : null,
        p_method: methodFilter !== "all" ? methodFilter : null,
        p_city: cityFilter !== "all" ? cityFilter : null,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_amount_min: amountMin ? parseFloat(amountMin) : null,
        p_amount_max: amountMax ? parseFloat(amountMax) : null,
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (data as any) || {};
      setRequests((d.data || []) as PayoutRequest[]);
      setTotalCount(d.total || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [search, activeTab, methodFilter, cityFilter, dateFrom, dateTo, amountMin, amountMax, page, pageSize]);

  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const { data } = await supabase.rpc("admin_get_payout_settings");
      if (data) setPayoutSettings(data as PayoutSettings);
    } catch { /* */ } finally { setSettingsLoading(false); }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    await fetchStats();
    if (activeTab === "settings") await fetchSettings();
    else await fetchRequests();
    setLoading(false);
  }, [activeTab, fetchStats, fetchRequests, fetchSettings]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const changeTab = (t: TabKey) => { setActiveTab(t); setPage(1); };

  // ── Actions ──
  const handleApprove = async (id: string) => {
    setProcessing(true);
    try {
      const { error: err } = await supabase.rpc("admin_approve_payout_full", { p_request_id: id, p_admin_notes: drawerNotes || null });
      if (err) throw new Error(err.message);
      setSelectedRequest(null); setDrawerNotes(""); fetchAll();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setProcessing(false); }
  };

  const handleReject = async (id: string) => {
    setProcessing(true);
    try {
      const { error: err } = await supabase.rpc("admin_reject_payout_full", { p_request_id: id, p_admin_notes: drawerNotes || null });
      if (err) throw new Error(err.message);
      setSelectedRequest(null); setDrawerNotes(""); fetchAll();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setProcessing(false); }
  };

  const handleMarkPaid = async (id: string) => {
    setProcessing(true);
    try {
      const ref = prompt("Enter transaction reference (optional):");
      const { error: err } = await supabase.rpc("admin_mark_payout_paid", { p_request_id: id, p_transaction_reference: ref || null });
      if (err) throw new Error(err.message);
      setSelectedRequest(null); fetchAll();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setProcessing(false); }
  };

  const handleRetry = async (id: string) => {
    try {
      const { error: err } = await supabase.rpc("admin_retry_failed_payout", { p_request_id: id });
      if (err) throw new Error(err.message);
      fetchAll();
    } catch (e) { alert(e instanceof Error ? e.message : "Retry failed"); }
  };

  const handleCreateManual = async () => {
    if (!manualDriverId || !manualAmount) return;
    setProcessing(true);
    try {
      const { error: err } = await supabase.rpc("admin_create_manual_payout", {
        p_driver_id: manualDriverId,
        p_amount: parseFloat(manualAmount),
        p_method: manualMethod,
        p_admin_notes: manualNotes || null,
      });
      if (err) throw new Error(err.message);
      setShowManualPayout(false); setManualDriverId(""); setManualAmount(""); setManualNotes(""); fetchAll();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setProcessing(false); }
  };

  const handleCreateBatch = async () => {
    try {
      await supabase.rpc("admin_create_payout_batch", {});
      fetchAll();
      alert("Batch created from approved payouts");
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  };

  const handleUpdateSetting = async (key: string) => {
    try {
      await supabase.rpc("admin_update_payout_setting", { p_key: key, p_value: editValue });
      setEditingSetting(null);
      fetchSettings();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  };

  // ── Pagination ──
  const totalPages = Math.ceil(totalCount / pageSize);

  // ─── RENDER ───────────────────────────────────────────────

  return (
    <div className="space-y-6" style={{ padding: 32 }}>
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4" style={{ minHeight: 72 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800 }} className="text-gray-900">Driver Payouts</h1>
          <p style={{ fontSize: 15 }} className="text-gray-500 mt-1">Manage driver earnings, withdrawal requests, approvals, bank/mobile money payouts</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="flex items-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50" style={{ height: 44 }}>
            <Download className="h-4 w-4" /> Export
          </button>
          <button onClick={fetchAll} className="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50" style={{ height: 44 }}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button onClick={() => setShowManualPayout(true)} className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700" style={{ height: 44 }}>
            <Plus className="h-4 w-4" /> Create Manual Payout
          </button>
          <button onClick={() => changeTab("settings")} className="flex items-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50" style={{ height: 44 }}>
            <Settings className="h-4 w-4" /> Payout Settings
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* ── 8 Summary Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {([
          { label: "Pending Withdrawals", value: `${stats.pending_count}`, sub: formatCurrency(stats.pending_amount), icon: Clock, color: "text-amber-600 bg-amber-50" },
          { label: "Approved / Waiting", value: `${stats.approved_count}`, sub: formatCurrency(stats.approved_amount), icon: CheckCircle, color: "text-blue-600 bg-blue-50" },
          { label: "Paid This Week", value: formatCurrency(stats.paid_this_week), icon: DollarSign, color: "text-green-600 bg-green-50", isCurrency: true },
          { label: "Failed Payouts", value: `${stats.failed_count}`, sub: formatCurrency(stats.failed_amount), icon: XCircle, color: "text-red-600 bg-red-50" },
          { label: "Driver Wallet Balance", value: formatCurrency(stats.wallet_balance), icon: Wallet, color: "text-emerald-600 bg-emerald-50", isCurrency: true },
          { label: "Company Commission", value: formatCurrency(stats.commission_held), icon: Building2, color: "text-purple-600 bg-purple-50", isCurrency: true },
          { label: "Tax/VAT Collected", value: formatCurrency(stats.tax_collected), icon: Landmark, color: "text-indigo-600 bg-indigo-50", isCurrency: true },
          { label: "Rider Refund Impact", value: formatCurrency(stats.refund_impact), icon: RotateCcw, color: "text-orange-600 bg-orange-50", isCurrency: true },
        ]).map((card) => (
          <div
            key={card.label}
            className="bg-white rounded-2xl border p-5 flex flex-col justify-between"
            style={{ minHeight: 120, padding: 20, borderRadius: 18, minWidth: 180 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${card.color}`}>
                <card.icon className="h-4 w-4" />
              </div>
              <p style={{ fontSize: 13 }} className="text-gray-400 font-medium uppercase leading-tight">{card.label}</p>
            </div>
            <div>
              <p style={{ fontSize: 28, fontWeight: 800 }} className="text-gray-900">
                {card.value}
              </p>
              {'sub' in card && <p className="text-xs text-gray-500 mt-0.5">{card.sub}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => changeTab(tab.key)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key ? "border-green-600 text-green-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
            style={{ height: 48, fontSize: 15 }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Filters ── */}
      {activeTab !== "settings" && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative" style={{ width: 360 }}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search driver name, phone, payout ref..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                style={{ height: 44 }}
              />
            </div>
            <select value={methodFilter} onChange={e => { setMethodFilter(e.target.value); setPage(1); }} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white" style={{ height: 44 }}>
              <option value="all">All Methods</option>
              <option value="airtel_money">Airtel Money</option>
              <option value="tnm_mpamba">TNM Mpamba</option>
              <option value="bank">Bank Transfer</option>
              <option value="wallet">Wallet</option>
            </select>
            <select value={cityFilter} onChange={e => { setCityFilter(e.target.value); setPage(1); }} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white" style={{ height: 44 }}>
              <option value="all">All Cities</option>
              <option value="blantyre">Blantyre</option>
              <option value="lilongwe">Lilongwe</option>
              <option value="mzuzu">Mzuzu</option>
              <option value="zomba">Zomba</option>
              <option value="capetown">Cape Town</option>
              <option value="johannesburg">Johannesburg</option>
            </select>
            <button onClick={() => setShowAdvancedFilters(!showAdvancedFilters)} className="flex items-center gap-1.5 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50" style={{ height: 44 }}>
              <Filter className="h-4 w-4" /> More <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvancedFilters ? "rotate-180" : ""}`} />
            </button>
            {(search || methodFilter !== "all" || cityFilter !== "all") && (
              <button onClick={() => { setSearch(""); setMethodFilter("all"); setCityFilter("all"); setDateFrom(""); setDateTo(""); setAmountMin(""); setAmountMax(""); setPage(1); }} className="flex items-center gap-1 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-xl" style={{ height: 44 }}>
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
          {showAdvancedFilters && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-gray-100">
              <div><label className="text-[11px] text-gray-400 block mb-1">Date From</label><input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="w-full px-2.5 py-2 border border-gray-200 rounded-xl text-xs" /></div>
              <div><label className="text-[11px] text-gray-400 block mb-1">Date To</label><input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="w-full px-2.5 py-2 border border-gray-200 rounded-xl text-xs" /></div>
              <div><label className="text-[11px] text-gray-400 block mb-1">Amount Min</label><input type="number" placeholder="0" value={amountMin} onChange={e => { setAmountMin(e.target.value); setPage(1); }} className="w-full px-2.5 py-2 border border-gray-200 rounded-xl text-xs" /></div>
              <div><label className="text-[11px] text-gray-400 block mb-1">Amount Max</label><input type="number" placeholder="999999" value={amountMax} onChange={e => { setAmountMax(e.target.value); setPage(1); }} className="w-full px-2.5 py-2 border border-gray-200 rounded-xl text-xs" /></div>
            </div>
          )}
        </div>
      )}

      {/* ── Settings Tab ── */}
      {activeTab === "settings" && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Payout Settings</h3>
            <button onClick={handleCreateBatch} className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700" style={{ height: 44 }}>
              <Send className="h-4 w-4 inline mr-1" /> Process Batch Now
            </button>
          </div>
          {settingsLoading ? (
            <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600" /></div>
          ) : payoutSettings ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(payoutSettings).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                  <div>
                    <p className="text-xs text-gray-400 uppercase">{key.replace(/_/g, " ")}</p>
                    {editingSetting === key ? (
                      <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)} className="mt-1 px-2 py-1 border rounded text-sm w-40" autoFocus />
                    ) : (
                      <p className="text-sm font-semibold text-gray-900 mt-0.5">{value}</p>
                    )}
                  </div>
                  {editingSetting === key ? (
                    <div className="flex gap-1">
                      <button onClick={() => handleUpdateSetting(key)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs">Save</button>
                      <button onClick={() => setEditingSetting(null)} className="px-3 py-1.5 border rounded-lg text-xs">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingSetting(key); setEditValue(value); }} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-500 hover:bg-gray-100">Edit</button>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* ── Main Table ── */}
      {activeTab !== "settings" && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden w-full">
          {loading ? (
            <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" /></div>
          ) : requests.length === 0 ? (
            <div className="p-16 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4"><CreditCard className="h-8 w-8 text-gray-400" /></div>
              <p className="text-gray-900 font-medium">No payout requests</p>
              <p className="text-gray-400 text-sm mt-1">No {activeTab.replace(/_/g, " ")} payouts found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200" style={{ height: 52 }}>
                    <th className="px-3 py-3 text-xs font-medium">Payout Ref</th>
                    <th className="px-3 py-3 text-xs font-medium">Driver</th>
                    <th className="px-3 py-3 text-xs font-medium">Method</th>
                    <th className="px-3 py-3 text-xs font-medium">Account</th>
                    <th className="px-3 py-3 text-xs font-medium text-right">Requested</th>
                    <th className="px-3 py-3 text-xs font-medium text-right">Balance</th>
                    <th className="px-3 py-3 text-xs font-medium text-center">Trips</th>
                    <th className="px-3 py-3 text-xs font-medium text-right">Commission</th>
                    <th className="px-3 py-3 text-xs font-medium text-right">Tax/VAT</th>
                    <th className="px-3 py-3 text-xs font-medium text-right">Net Payable</th>
                    <th className="px-3 py-3 text-xs font-medium">Status</th>
                    <th className="px-3 py-3 text-xs font-medium">Date</th>
                    <th className="px-3 py-3 text-xs font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {requests.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => { setSelectedRequest(r); setDrawerNotes(r.notes || ""); }} style={{ height: 64 }}>
                      <td className="px-3 py-3 text-xs font-mono text-gray-500">{r.id?.slice(0, 8)}</td>
                      <td className="px-3 py-3">
                        <p className="text-xs font-medium text-gray-900">{r.driver_name || "Unknown"}</p>
                        <p className="text-[10px] text-gray-400">{r.driver_phone} · {r.driver_city || "—"}</p>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500">{getMethodLabel(r.payout_method)}</td>
                      <td className="px-3 py-3 text-xs font-mono text-gray-400">{maskAccount(r.account_number)}</td>
                      <td className="px-3 py-3 text-right text-xs font-medium">{formatCurrency(r.requested_amount)}</td>
                      <td className="px-3 py-3 text-right text-xs text-gray-500">{formatCurrency(r.wallet_balance)}</td>
                      <td className="px-3 py-3 text-center text-xs text-gray-500">{r.trips_covered || 0}</td>
                      <td className="px-3 py-3 text-right text-xs text-red-500">-{formatCurrency(r.commission_deducted || 0)}</td>
                      <td className="px-3 py-3 text-right text-xs text-red-500">-{formatCurrency(r.tax_deducted || 0)}</td>
                      <td className="px-3 py-3 text-right text-xs font-semibold text-green-600">{formatCurrency(r.net_amount || r.requested_amount)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex px-2 py-1 rounded-full text-[10px] font-medium ${statusColor(r.status)}`} style={{ minWidth: 90, height: 28, alignItems: "center", justifyContent: "center" }}>
                          {r.status?.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-400">{timeAgo(r.created_at)}</td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={(e) => { e.stopPropagation(); setSelectedRequest(r); setDrawerNotes(r.notes || ""); }} className="px-2.5 py-1.5 text-[11px] bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200" style={{ height: 36 }}>
                            <Eye className="h-3 w-3 inline mr-1" />View
                          </button>
                          {r.status === "pending" && (
                            <>
                              <button onClick={(e) => { e.stopPropagation(); handleApprove(r.id); }} className="px-2.5 py-1.5 text-[11px] bg-green-100 text-green-700 rounded-lg hover:bg-green-200" style={{ height: 36 }}>
                                <CheckCircle className="h-3 w-3" />
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); handleReject(r.id); }} className="px-2.5 py-1.5 text-[11px] bg-red-100 text-red-700 rounded-lg hover:bg-red-200" style={{ height: 36 }}>
                                <XCircle className="h-3 w-3" />
                              </button>
                            </>
                          )}
                          {r.status === "approved" && (
                            <button onClick={(e) => { e.stopPropagation(); handleMarkPaid(r.id); }} className="px-2.5 py-1.5 text-[11px] bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200" style={{ height: 36 }}>
                              <DollarSign className="h-3 w-3 inline mr-1" />Pay
                            </button>
                          )}
                          {r.status === "failed" && (
                            <button onClick={(e) => { e.stopPropagation(); handleRetry(r.id); }} className="px-2.5 py-1.5 text-[11px] bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200" style={{ height: 36 }}>
                              <RotateCcw className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50">
              <span className="text-xs text-gray-500">{formatNumber(totalCount)} results</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-2 py-1 border rounded text-xs disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  let pg: number;
                  if (totalPages <= 5) pg = i + 1;
                  else if (page <= 3) pg = i + 1;
                  else if (page >= totalPages - 2) pg = totalPages - 4 + i;
                  else pg = page - 2 + i;
                  if (pg < 1 || pg > totalPages) return null;
                  return <button key={pg} onClick={() => setPage(pg)} className={`px-2.5 py-1 rounded text-xs font-medium ${pg === page ? "bg-green-600 text-white" : "border hover:bg-gray-50"}`}>{pg}</button>;
                })}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-2 py-1 border rounded text-xs disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Right-Side Drawer ── */}
      {selectedRequest && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedRequest(null)}></div>
          <div className="relative ml-auto bg-white h-full w-full max-w-lg shadow-2xl overflow-y-auto" style={{ padding: 24 }}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Payout #{selectedRequest.id?.slice(0, 8)}</h2>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium mt-1 ${statusColor(selectedRequest.status)}`} style={{ minWidth: 90, height: 28, alignItems: "center", justifyContent: "center" }}>
                  {selectedRequest.status?.replace(/_/g, " ")}
                </span>
              </div>
              <button onClick={() => setSelectedRequest(null)} className="p-2 hover:bg-gray-100 rounded-xl"><XCircle className="h-5 w-5 text-gray-400" /></button>
            </div>

            <div className="space-y-4">
              {/* Driver Profile */}
              <div className="bg-gray-50 rounded-2xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-3 flex items-center gap-2"><User className="h-4 w-4" />Driver</h4>
                <div className="space-y-2">
                  {[
                    { l: "Name", v: selectedRequest.driver_name || "—" },
                    { l: "Phone", v: selectedRequest.driver_phone || "—" },
                    { l: "City", v: selectedRequest.driver_city || "—" },
                  ].map(f => (
                    <div key={f.l} className="flex justify-between text-sm"><span className="text-gray-400 text-xs">{f.l}</span><span className="text-xs font-medium text-gray-700">{f.v}</span></div>
                  ))}
                </div>
              </div>

              {/* Wallet */}
              <div className="bg-gray-50 rounded-2xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-3 flex items-center gap-2"><Wallet className="h-4 w-4" />Wallet</h4>
                <div className="space-y-2">
                  {[
                    { l: "Balance", v: formatCurrency(selectedRequest.wallet_balance) },
                    { l: "Available for Withdrawal", v: formatCurrency(selectedRequest.available_for_withdrawal) },
                  ].map(f => (
                    <div key={f.l} className="flex justify-between text-sm"><span className="text-gray-400 text-xs">{f.l}</span><span className="text-xs font-semibold text-gray-900">{f.v}</span></div>
                  ))}
                </div>
              </div>

              {/* Payout Breakdown */}
              <div className="bg-gray-50 rounded-2xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-3 flex items-center gap-2"><FileText className="h-4 w-4" />Payout Breakdown</h4>
                <div className="space-y-2">
                  {[
                    { l: "Requested Amount", v: formatCurrency(selectedRequest.requested_amount) },
                    { l: "Fee", v: "-" + formatCurrency(selectedRequest.fee || 0), red: true },
                    { l: "Net Amount", v: formatCurrency(selectedRequest.net_amount || selectedRequest.requested_amount), bold: true, green: true },
                    { l: "Trips Covered", v: `${selectedRequest.trips_covered || 0}` },
                    { l: "Commission Deducted", v: "-" + formatCurrency(selectedRequest.commission_deducted || 0), red: true },
                    { l: "Tax/VAT Deducted", v: "-" + formatCurrency(selectedRequest.tax_deducted || 0), red: true },
                    { l: "Payout Method", v: getMethodLabel(selectedRequest.payout_method) },
                    { l: "Account", v: maskAccount(selectedRequest.account_number) },
                  ].map(f => (
                    <div key={f.l} className="flex justify-between text-sm"><span className="text-gray-400 text-xs">{f.l}</span><span className={`text-xs ${f.bold ? "font-semibold" : "font-medium"} ${f.red ? "text-red-500" : f.green ? "text-green-600" : "text-gray-700"}`}>{f.v}</span></div>
                  ))}
                </div>
                {selectedRequest.failure_reason && (
                  <div className="mt-3 pt-3 border-t border-red-100">
                    <p className="text-xs text-red-500">Failure Reason: {selectedRequest.failure_reason}</p>
                  </div>
                )}
              </div>

              {/* Risk Checks */}
              <div className="bg-gray-50 rounded-2xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-3 flex items-center gap-2"><Shield className="h-4 w-4" />Risk Checks</h4>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-green-600"><CheckCircle className="h-3 w-3" /> Wallet balance sufficient</div>
                  <div className="flex items-center gap-2 text-xs text-green-600"><CheckCircle className="h-3 w-3" /> No active disputes</div>
                  <div className="flex items-center gap-2 text-xs text-green-600"><CheckCircle className="h-3 w-3" /> Account verified</div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">Admin Notes</label>
                <textarea value={drawerNotes} onChange={e => setDrawerNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
              {selectedRequest.status === "pending" && (
                <>
                  <button onClick={() => handleReject(selectedRequest.id)} disabled={processing} className="px-5 py-2.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 disabled:opacity-50" style={{ height: 44 }}>
                    <XCircle className="h-4 w-4 inline mr-1" />Reject
                  </button>
                  <button onClick={() => handleApprove(selectedRequest.id)} disabled={processing} className="flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white text-sm font-medium rounded-xl hover:bg-green-700 disabled:opacity-50" style={{ height: 44 }}>
                    {processing ? "Processing..." : <><CheckCircle className="h-4 w-4" />Approve</>}
                  </button>
                </>
              )}
              {selectedRequest.status === "approved" && (
                <button onClick={() => handleMarkPaid(selectedRequest.id)} disabled={processing} className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50" style={{ height: 44 }}>
                  <DollarSign className="h-4 w-4" />Mark Paid
                </button>
              )}
              {selectedRequest.status === "failed" && (
                <button onClick={() => { handleRetry(selectedRequest.id); setSelectedRequest(null); }} className="flex items-center gap-2 px-6 py-2.5 bg-orange-600 text-white text-sm font-medium rounded-xl hover:bg-orange-700" style={{ height: 44 }}>
                  <RotateCcw className="h-4 w-4" />Retry
                </button>
              )}
              <button onClick={() => setSelectedRequest(null)} className="px-5 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50" style={{ height: 44 }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Manual Payout Modal ── */}
      {showManualPayout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowManualPayout(false)}></div>
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Create Manual Payout</h2>
              <button onClick={() => setShowManualPayout(false)} className="p-1.5 hover:bg-gray-100 rounded-lg"><XCircle className="h-5 w-5 text-gray-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className="text-xs font-medium text-gray-700 mb-1 block">Driver ID</label><input type="text" value={manualDriverId} onChange={e => setManualDriverId(e.target.value)} placeholder="Enter driver UUID..." className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
              <div><label className="text-xs font-medium text-gray-700 mb-1 block">Amount (MWK)</label><input type="number" value={manualAmount} onChange={e => setManualAmount(e.target.value)} placeholder="Enter amount..." className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
              <div><label className="text-xs font-medium text-gray-700 mb-1 block">Method</label>
                <select value={manualMethod} onChange={e => setManualMethod(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
                  <option value="wallet">Wallet</option><option value="airtel_money">Airtel Money</option><option value="tnm_mpamba">TNM Mpamba</option><option value="bank">Bank Transfer</option>
                </select>
              </div>
              <div><label className="text-xs font-medium text-gray-700 mb-1 block">Notes</label><textarea value={manualNotes} onChange={e => setManualNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" /></div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl">
              <button onClick={() => setShowManualPayout(false)} className="px-5 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-100">Cancel</button>
              <button onClick={handleCreateManual} disabled={processing} className="flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white text-sm font-medium rounded-xl hover:bg-green-700 disabled:opacity-50">
                {processing ? "Creating..." : "Create Payout"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}