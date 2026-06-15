"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  Search, Filter, Eye, Download, RefreshCw,
  CheckCircle, XCircle, RotateCcw, AlertTriangle,
  Phone, CreditCard,
  ChevronLeft, ChevronRight, DollarSign, Shield,
  TrendingUp, Wallet, Building2, Landmark,
  Car, Clock, Flag, Receipt,
  X, ChevronDown, BarChart3, PieChart, Activity,
  FileSpreadsheet, FileDown, Printer, AlertCircle,
} from "lucide-react";
import { formatCurrency, formatNumber, timeAgo } from "@/lib/utils";

// ─── TYPES ──────────────────────────────────────────────────

interface FinanceSummary {
  total_revenue: number; net_revenue: number;
  company_commission: number; driver_earnings: number;
  total_refunds: number; pending_payouts: number;
  successful_tx: number; failed_tx: number;
  cash_payments: number; mobile_money: number;
  card_payments: number; wallet_tx: number;
  settlement_collected: number; settlement_transferred: number;
  settlement_pending: number;
}

interface EnrichedTransaction {
  id: string; ride_id?: string; trip_id?: string;
  rider_name?: string; rider_phone?: string;
  driver_name?: string; driver_phone?: string;
  payment_method?: string; gross_amount: number;
  commission: number; tax: number; driver_earnings: number;
  status: string; city?: string; vehicle_class?: string;
  transaction_type?: string;
  pickup_address?: string; dropoff_address?: string;
  distance_km?: number; duration_min?: number;
  base_fare?: number; distance_fare?: number;
  time_fare?: number; surge_multiplier?: number;
  payout_status?: string; paid_at?: string;
  settlement_status?: string; fraud_flag?: boolean;
  created_at: string;
}

interface DailyRevenue { day: string; revenue: number; }

// ─── HELPERS ────────────────────────────────────────────────

const statusColor = (s: string) => {
  switch (s) {
    case "completed": return "bg-green-100 text-green-700";
    case "pending": return "bg-amber-100 text-amber-700";
    case "failed": return "bg-red-100 text-red-700";
    case "refunded": return "bg-orange-100 text-orange-700";
    case "reversed": return "bg-gray-100 text-gray-600";
    case "chargeback": return "bg-red-100 text-red-700";
    case "processing": return "bg-purple-100 text-purple-700";
    default: return "bg-gray-100 text-gray-600";
  }
};

const getMethodLabel = (m?: string) => {
  switch (m) {
    case "cash": return "Cash";
    case "airtel_money": return "Airtel Money";
    case "tnm_mpamba": return "TNM Mpamba";
    case "card": return "Card";
    case "wallet": return "Wallet";
    case "bank": return "Bank Transfer";
    default: return m || "—";
  }
};

const getVehicleLabel = (v?: string) => {
  switch (v) {
    case "economy": return "WeAfrica X";
    case "comfort": return "WeAfrica XL";
    case "women": return "WeAfrica Women";
    case "premium": return "WeAfrica Black";
    case "boda": return "Boda";
    case "delivery": return "Delivery";
    case "van": return "Van";
    case "shuttle": return "Shuttle";
    default: return v || "—";
  }
};

type TabKey = "overview" | "transactions" | "settlements" | "refunds" | "payouts" | "reports" | "fraud";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <BarChart3 className="h-4 w-4" /> },
  { key: "transactions", label: "Transactions", icon: <Activity className="h-4 w-4" /> },
  { key: "settlements", label: "Settlements", icon: <Landmark className="h-4 w-4" /> },
  { key: "refunds", label: "Refunds", icon: <RotateCcw className="h-4 w-4" /> },
  { key: "payouts", label: "Payouts", icon: <Wallet className="h-4 w-4" /> },
  { key: "reports", label: "Reports", icon: <FileSpreadsheet className="h-4 w-4" /> },
  { key: "fraud", label: "Fraud", icon: <Shield className="h-4 w-4" /> },
];

// ─── DATE PRESETS ───────────────────────────────────────────

const DATE_PRESETS = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
  { label: "Custom", value: "custom" },
];

// ─── PAGE ───────────────────────────────────────────────────

export default function FinanceTransactionsDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Summary
  const [summary, setSummary] = useState<FinanceSummary>({
    total_revenue: 0, net_revenue: 0, company_commission: 0,
    driver_earnings: 0, total_refunds: 0, pending_payouts: 0,
    successful_tx: 0, failed_tx: 0, cash_payments: 0,
    mobile_money: 0, card_payments: 0, wallet_tx: 0,
    settlement_collected: 0, settlement_transferred: 0, settlement_pending: 0,
  });

  // Data
  const [transactions, setTransactions] = useState<EnrichedTransaction[]>([]);
  const [dailyRevenue, setDailyRevenue] = useState<DailyRevenue[]>([]);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [datePreset, setDatePreset] = useState("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);

  // Drawer
  const [selectedTx, setSelectedTx] = useState<EnrichedTransaction | null>(null);

  // ── Fetch ──
  const fetchSummary = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_finance_summary_full");
      if (data) setSummary(data as FinanceSummary);
    } catch { /* */ }
  }, []);

  const fetchTransactions = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_list_transactions_enriched", {
        p_search: search,
        p_status: statusFilter !== "all" ? statusFilter : null,
        p_type: typeFilter !== "all" ? typeFilter : null,
        p_method: methodFilter !== "all" ? methodFilter : null,
        p_vehicle_class: vehicleFilter !== "all" ? vehicleFilter : null,
        p_city: cityFilter !== "all" ? cityFilter : null,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (data as any) || {};
      setTransactions((d.data || []) as EnrichedTransaction[]);
      setTotalCount(d.total || 0);
    } catch { /* */ }
  }, [search, statusFilter, typeFilter, methodFilter, vehicleFilter, cityFilter, dateFrom, dateTo, page, pageSize]);

  const fetchDailyRevenue = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_daily_revenue", { p_days: 7 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = ((data as any)?.data || []) as DailyRevenue[];
      setDailyRevenue(raw.length > 0 ? raw : []);
    } catch { /* */ }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    await fetchSummary();
    await fetchDailyRevenue();
    if (activeTab === "transactions") await fetchTransactions();
    setLoading(false);
  }, [activeTab, fetchSummary, fetchTransactions, fetchDailyRevenue]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const changeTab = (t: TabKey) => { setActiveTab(t); setPage(1); };

  // Chart helpers
  const maxRevenue = Math.max(...dailyRevenue.map(d => d.revenue), 1);
  const totalMethodVolume = summary.cash_payments + summary.mobile_money + summary.card_payments + summary.wallet_tx || 1;
  const totalSplit = summary.company_commission + summary.driver_earnings + (summary.total_refunds * 0.165) || 1;

  const totalPages = Math.ceil(totalCount / pageSize);

  // ─── RENDER ───────────────────────────────────────────────

  return (
    <div className="space-y-8" style={{ padding: 32 }}>
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800 }} className="text-gray-900">Finance Dashboard</h1>
          <p style={{ fontSize: 15 }} className="text-gray-500 mt-1">Complete financial control center — revenue, settlements, payouts, refunds, fraud</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={fetchAll} className="flex items-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50" style={{ height: 44 }}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700" style={{ height: 44 }}>
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* ── Row 1: Primary Metrics ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {([
          { label: "Total Revenue", value: formatCurrency(summary.total_revenue), icon: DollarSign, color: "text-green-600 bg-green-50" },
          { label: "Net Revenue", value: formatCurrency(summary.net_revenue), icon: TrendingUp, color: "text-emerald-600 bg-emerald-50" },
          { label: "Company Commission", value: formatCurrency(summary.company_commission), icon: Building2, color: "text-purple-600 bg-purple-50" },
          { label: "Driver Earnings", value: formatCurrency(summary.driver_earnings), icon: Wallet, color: "text-blue-600 bg-blue-50" },
          { label: "Total Refunds", value: formatCurrency(summary.total_refunds), icon: RotateCcw, color: "text-orange-600 bg-orange-50" },
          { label: "Pending Payouts", value: formatCurrency(summary.pending_payouts), icon: Clock, color: "text-amber-600 bg-amber-50" },
        ]).map(c => (
          <div key={c.label} className="bg-white rounded-2xl border p-5" style={{ minHeight: 120, padding: 20, borderRadius: 18 }}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${c.color}`}><c.icon className="h-4 w-4" /></div>
              <p style={{ fontSize: 12 }} className="text-gray-400 font-medium uppercase">{c.label}</p>
            </div>
            <p style={{ fontSize: 24, fontWeight: 800 }} className="text-gray-900">{c.value}</p>
          </div>
        ))}
      </div>

      {/* ── Row 2: Operational Metrics ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {([
          { label: "Successful Tx", value: formatNumber(summary.successful_tx), icon: CheckCircle, color: "text-green-600 bg-green-50" },
          { label: "Failed Tx", value: formatNumber(summary.failed_tx), icon: XCircle, color: "text-red-600 bg-red-50" },
          { label: "Cash Payments", value: formatCurrency(summary.cash_payments), icon: CreditCard, color: "text-gray-600 bg-gray-50" },
          { label: "Mobile Money", value: formatCurrency(summary.mobile_money), icon: Phone, color: "text-amber-600 bg-amber-50" },
          { label: "Card Payments", value: formatCurrency(summary.card_payments), icon: CreditCard, color: "text-blue-600 bg-blue-50" },
          { label: "Wallet Tx", value: formatCurrency(summary.wallet_tx), icon: Wallet, color: "text-purple-600 bg-purple-50" },
          { label: "Settlement Collected", value: formatCurrency(summary.settlement_collected), icon: Landmark, color: "text-emerald-600 bg-emerald-50" },
          { label: "Settlement Pending", value: formatCurrency(summary.settlement_pending), icon: Clock, color: "text-amber-600 bg-amber-50" },
        ]).map(c => (
          <div key={c.label} className="bg-white rounded-2xl border p-5" style={{ minHeight: 110, padding: 20, borderRadius: 18 }}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.color}`}><c.icon className="h-3.5 w-3.5" /></div>
              <p style={{ fontSize: 11 }} className="text-gray-400 font-medium uppercase">{c.label}</p>
            </div>
            <p style={{ fontSize: 22, fontWeight: 800 }} className="text-gray-900">{c.value}</p>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => changeTab(t.key)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === t.key ? "border-green-600 text-green-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
            style={{ height: 48, fontSize: 14 }}
          >{t.icon}{t.label}</button>
        ))}
      </div>

      {/* ═══════ OVERVIEW TAB ═══════ */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Daily Revenue */}
            <div className="bg-white rounded-2xl border p-6 lg:col-span-2">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><BarChart3 className="h-4 w-4 text-green-500" />Daily Revenue</h3>
              <div className="space-y-2">
                {dailyRevenue.map(d => (
                  <div key={d.day} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-8">{d.day}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-7 relative overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-green-500 rounded-full transition-all duration-500" style={{ width: `${(d.revenue / maxRevenue) * 100}%` }} />
                      <span className="absolute inset-y-0 right-2 flex items-center text-xs font-semibold text-gray-700">{formatCurrency(d.revenue)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Payment Method Distribution */}
            <div className="bg-white rounded-2xl border p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><PieChart className="h-4 w-4 text-blue-500" />Payment Methods</h3>
              <div className="space-y-3">
                {[
                  { label: "Airtel Money", value: summary.mobile_money * 0.6, color: "bg-red-500" },
                  { label: "TNM Mpamba", value: summary.mobile_money * 0.4, color: "bg-blue-500" },
                  { label: "Cards", value: summary.card_payments, color: "bg-purple-500" },
                  { label: "Cash", value: summary.cash_payments, color: "bg-gray-500" },
                  { label: "Wallet", value: summary.wallet_tx, color: "bg-green-500" },
                ].filter(m => m.value > 0).map(m => (
                  <div key={m.label}>
                    <div className="flex justify-between text-xs mb-1"><span className="text-gray-500">{m.label}</span><span className="font-medium">{Math.round((m.value / totalMethodVolume) * 100)}%</span></div>
                    <div className="w-full bg-gray-100 rounded-full h-2"><div className={`h-2 rounded-full ${m.color}`} style={{ width: `${Math.round((m.value / totalMethodVolume) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Revenue Split */}
          <div className="bg-white rounded-2xl border p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><Activity className="h-4 w-4 text-purple-500" />Revenue Split</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: "Company Share", value: summary.company_commission, color: "bg-purple-500", pct: Math.round((summary.company_commission / totalSplit) * 100) },
                { label: "Driver Share", value: summary.driver_earnings, color: "bg-green-500", pct: Math.round((summary.driver_earnings / totalSplit) * 100) },
                { label: "Tax", value: summary.total_refunds * 0.165, color: "bg-amber-500", pct: Math.round(((summary.total_refunds * 0.165) / totalSplit) * 100) },
              ].map(s => (
                <div key={s.label} className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                  <p className="text-lg font-bold text-gray-900">{formatCurrency(s.value)}</p>
                  <div className="mt-2 w-full bg-gray-200 rounded-full h-3"><div className={`h-3 rounded-full ${s.color}`} style={{ width: `${s.pct}%` }} /></div>
                  <p className="text-xs text-gray-400 mt-1">{s.pct}%</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ TRANSACTIONS TAB ═══════ */}
      {activeTab === "transactions" && (
        <div className="space-y-4">
          {/* Compact Filters */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input type="text" placeholder="Search transaction, rider, driver..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              {DATE_PRESETS.map(dp => (
                <button key={dp.value} onClick={() => setDatePreset(dp.value)}
                  className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                    datePreset === dp.value ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}>{dp.label}</button>
              ))}
              {datePreset === "custom" && (
                <><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-2 py-2 border border-gray-200 rounded-xl text-xs" />
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-2 py-2 border border-gray-200 rounded-xl text-xs" /></>
              )}
              <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-1.5 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                <Filter className="h-4 w-4" /> Filters <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showFilters ? "rotate-180" : ""}`} />
              </button>
              {(search || statusFilter !== "all") && (
                <button onClick={() => { setSearch(""); setStatusFilter("all"); setTypeFilter("all"); setMethodFilter("all"); setVehicleFilter("all"); setCityFilter("all"); setPage(1); }}
                  className="flex items-center gap-1 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-xl"><X className="h-3.5 w-3.5" /> Clear</button>
              )}
            </div>
            {showFilters && (
              <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-gray-100">
                <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
                  <option value="all">All Status</option>
                  <option value="completed">Completed</option><option value="pending">Pending</option><option value="failed">Failed</option>
                  <option value="refunded">Refunded</option><option value="reversed">Reversed</option><option value="chargeback">Chargeback</option>
                </select>
                <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
                  <option value="all">All Types</option>
                  <option value="ride_payment">Ride Payment</option><option value="delivery_payment">Delivery</option>
                  <option value="withdrawal">Withdrawal</option><option value="topup">Topup</option><option value="refund">Refund</option>
                  <option value="bonus">Bonus</option><option value="incentive">Incentive</option>
                </select>
                <select value={vehicleFilter} onChange={e => { setVehicleFilter(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
                  <option value="all">All Vehicles</option>
                  <option value="economy">WeAfrica X</option><option value="comfort">WeAfrica XL</option>
                  <option value="women">WeAfrica Women</option><option value="premium">WeAfrica Black</option>
                  <option value="delivery">Delivery</option><option value="van">Van</option><option value="shuttle">Shuttle</option>
                </select>
                <select value={cityFilter} onChange={e => { setCityFilter(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
                  <option value="all">All Cities</option>
                  <option value="blantyre">Blantyre</option><option value="lilongwe">Lilongwe</option>
                  <option value="mzuzu">Mzuzu</option><option value="zomba">Zomba</option>
                </select>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" /></div>
            ) : transactions.length === 0 ? (
              <div className="p-16 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4"><Activity className="h-8 w-8 text-gray-400" /></div>
                <p className="text-gray-900 font-medium">No transactions found</p>
                <p className="text-gray-400 text-sm mt-1">Transactions will appear here as rides are completed.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200" style={{ height: 52 }}>
                      <th className="px-3 py-3 text-xs font-medium">Tx ID</th>
                      <th className="px-3 py-3 text-xs font-medium">Trip</th>
                      <th className="px-3 py-3 text-xs font-medium">Rider</th>
                      <th className="px-3 py-3 text-xs font-medium">Driver</th>
                      <th className="px-3 py-3 text-xs font-medium">Method</th>
                      <th className="px-3 py-3 text-xs font-medium text-right">Gross</th>
                      <th className="px-3 py-3 text-xs font-medium text-right">Commission</th>
                      <th className="px-3 py-3 text-xs font-medium text-right">Tax</th>
                      <th className="px-3 py-3 text-xs font-medium text-right">Driver Net</th>
                      <th className="px-3 py-3 text-xs font-medium">Status</th>
                      <th className="px-3 py-3 text-xs font-medium">City</th>
                      <th className="px-3 py-3 text-xs font-medium">Date</th>
                      <th className="px-3 py-3 text-xs font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {transactions.map(tx => (
                      <tr key={tx.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedTx(tx)} style={{ height: 64 }}>
                        <td className="px-3 py-3 text-xs font-mono text-gray-500">{tx.id?.slice(0, 8)}</td>
                        <td className="px-3 py-3 text-xs font-mono text-gray-400">{tx.ride_id?.slice(0, 8) || "—"}</td>
                        <td className="px-3 py-3 text-xs text-gray-700">{tx.rider_name || "—"}</td>
                        <td className="px-3 py-3 text-xs text-gray-700">{tx.driver_name || "—"}</td>
                        <td className="px-3 py-3 text-xs text-gray-500">{getMethodLabel(tx.payment_method)}</td>
                        <td className="px-3 py-3 text-right text-xs font-medium">{formatCurrency(tx.gross_amount)}</td>
                        <td className="px-3 py-3 text-right text-xs text-red-500">-{formatCurrency(tx.commission || 0)}</td>
                        <td className="px-3 py-3 text-right text-xs text-red-500">-{formatCurrency(tx.tax || 0)}</td>
                        <td className="px-3 py-3 text-right text-xs font-semibold text-green-600">{formatCurrency(tx.driver_earnings || 0)}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex px-2 py-1 rounded-full text-[10px] font-medium ${statusColor(tx.status)}`} style={{ minWidth: 80, height: 24, alignItems: "center", justifyContent: "center" }}>
                            {tx.status?.replace(/_/g, " ")}
                          </span>
                          {tx.fraud_flag && <Flag className="h-3 w-3 text-red-500 ml-1 inline" />}
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-400">{tx.city || "—"}</td>
                        <td className="px-3 py-3 text-xs text-gray-400">{timeAgo(tx.created_at)}</td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={e => { e.stopPropagation(); setSelectedTx(tx); }} className="px-2 py-1 text-[11px] bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200" style={{ height: 30 }}><Eye className="h-3 w-3" /></button>
                            {tx.status === "completed" && <button onClick={e => e.stopPropagation()} className="px-2 py-1 text-[11px] bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200" style={{ height: 30 }}><RotateCcw className="h-3 w-3" /></button>}
                            <button onClick={e => e.stopPropagation()} className="px-2 py-1 text-[11px] bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200" style={{ height: 30 }}><Receipt className="h-3 w-3" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50">
                <span className="text-xs text-gray-500">{formatNumber(totalCount)} results</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-2 py-1 border rounded text-xs disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    let pg: number; if (totalPages <= 5) pg = i + 1; else if (page <= 3) pg = i + 1; else if (page >= totalPages - 2) pg = totalPages - 4 + i; else pg = page - 2 + i;
                    if (pg < 1 || pg > totalPages) return null;
                    return <button key={pg} onClick={() => setPage(pg)} className={`px-2.5 py-1 rounded text-xs font-medium ${pg === page ? "bg-green-600 text-white" : "border hover:bg-gray-50"}`}>{pg}</button>;
                  })}
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-2 py-1 border rounded text-xs disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════ SETTLEMENTS TAB ═══════ */}
      {activeTab === "settlements" && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-4"><Landmark className="h-10 w-10 text-gray-400" /></div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Settlement Tracking</h3>
          <p className="text-gray-500 max-w-md mx-auto mb-6">Track how rider payments flow to drivers. Monitor collected, transferred, and pending settlements.</p>
          <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto">
            {[
              { label: "Collected", value: formatCurrency(summary.settlement_collected), color: "border-emerald-200 bg-emerald-50 text-emerald-700" },
              { label: "Transferred", value: formatCurrency(summary.settlement_transferred), color: "border-blue-200 bg-blue-50 text-blue-700" },
              { label: "Pending", value: formatCurrency(summary.settlement_pending), color: "border-amber-200 bg-amber-50 text-amber-700" },
            ].map(s => (
              <div key={s.label} className={`rounded-2xl border p-4 ${s.color}`}>
                <p className="text-xs font-medium mb-1">{s.label}</p>
                <p className="text-lg font-bold">{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════ REFUNDS TAB ═══════ */}
      {activeTab === "refunds" && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-orange-100 rounded-full mb-4"><RotateCcw className="h-10 w-10 text-orange-500" /></div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Refund Management</h3>
          <p className="text-gray-500 max-w-md mx-auto">Manage refund requests, approve/deny refunds, and track refund status. Full refund management is available on the <a href="/admin/finance/refunds" className="text-green-600 underline">Refunds page</a>.</p>
        </div>
      )}

      {/* ═══════ PAYOUTS TAB ═══════ */}
      {activeTab === "payouts" && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 rounded-full mb-4"><Wallet className="h-10 w-10 text-blue-500" /></div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Driver Payouts</h3>
          <p className="text-gray-500 max-w-md mx-auto">Manage driver payout requests, approve payouts, and process batch payments. Full payout management is available on the <a href="/admin/finance/payouts" className="text-green-600 underline">Payouts page</a>.</p>
        </div>
      )}

      {/* ═══════ REPORTS TAB ═══════ */}
      {activeTab === "reports" && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-green-500" />Export Reports</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: "CSV Export", desc: "Download all transactions as CSV", icon: FileDown, action: "Export CSV" },
              { label: "Excel Export", desc: "Download formatted Excel report", icon: FileSpreadsheet, action: "Export Excel" },
              { label: "PDF Report", desc: "Generate PDF financial statement", icon: Printer, action: "Generate PDF" },
            ].map(r => (
              <div key={r.label} className="bg-gray-50 rounded-2xl p-6 text-center hover:bg-gray-100 transition cursor-pointer">
                <r.icon className="h-8 w-8 mx-auto mb-3 text-gray-400" />
                <h4 className="text-sm font-semibold text-gray-900 mb-1">{r.label}</h4>
                <p className="text-xs text-gray-400 mb-3">{r.desc}</p>
                <button className="px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-medium hover:bg-green-700">{r.action}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════ FRAUD TAB ═══════ */}
      {activeTab === "fraud" && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center"><Shield className="h-6 w-6 text-red-500" /></div>
            <div><h3 className="text-lg font-semibold text-gray-900">Fraud Detection</h3><p className="text-sm text-gray-500">Automated risk scanning for suspicious transaction patterns</p></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {[
              { label: "Unusual Refund", desc: "Refund > 3x average trip fare", icon: AlertCircle, color: "border-red-200 bg-red-50" },
              { label: "Large Transaction", desc: "Single payment > 500,000 MWK", icon: DollarSign, color: "border-orange-200 bg-orange-50" },
              { label: "Multiple Failures", desc: "5+ failed payments in 24h", icon: XCircle, color: "border-amber-200 bg-amber-50" },
              { label: "Promo Abuse", desc: "Driver with suspicious promo usage", icon: Flag, color: "border-purple-200 bg-purple-50" },
            ].map(f => (
              <div key={f.label} className={`rounded-2xl border p-4 flex items-start gap-3 ${f.color}`}>
                <f.icon className="h-5 w-5 mt-0.5" />
                <div><p className="text-sm font-semibold">{f.label}</p><p className="text-xs opacity-70">{f.desc}</p></div>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-gray-400">No active fraud alerts. System scanning continuously.</p>
        </div>
      )}

      {/* ── Transaction Detail Drawer ── */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedTx(null)} />
          <div className="relative ml-auto bg-white h-full w-full max-w-lg shadow-2xl overflow-y-auto" style={{ padding: 24 }}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Transaction #{selectedTx.id?.slice(0, 8)}</h2>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium mt-1 ${statusColor(selectedTx.status)}`}>{selectedTx.status}</span>
              </div>
              <button onClick={() => setSelectedTx(null)} className="p-2 hover:bg-gray-100 rounded-xl"><XCircle className="h-5 w-5 text-gray-400" /></button>
            </div>

            <div className="space-y-4">
              {/* Ride Information */}
              <div className="bg-gray-50 rounded-2xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-3 flex items-center gap-2"><Car className="h-4 w-4" />Ride Information</h4>
                <div className="space-y-2">
                  {[
                    { l: "Pickup", v: selectedTx.pickup_address || "—" },
                    { l: "Drop-off", v: selectedTx.dropoff_address || "—" },
                    { l: "Distance", v: selectedTx.distance_km ? `${selectedTx.distance_km} km` : "—" },
                    { l: "Duration", v: selectedTx.duration_min ? `${selectedTx.duration_min} min` : "—" },
                    { l: "Vehicle", v: getVehicleLabel(selectedTx.vehicle_class) },
                  ].map(f => (
                    <div key={f.l} className="flex justify-between text-sm"><span className="text-gray-400 text-xs">{f.l}</span><span className="text-xs font-medium text-gray-700 text-right max-w-[60%]">{f.v}</span></div>
                  ))}
                </div>
              </div>

              {/* Pricing Breakdown */}
              <div className="bg-gray-50 rounded-2xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-3 flex items-center gap-2"><DollarSign className="h-4 w-4" />Pricing Breakdown</h4>
                <div className="space-y-2">
                  {[
                    { l: "Base Fare", v: formatCurrency(selectedTx.base_fare || 0) },
                    { l: "Distance Fare", v: formatCurrency(selectedTx.distance_fare || 0) },
                    { l: "Time Fare", v: formatCurrency(selectedTx.time_fare || 0) },
                    { l: "Surge Multiplier", v: selectedTx.surge_multiplier ? `${selectedTx.surge_multiplier}x` : "—" },
                    { l: "Gross Amount", v: formatCurrency(selectedTx.gross_amount), bold: true },
                  ].map(f => (
                    <div key={f.l} className={`flex justify-between text-sm ${f.bold ? "border-t pt-1" : ""}`}><span className="text-gray-400 text-xs">{f.l}</span><span className={`text-xs ${f.bold ? "font-semibold text-gray-900" : "font-medium text-gray-700"}`}>{f.v}</span></div>
                  ))}
                </div>
              </div>

              {/* Split */}
              <div className="bg-gray-50 rounded-2xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-3 flex items-center gap-2"><Building2 className="h-4 w-4" />Revenue Split</h4>
                <div className="space-y-2">
                  {[
                    { l: "Company Commission", v: "-" + formatCurrency(selectedTx.commission || 0), red: true },
                    { l: "Tax/VAT", v: "-" + formatCurrency(selectedTx.tax || 0), red: true },
                    { l: "Driver Earnings", v: formatCurrency(selectedTx.driver_earnings || 0), green: true, bold: true },
                  ].map(f => (
                    <div key={f.l} className="flex justify-between text-sm"><span className="text-gray-400 text-xs">{f.l}</span><span className={`text-xs ${f.bold ? "font-semibold" : "font-medium"} ${f.red ? "text-red-500" : f.green ? "text-green-600" : "text-gray-700"}`}>{f.v}</span></div>
                  ))}
                </div>
              </div>

              {/* Payout Status */}
              <div className="bg-gray-50 rounded-2xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 mb-3 flex items-center gap-2"><Wallet className="h-4 w-4" />Payout & Settlement</h4>
                <div className="space-y-2">
                  {[
                    { l: "Payout Status", v: selectedTx.payout_status || "Not paid" },
                    { l: "Paid Date", v: selectedTx.paid_at ? new Date(selectedTx.paid_at).toLocaleDateString() : "—" },
                    { l: "Settlement", v: selectedTx.settlement_status || "Pending" },
                  ].map(f => (
                    <div key={f.l} className="flex justify-between text-sm"><span className="text-gray-400 text-xs">{f.l}</span><span className="text-xs font-medium text-gray-700">{f.v}</span></div>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
              <button className="px-3 py-2 text-xs border border-gray-200 rounded-xl hover:bg-gray-50"><Receipt className="h-3.5 w-3.5 inline mr-1" />Receipt</button>
              {selectedTx.status === "completed" && <button className="px-3 py-2 text-xs bg-orange-50 border border-orange-200 text-orange-700 rounded-xl hover:bg-orange-100"><RotateCcw className="h-3.5 w-3.5 inline mr-1" />Refund</button>}
              <button className="px-3 py-2 text-xs bg-red-50 border border-red-200 text-red-700 rounded-xl hover:bg-red-100"><Flag className="h-3.5 w-3.5 inline mr-1" />Flag Fraud</button>
              <button onClick={() => setSelectedTx(null)} className="px-5 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50" style={{ height: 44 }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}