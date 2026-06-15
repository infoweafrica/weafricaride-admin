"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  Search, Filter, Eye, Download, RefreshCw, Plus, Ban,
  CheckCircle, XCircle, RotateCcw, ArrowLeftRight,
  User, Phone, MapPin, CreditCard, Calendar, FileText, MessageSquare,
  Car, Clock, Route, DollarSign, Shield, AlertTriangle,
  ChevronLeft, ChevronRight, Flag, Zap, Upload, Send,
  Wallet, TrendingUp, Percent, AlertCircle, X, ChevronDown,
} from "lucide-react";
import { formatCurrency, formatNumber, timeAgo } from "@/lib/utils";

// ─── TYPES ──────────────────────────────────────────────────

interface FinanceStats {
  total_payments: number;
  total_refunded: number;
  pending_refunds: number;
  failed_refunds: number;
  approved_refunds: number;
  rejected_refunds: number;
  driver_penalties: number;
  refund_success_rate: number;
}

interface EnrichedRefund {
  id: string;
  ride_id?: string;
  payment_id?: string;
  rider_id?: string;
  driver_id?: string;
  amount: number;
  reason?: string;
  status: string;
  payment_method?: string;
  transaction_reference?: string;
  failure_reason?: string;
  admin_notes?: string;
  decision?: string;
  partial_amount?: number;
  penalty_amount?: number;
  penalty_target?: string;
  hold_payout?: boolean;
  rider_complaint?: string;
  driver_response?: string;
  evidence_urls?: string[];
  cancellation_reason?: string;
  city?: string;
  processed_at?: string;
  created_at: string;
  // Enriched join fields
  pickup_address?: string;
  dropoff_address?: string;
  distance_km?: number;
  duration_min?: number;
  ride_fare?: number;
  ride_city?: string;
  vehicle_class?: string;
  ride_status?: string;
  ride_cancellation_reason?: string;
  payment_amount?: number;
  payment_reference?: string;
  payment_status?: string;
  paid_at?: string;
  rider_name?: string;
  rider_phone?: string;
  driver_name?: string;
  driver_phone?: string;
  payout_id?: string;
  payout_amount?: number;
  payout_status?: string;
  gross_fare?: number;
  commission_amount?: number;
  tax_amount?: number;
  net_earning?: number;
  payout_held?: boolean;
}

interface EnrichedPayment {
  id: string;
  ride_id?: string;
  amount: number;
  payment_method?: string;
  payment_status?: string;
  transaction_reference?: string;
  provider_reference?: string;
  created_at: string;
  ride_ride_id?: string;
  pickup_address?: string;
  dropoff_address?: string;
  ride_city?: string;
  vehicle_class?: string;
}

interface EnrichedPayout {
  id: string;
  driver_id?: string;
  ride_id?: string;
  amount: number;
  gross_fare?: number;
  commission_amount?: number;
  tax_amount?: number;
  net_earning?: number;
  payout_method?: string;
  payout_status?: string;
  is_held?: boolean;
  hold_reason?: string;
  transaction_reference?: string;
  created_at: string;
  driver_name?: string;
  driver_phone?: string;
  pickup_address?: string;
  dropoff_address?: string;
  city?: string;
}

interface FailedTransaction {
  id: string;
  payment_id?: string;
  provider?: string;
  provider_reference?: string;
  provider_status?: string;
  amount?: number;
  error_message?: string;
  error_code?: string;
  retry_count?: number;
  max_retries?: number;
  last_retry_at?: string;
  created_at: string;
  payment_amount?: number;
  payment_method?: string;
  transaction_reference?: string;
  payment_status?: string;
  user_name?: string;
}

interface DisputeRecord {
  id: string;
  dispute_number: string;
  ride_id?: string;
  opened_by: string;
  dispute_type: string;
  priority: string;
  status: string;
  rider_id?: string;
  driver_id?: string;
  city?: string;
  description: string;
  ride_fare?: number;
  ride_payment_method?: string;
  refund_amount?: number;
  penalty_amount?: number;
  resolution?: string;
  assigned_admin_id?: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
  rider?: { full_name?: string; phone?: string } | null;
  driver?: { full_name?: string; phone?: string } | null;
}

// ─── STATUS HELPERS ────────────────────────────────────────

const REFUND_STATUSES = [
  "pending", "approved", "rejected", "processing", "refunded", "failed", "cancelled", "escalated"
];

const PAYMENT_STATUSES = ["pending", "completed", "failed", "refunded", "partially_refunded"];

const PAYOUT_STATUSES = ["pending", "approved", "processing", "completed", "failed", "rejected", "held"];

const DISPUTE_STATUSES = [
  "open", "under_review", "waiting_rider", "waiting_driver", "escalated", "resolved", "closed"
];

const statusColor = (s: string) => {
  switch (s) {
    case "approved": return "bg-blue-100 text-blue-700";
    case "rejected": return "bg-red-100 text-red-700";
    case "pending": return "bg-amber-100 text-amber-700";
    case "processing": return "bg-purple-100 text-purple-700";
    case "refunded": case "completed": return "bg-green-100 text-green-700";
    case "failed": return "bg-red-100 text-red-700";
    case "cancelled": return "bg-gray-100 text-gray-500";
    case "escalated": return "bg-orange-100 text-orange-700";
    case "partially_refunded": return "bg-teal-100 text-teal-700";
    case "held": return "bg-orange-100 text-orange-700";
    case "open": return "bg-blue-100 text-blue-700";
    case "under_review": return "bg-purple-100 text-purple-700";
    case "waiting_rider": case "waiting_driver": return "bg-amber-100 text-amber-700";
    case "resolved": case "closed": return "bg-green-100 text-green-700";
    default: return "bg-gray-100 text-gray-600";
  }
};

const getPaymentMethodLabel = (m?: string) => {
  switch (m) {
    case "cash": return "Cash";
    case "airtel_money": return "Airtel Money";
    case "tnm_mpamba": return "TNM Mpamba";
    case "wallet": return "Wallet";
    case "card": return "Card";
    case "bank": return "Bank Transfer";
    default: return m || "—";
  }
};

const DISPUTE_TYPES: Record<string, string> = {
  fare: "Fare Dispute", driver_cancelled: "Driver Cancelled Wrongly",
  rider_no_show: "Rider No-Show", safety: "Safety Issue",
  wrong_location: "Wrong Pickup/Dropoff", payment_failed: "Payment Failed",
  double_charge: "Double Charge", driver_behaviour: "Driver Behaviour",
  rider_behaviour: "Rider Behaviour", lost_item: "Lost Item",
  accident: "Accident/Incident", fraud: "Fraud/Fake Trip", other: "Other",
};

const PRIORITY_MAP: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-blue-100 text-blue-700 border-blue-200",
};

// ─── TABS ───────────────────────────────────────────────────

type TabKey = "payments" | "payouts" | "refunds" | "disputes" | "failed";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "payments", label: "Ride Payments", icon: <CreditCard className="h-4 w-4" /> },
  { key: "payouts", label: "Driver Payouts", icon: <Wallet className="h-4 w-4" /> },
  { key: "refunds", label: "Refund Requests", icon: <RotateCcw className="h-4 w-4" /> },
  { key: "disputes", label: "Disputes", icon: <Shield className="h-4 w-4" /> },
  { key: "failed", label: "Failed Transactions", icon: <AlertTriangle className="h-4 w-4" /> },
];

// ─── PAGE ───────────────────────────────────────────────────

export default function FinanceControlCenterPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("refunds");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stats
  const [stats, setStats] = useState<FinanceStats>({
    total_payments: 0, total_refunded: 0, pending_refunds: 0,
    failed_refunds: 0, approved_refunds: 0, rejected_refunds: 0,
    driver_penalties: 0, refund_success_rate: 100,
  });

  // Data
  const [refunds, setRefunds] = useState<EnrichedRefund[]>([]);
  const [payments, setPayments] = useState<EnrichedPayment[]>([]);
  const [payouts, setPayouts] = useState<EnrichedPayout[]>([]);
  const [disputes, setDisputes] = useState<DisputeRecord[]>([]);
  const [failedTxs, setFailedTxs] = useState<FailedTransaction[]>([]);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [vehicleClassFilter, setVehicleClassFilter] = useState("all");
  const [driverFilter, setDriverFilter] = useState("");
  const [riderFilter, setRiderFilter] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);

  // Modals
  const [viewRefund, setViewRefund] = useState<EnrichedRefund | null>(null);
  const [viewPayout, setViewPayout] = useState<EnrichedPayout | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [processing, setProcessing] = useState(false);

  // Refund decision modal state
  const [refundDecision, setRefundDecision] = useState<string>("full_refund");
  const [partialAmount, setPartialAmount] = useState<number>(0);
  const [penaltyAmount, setPenaltyAmount] = useState<number>(0);
  const [penaltyTarget, setPenaltyTarget] = useState<string>("driver");
  const [holdPayout, setHoldPayout] = useState(false);

  // Initiate refund modal
  const [initiatePayment, setInitiatePayment] = useState<EnrichedPayment | null>(null);
  const [refundReason, setRefundReason] = useState("");

  // Payout modal
  const [payoutNotes, setPayoutNotes] = useState("");

  // ── Fetch ──
  const fetchStats = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_finance_stats");
      if (data) setStats(data as FinanceStats);
    } catch { /* non-critical */ }
  }, []);

  const fetchRefunds = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_list_refunds_enriched", {
        p_search: search,
        p_status: statusFilter !== "all" ? statusFilter : null,
        p_method: methodFilter !== "all" ? methodFilter : null,
        p_city: cityFilter !== "all" ? cityFilter : null,
        p_driver: driverFilter || null,
        p_rider: riderFilter || null,
        p_vehicle_class: vehicleClassFilter !== "all" ? vehicleClassFilter : null,
        p_amount_min: amountMin ? parseFloat(amountMin) : null,
        p_amount_max: amountMax ? parseFloat(amountMax) : null,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_provider: providerFilter !== "all" ? providerFilter : null,
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (data as any) || {};
      setRefunds((d.data || []) as EnrichedRefund[]);
      setTotalCount(d.total || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load refunds");
    }
  }, [search, statusFilter, methodFilter, cityFilter, driverFilter, riderFilter, vehicleClassFilter, amountMin, amountMax, dateFrom, dateTo, providerFilter, page, pageSize]);

  const fetchPayments = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_list_payments_enriched", {
        p_search: search,
        p_status: statusFilter !== "all" ? statusFilter : null,
        p_method: methodFilter !== "all" ? methodFilter : null,
        p_city: cityFilter !== "all" ? cityFilter : null,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (data as any) || {};
      setPayments((d.data || []) as EnrichedPayment[]);
      setTotalCount(d.total || 0);
    } catch { /* handled */ }
  }, [search, statusFilter, methodFilter, cityFilter, dateFrom, dateTo, page, pageSize]);

  const fetchPayouts = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_list_payouts_enriched", {
        p_search: search,
        p_status: statusFilter !== "all" ? statusFilter : null,
        p_method: methodFilter !== "all" ? methodFilter : null,
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (data as any) || {};
      setPayouts((d.data || []) as EnrichedPayout[]);
    } catch { /* handled */ }
  }, [search, statusFilter, methodFilter, page, pageSize]);

  const fetchDisputes = useCallback(async () => {
    try {
      let query = supabase.from("ride_disputes").select("*, rider:rider_id(full_name,phone), driver:driver_id(full_name,phone)", { count: "exact" });
      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (search.trim()) {
        const s = `%${search.toLowerCase()}%`;
        query = query.or(`dispute_number.ilike.${s},description.ilike.${s}`);
      }
      const { data, count } = await query.order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
      setDisputes((data || []) as DisputeRecord[]);
      setTotalCount(count || 0);
    } catch { /* handled */ }
  }, [search, statusFilter, page, pageSize]);

  const fetchFailedTransactions = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_list_failed_transactions", {
        p_search: search,
        p_provider: providerFilter !== "all" ? providerFilter : null,
        p_limit: pageSize,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setFailedTxs(((data as any)?.data || []) as FailedTransaction[]);
    } catch { /* handled */ }
  }, [search, providerFilter, pageSize]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    await fetchStats();
    if (activeTab === "refunds") await fetchRefunds();
    else if (activeTab === "payments") await fetchPayments();
    else if (activeTab === "payouts") await fetchPayouts();
    else if (activeTab === "disputes") await fetchDisputes();
    else if (activeTab === "failed") await fetchFailedTransactions();
    setLoading(false);
  }, [activeTab, fetchStats, fetchRefunds, fetchPayments, fetchPayouts, fetchDisputes, fetchFailedTransactions]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Reset page on tab/filter change
  const changeTab = (t: TabKey) => { setActiveTab(t); setPage(1); };

  // ── Actions ──
  const handleApproveRefund = async () => {
    if (!viewRefund) return;
    setProcessing(true);
    try {
      const { error: err } = await supabase.rpc("admin_approve_refund_full", {
        p_refund_id: viewRefund.id,
        p_decision: refundDecision,
        p_partial_amount: partialAmount,
        p_penalty_amount: penaltyAmount,
        p_penalty_target: penaltyTarget || null,
        p_hold_payout: holdPayout,
        p_admin_notes: adminNotes || null,
      });
      if (err) throw new Error(err.message);
      setViewRefund(null);
      setAdminNotes("");
      setRefundDecision("full_refund");
      setPartialAmount(0);
      setPenaltyAmount(0);
      setHoldPayout(false);
      fetchAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectRefund = async () => {
    if (!viewRefund) return;
    setProcessing(true);
    try {
      const { error: err } = await supabase.rpc("admin_reject_refund_full", {
        p_refund_id: viewRefund.id,
        p_admin_notes: adminNotes || null,
      });
      if (err) throw new Error(err.message);
      setViewRefund(null);
      setAdminNotes("");
      fetchAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setProcessing(false);
    }
  };

  const handlePartialRefund = async () => {
    if (!viewRefund || !partialAmount) return;
    setProcessing(true);
    try {
      const { error: err } = await supabase.rpc("admin_process_partial_refund", {
        p_refund_id: viewRefund.id,
        p_partial_amount: partialAmount,
        p_admin_notes: adminNotes || null,
      });
      if (err) throw new Error(err.message);
      setViewRefund(null);
      fetchAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setProcessing(false);
    }
  };

  const handleRetryRefund = async (refundId: string) => {
    try {
      const { error: err } = await supabase.rpc("admin_retry_failed_refund", { p_refund_id: refundId });
      if (err) throw new Error(err.message);
      fetchAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Retry failed");
    }
  };

  const handleCancelRefund = async (refundId: string) => {
    try {
      const { error: err } = await supabase.rpc("admin_cancel_refund", { p_refund_id: refundId });
      if (err) throw new Error(err.message);
      setViewRefund(null); fetchAll();
    } catch (e) { alert(e instanceof Error ? e.message : "Cancel failed"); }
  };

  const handleEscalateToDispute = async (refundId: string) => {
    try {
      const { error: err } = await supabase.rpc("admin_create_dispute_from_refund", {
        p_refund_id: refundId,
        p_dispute_type: "fare",
        p_priority: "medium",
      });
      if (err) throw new Error(err.message);
      fetchAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Escalate failed");
    }
  };

  const handleInitiateRefund = async () => {
    if (!initiatePayment) return;
    setProcessing(true);
    try {
      const { error: err } = await supabase.rpc("admin_create_refund", { p_payment_id: initiatePayment.id, p_reason: refundReason });
      if (err) throw new Error(err.message);
      setInitiatePayment(null); setRefundReason(""); fetchAll();
      setActiveTab("refunds");
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setProcessing(false); }
  };

  const handleHoldPayout = async (payoutId: string) => {
    try {
      await supabase.rpc("admin_hold_driver_payout", { p_payout_id: payoutId, p_reason: "Under investigation" });
      fetchAll();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  };

  const handleReleasePayout = async (payoutId: string) => {
    try {
      await supabase.rpc("admin_release_driver_payout", { p_payout_id: payoutId });
      fetchAll();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  };

  const handleProcessPayout = async (payoutId: string, newStatus: string) => {
    setProcessing(true);
    try {
      const { error: err } = await supabase.rpc("admin_process_payout", { p_payout_id: payoutId, p_status: newStatus, p_notes: payoutNotes || null });
      if (err) throw new Error(err.message);
      setViewPayout(null); setPayoutNotes(""); fetchAll();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setProcessing(false); }
  };

  const handleRetryFailedTx = async (txId: string) => {
    try {
      await supabase.rpc("admin_retry_payment_transaction", { p_transaction_id: txId });
      fetchAll();
    } catch (e) { alert(e instanceof Error ? e.message : "Retry failed"); }
  };

  const handleResolveDispute = async (disputeId: string) => {
    try {
      await supabase.rpc("admin_resolve_dispute_full", { p_dispute_id: disputeId, p_resolution: "Resolved by admin", p_status: "resolved" });
      fetchAll();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  };

  // ── Pagination ──
  const totalPages = Math.ceil(totalCount / pageSize);

  // ─── RENDER ───────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800 }} className="text-gray-900">Finance Control Center</h1>
          <p style={{ fontSize: 15 }} className="text-gray-500 mt-1">Manage payments, refunds, driver payouts, disputes, and failed transactions</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} className="flex items-center gap-2 px-5 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 text-sm font-medium" style={{ height: 44, padding: "0 20px" }}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button className="flex items-center gap-2 px-5 py-3 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50" style={{ height: 44, padding: "0 20px" }}>
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* ── 8 Summary Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          { label: "Total Payments", value: formatCurrency(stats.total_payments), icon: DollarSign, color: "text-green-600 bg-green-50", isNumber: false },
          { label: "Total Refunded", value: formatCurrency(stats.total_refunded), icon: RotateCcw, color: "text-orange-600 bg-orange-50", isNumber: false },
          { label: "Pending Refunds", value: stats.pending_refunds, icon: Clock, color: "text-amber-600 bg-amber-50", isNumber: true },
          { label: "Failed Refunds", value: stats.failed_refunds, icon: AlertTriangle, color: "text-red-600 bg-red-50", isNumber: true },
          { label: "Approved Refunds", value: stats.approved_refunds, icon: CheckCircle, color: "text-blue-600 bg-blue-50", isNumber: true },
          { label: "Rejected Refunds", value: stats.rejected_refunds, icon: XCircle, color: "text-gray-600 bg-gray-50", isNumber: true },
          { label: "Driver Penalties", value: formatCurrency(stats.driver_penalties), icon: Ban, color: "text-purple-600 bg-purple-50", isNumber: false },
          { label: "Success Rate", value: `${stats.refund_success_rate}%`, icon: Percent, color: "text-emerald-600 bg-emerald-50", isNumber: false },
        ]).map((card) => (
          <div
            key={card.label}
            className="bg-white rounded-2xl border p-5 flex flex-col justify-between"
            style={{ minHeight: 120, padding: 20, borderRadius: 18, borderColor: "rgba(229,231,235,1)" }}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${card.color}`}>
                <card.icon className="h-4.5 w-4.5" />
              </div>
              <p style={{ fontSize: 13 }} className="text-gray-400 font-medium uppercase tracking-wide">{card.label}</p>
            </div>
            <p style={{ fontSize: 28, fontWeight: 800 }} className="text-gray-900 mt-1">
              {card.isNumber ? formatNumber(card.value as number) : card.value}
            </p>
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
              activeTab === tab.key
                ? "border-green-600 text-green-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
            style={{ height: 48, fontSize: 15 }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, ID, reference..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white">
            <option value="all">All Status</option>
            {(activeTab === "refunds" ? REFUND_STATUSES : activeTab === "payments" ? PAYMENT_STATUSES : activeTab === "payouts" ? PAYOUT_STATUSES : DISPUTE_STATUSES)
              .map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          <select value={methodFilter} onChange={e => { setMethodFilter(e.target.value); setPage(1); }} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white">
            <option value="all">All Methods</option>
            <option value="cash">Cash</option>
            <option value="airtel_money">Airtel Money</option>
            <option value="tnm_mpamba">TNM Mpamba</option>
            <option value="wallet">Wallet</option>
            <option value="card">Card</option>
            <option value="bank">Bank Transfer</option>
          </select>
          <select value={cityFilter} onChange={e => { setCityFilter(e.target.value); setPage(1); }} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white">
            <option value="all">All Cities</option>
            <option value="blantyre">Blantyre</option>
            <option value="lilongwe">Lilongwe</option>
            <option value="mzuzu">Mzuzu</option>
            <option value="zomba">Zomba</option>
            <option value="capetown">Cape Town</option>
            <option value="johannesburg">Johannesburg</option>
          </select>
          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className="flex items-center gap-1.5 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50"
          >
            <Filter className="h-4 w-4" />
            More Filters
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvancedFilters ? "rotate-180" : ""}`} />
          </button>
          {(search || statusFilter !== "all" || methodFilter !== "all" || cityFilter !== "all") && (
            <button onClick={() => { setSearch(""); setStatusFilter("all"); setMethodFilter("all"); setCityFilter("all"); setDateFrom(""); setDateTo(""); setAmountMin(""); setAmountMax(""); setProviderFilter("all"); setVehicleClassFilter("all"); setDriverFilter(""); setRiderFilter(""); setPage(1); }} className="flex items-center gap-1 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-xl">
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>

        {showAdvancedFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-3 border-t border-gray-100">
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">Date From</label>
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="w-full px-2.5 py-2 border border-gray-200 rounded-xl text-xs" />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">Date To</label>
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="w-full px-2.5 py-2 border border-gray-200 rounded-xl text-xs" />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">Amount Min</label>
              <input type="number" placeholder="0" value={amountMin} onChange={e => { setAmountMin(e.target.value); setPage(1); }} className="w-full px-2.5 py-2 border border-gray-200 rounded-xl text-xs" />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">Amount Max</label>
              <input type="number" placeholder="999999" value={amountMax} onChange={e => { setAmountMax(e.target.value); setPage(1); }} className="w-full px-2.5 py-2 border border-gray-200 rounded-xl text-xs" />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">Provider</label>
              <select value={providerFilter} onChange={e => { setProviderFilter(e.target.value); setPage(1); }} className="w-full px-2.5 py-2 border border-gray-200 rounded-xl text-xs bg-white">
                <option value="all">All</option>
                <option value="airtel_money">Airtel</option>
                <option value="tnm_mpamba">TNM</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">Vehicle Class</label>
              <select value={vehicleClassFilter} onChange={e => { setVehicleClassFilter(e.target.value); setPage(1); }} className="w-full px-2.5 py-2 border border-gray-200 rounded-xl text-xs bg-white">
                <option value="all">All</option>
                <option value="economy">Economy</option>
                <option value="comfort">Comfort</option>
                <option value="premium">Premium</option>
                <option value="boda">Boda</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">Driver Name</label>
              <input type="text" placeholder="Filter driver..." value={driverFilter} onChange={e => { setDriverFilter(e.target.value); setPage(1); }} className="w-full px-2.5 py-2 border border-gray-200 rounded-xl text-xs" />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">Rider Name</label>
              <input type="text" placeholder="Filter rider..." value={riderFilter} onChange={e => { setRiderFilter(e.target.value); setPage(1); }} className="w-full px-2.5 py-2 border border-gray-200 rounded-xl text-xs" />
            </div>
          </div>
        )}
      </div>

      {/* ═══════ REFUND REQUESTS TAB ═══════ */}
      {activeTab === "refunds" && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
            </div>
          ) : refunds.length === 0 ? (
            <div className="p-16 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                <ArrowLeftRight className="h-8 w-8 text-gray-400" />
              </div>
              <p className="text-gray-900 font-medium">No refund requests yet</p>
              <p className="text-gray-400 text-sm mt-1 max-w-md mx-auto">Refund requests from customers will appear here.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200" style={{ height: 52 }}>
                      <th className="px-4 py-3 text-xs font-medium">Refund ID</th>
                      <th className="px-4 py-3 text-xs font-medium">Rider</th>
                      <th className="px-4 py-3 text-xs font-medium">Driver</th>
                      <th className="px-4 py-3 text-xs font-medium">Ride ID</th>
                      <th className="px-4 py-3 text-xs font-medium">City</th>
                      <th className="px-4 py-3 text-xs font-medium text-right">Amount</th>
                      <th className="px-4 py-3 text-xs font-medium">Method</th>
                      <th className="px-4 py-3 text-xs font-medium">Reason</th>
                      <th className="px-4 py-3 text-xs font-medium">Status</th>
                      <th className="px-4 py-3 text-xs font-medium">Date</th>
                      <th className="px-4 py-3 text-xs font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {refunds.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50" style={{ height: 64 }}>
                        <td className="px-4 py-3 text-xs font-mono text-gray-500">{r.id?.slice(0, 8)}</td>
                        <td className="px-4 py-3 text-xs font-medium text-gray-900">{r.rider_name || "—"}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{r.driver_name || "—"}</td>
                        <td className="px-4 py-3 text-xs font-mono text-gray-400">{r.ride_id?.slice(0, 8) || "—"}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{r.ride_city || r.city || "—"}</td>
                        <td className="px-4 py-3 text-right font-medium text-xs">{formatCurrency(r.amount)}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{getPaymentMethodLabel(r.payment_method)}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[100px] truncate">{r.reason || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-1 rounded-full text-[10px] font-medium ${statusColor(r.status)}`}>
                            {r.status?.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">{timeAgo(r.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => { setViewRefund(r); setAdminNotes(r.admin_notes || ""); setRefundDecision("full_refund"); setPartialAmount(0); setPenaltyAmount(0); setHoldPayout(false); }} className="px-2.5 py-1.5 text-[11px] bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200" style={{ height: 36 }}>
                              <Eye className="h-3 w-3 inline mr-1" />View
                            </button>
                            {r.status === "pending" && (
                              <>
                                <button onClick={() => { setViewRefund(r); setAdminNotes(r.admin_notes || ""); setRefundDecision("full_refund"); setPartialAmount(0); setPenaltyAmount(0); setHoldPayout(false); }} className="px-2.5 py-1.5 text-[11px] bg-green-100 text-green-700 rounded-lg hover:bg-green-200" style={{ height: 36 }}>
                                  <CheckCircle className="h-3 w-3 inline mr-1" />Approve
                                </button>
                                <button onClick={async () => { try { await supabase.rpc("admin_reject_refund_full", { p_refund_id: r.id, p_admin_notes: null }); fetchAll(); } catch (e) { alert(e instanceof Error ? e.message : "Failed"); } }} className="px-2.5 py-1.5 text-[11px] bg-red-100 text-red-700 rounded-lg hover:bg-red-200" style={{ height: 36 }}>
                                  <XCircle className="h-3 w-3 inline mr-1" />Reject
                                </button>
                                <button onClick={() => handleEscalateToDispute(r.id)} className="px-2.5 py-1.5 text-[11px] bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200" style={{ height: 36 }}>
                                  <Flag className="h-3 w-3 inline mr-1" />Escalate
                                </button>
                              </>
                            )}
                            {r.status === "failed" && (
                              <button onClick={() => handleRetryRefund(r.id)} className="px-2.5 py-1.5 text-[11px] bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200" style={{ height: 36 }}>
                                <RotateCcw className="h-3 w-3 inline mr-1" />Retry
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
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

      {/* ═══════ RIDE PAYMENTS TAB ═══════ */}
      {activeTab === "payments" && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200" style={{ height: 52 }}>
                  <th className="px-4 py-3 text-xs font-medium">Payment ID</th>
                  <th className="px-4 py-3 text-xs font-medium">Rider</th>
                  <th className="px-4 py-3 text-xs font-medium">Driver</th>
                  <th className="px-4 py-3 text-xs font-medium">Ride ID</th>
                  <th className="px-4 py-3 text-xs font-medium">City</th>
                  <th className="px-4 py-3 text-xs font-medium text-right">Amount</th>
                  <th className="px-4 py-3 text-xs font-medium">Method</th>
                  <th className="px-4 py-3 text-xs font-medium">Status</th>
                  <th className="px-4 py-3 text-xs font-medium">Date</th>
                  <th className="px-4 py-3 text-xs font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payments.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50" style={{ height: 64 }}>
                    <td className="px-4 py-3 text-xs font-mono text-gray-500">{p.id?.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-xs font-medium text-gray-900">—</td>
                    <td className="px-4 py-3 text-xs text-gray-500">—</td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-400">{p.ride_id?.slice(0, 8) || "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{p.ride_city || "—"}</td>
                    <td className="px-4 py-3 text-right font-medium text-xs">{formatCurrency(p.amount)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{getPaymentMethodLabel(p.payment_method)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-[10px] font-medium ${statusColor(p.payment_status || "pending")}`}>
                        {p.payment_status?.replace(/_/g, " ") || "pending"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{timeAgo(p.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {p.payment_status === "completed" && (
                        <button onClick={() => { setInitiatePayment(p); setRefundReason(""); }} className="px-2.5 py-1.5 text-[11px] bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200" style={{ height: 36 }}>
                          <Plus className="h-3 w-3 inline mr-1" />Refund
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {payments.length === 0 && !loading && (
                  <tr><td colSpan={10} className="py-16 text-center text-gray-400 text-sm">No payments found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════ DRIVER PAYOUTS TAB ═══════ */}
      {activeTab === "payouts" && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200" style={{ height: 52 }}>
                  <th className="px-4 py-3 text-xs font-medium">Driver</th>
                  <th className="px-4 py-3 text-xs font-medium">Ride ID</th>
                  <th className="px-4 py-3 text-xs font-medium text-right">Gross Fare</th>
                  <th className="px-4 py-3 text-xs font-medium text-right">Commission</th>
                  <th className="px-4 py-3 text-xs font-medium text-right">Tax/VAT</th>
                  <th className="px-4 py-3 text-xs font-medium text-right">Net Earning</th>
                  <th className="px-4 py-3 text-xs font-medium">Status</th>
                  <th className="px-4 py-3 text-xs font-medium">Method</th>
                  <th className="px-4 py-3 text-xs font-medium">Date</th>
                  <th className="px-4 py-3 text-xs font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payouts.map(po => (
                  <tr key={po.id} className="hover:bg-gray-50" style={{ height: 64 }}>
                    <td className="px-4 py-3 text-xs font-medium text-gray-900">{po.driver_name || "Unknown"}</td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-400">{po.ride_id?.slice(0, 8) || "—"}</td>
                    <td className="px-4 py-3 text-right text-xs">{formatCurrency(po.gross_fare || po.amount || 0)}</td>
                    <td className="px-4 py-3 text-right text-xs text-red-500">-{formatCurrency(po.commission_amount || 0)}</td>
                    <td className="px-4 py-3 text-right text-xs text-red-500">-{formatCurrency(po.tax_amount || 0)}</td>
                    <td className="px-4 py-3 text-right font-medium text-xs text-green-600">{formatCurrency(po.net_earning || po.amount || 0)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-[10px] font-medium ${statusColor(po.payout_status || "pending")} ${po.is_held ? "ring-2 ring-orange-400" : ""}`}>
                        {po.is_held ? "HELD" : (po.payout_status?.replace(/_/g, " ") || "pending")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{getPaymentMethodLabel(po.payout_method)}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{timeAgo(po.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => { setViewPayout(po); setPayoutNotes(""); }} className="px-2.5 py-1.5 text-[11px] bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200" style={{ height: 36 }}>
                          <Eye className="h-3 w-3 inline mr-1" />View
                        </button>
                        {po.is_held ? (
                          <button onClick={() => handleReleasePayout(po.id)} className="px-2.5 py-1.5 text-[11px] bg-green-100 text-green-700 rounded-lg hover:bg-green-200" style={{ height: 36 }}>
                            Release
                          </button>
                        ) : (
                          <button onClick={() => handleHoldPayout(po.id)} className="px-2.5 py-1.5 text-[11px] bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200" style={{ height: 36 }}>
                            Hold
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {payouts.length === 0 && !loading && (
                  <tr><td colSpan={10} className="py-16 text-center text-gray-400 text-sm">No driver payouts found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════ DISPUTES TAB ═══════ */}
      {activeTab === "disputes" && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200" style={{ height: 52 }}>
                  <th className="px-4 py-3 text-xs font-medium">Dispute ID</th>
                  <th className="px-4 py-3 text-xs font-medium">Rider</th>
                  <th className="px-4 py-3 text-xs font-medium">Driver</th>
                  <th className="px-4 py-3 text-xs font-medium">Type</th>
                  <th className="px-4 py-3 text-xs font-medium">Reason</th>
                  <th className="px-4 py-3 text-xs font-medium text-right">Amount</th>
                  <th className="px-4 py-3 text-xs font-medium">Status</th>
                  <th className="px-4 py-3 text-xs font-medium">Date</th>
                  <th className="px-4 py-3 text-xs font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {disputes.map(d => (
                  <tr key={d.id} className="hover:bg-gray-50" style={{ height: 64 }}>
                    <td className="px-4 py-3 text-xs font-mono text-gray-500">{d.dispute_number}</td>
                    <td className="px-4 py-3 text-xs font-medium text-gray-900">{d.rider?.full_name || "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{d.driver?.full_name || "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{DISPUTE_TYPES[d.dispute_type] || d.dispute_type}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[120px] truncate">{d.description}</td>
                    <td className="px-4 py-3 text-right text-xs font-medium">{d.ride_fare ? formatCurrency(d.ride_fare) : "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-[10px] font-medium ${statusColor(d.status)}`}>
                        {d.status?.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{timeAgo(d.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <a href={`/admin/support/disputes`} className="px-2.5 py-1.5 text-[11px] bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200" style={{ height: 36 }}>
                          <Eye className="h-3 w-3 inline mr-1" />View
                        </a>
                        {d.status !== "resolved" && d.status !== "closed" && (
                          <button onClick={() => handleResolveDispute(d.id)} className="px-2.5 py-1.5 text-[11px] bg-green-100 text-green-700 rounded-lg hover:bg-green-200" style={{ height: 36 }}>
                            <CheckCircle className="h-3 w-3 inline mr-1" />Resolve
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {disputes.length === 0 && !loading && (
                  <tr><td colSpan={9} className="py-16 text-center text-gray-400 text-sm">No disputes found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════ FAILED TRANSACTIONS TAB ═══════ */}
      {activeTab === "failed" && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200" style={{ height: 52 }}>
                  <th className="px-4 py-3 text-xs font-medium">Transaction ID</th>
                  <th className="px-4 py-3 text-xs font-medium">User</th>
                  <th className="px-4 py-3 text-xs font-medium text-right">Amount</th>
                  <th className="px-4 py-3 text-xs font-medium">Provider</th>
                  <th className="px-4 py-3 text-xs font-medium">Error</th>
                  <th className="px-4 py-3 text-xs font-medium text-center">Retry Count</th>
                  <th className="px-4 py-3 text-xs font-medium">Status</th>
                  <th className="px-4 py-3 text-xs font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {failedTxs.map(tx => (
                  <tr key={tx.id} className="hover:bg-gray-50" style={{ height: 64 }}>
                    <td className="px-4 py-3 text-xs font-mono text-gray-500">{tx.id?.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-xs font-medium text-gray-900">{tx.user_name || "—"}</td>
                    <td className="px-4 py-3 text-right text-xs font-medium">{formatCurrency(tx.amount || tx.payment_amount || 0)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{getPaymentMethodLabel(tx.provider)}</td>
                    <td className="px-4 py-3 text-xs text-red-500 max-w-[140px] truncate">{tx.error_message || "Unknown error"}</td>
                    <td className="px-4 py-3 text-center text-xs text-gray-500">{tx.retry_count || 0}/{tx.max_retries || 3}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-[10px] font-medium ${statusColor("failed")}`}>
                        {tx.provider_status || "failed"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleRetryFailedTx(tx.id)} className="px-2.5 py-1.5 text-[11px] bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200" style={{ height: 36 }}>
                        <RotateCcw className="h-3 w-3 inline mr-1" />Retry
                      </button>
                    </td>
                  </tr>
                ))}
                {failedTxs.length === 0 && !loading && (
                  <tr><td colSpan={8} className="py-16 text-center text-gray-400 text-sm">No failed transactions</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Quick Reject (inline wrapper) ── */}
      {(() => {
        const handleRejectRefundFor = async (r: EnrichedRefund) => {
          setViewRefund(r);
          setAdminNotes("");
          try {
            const { error: err } = await supabase.rpc("admin_reject_refund_full", { p_refund_id: r.id, p_admin_notes: null });
            if (err) throw new Error(err.message);
            fetchAll();
          } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
        };
        // Expose via window for inline calls
        if (typeof window !== "undefined") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__handleRejectRefundFor = handleRejectRefundFor;
        }
        return null;
      })()}

      {/* ── FULL REFUND DETAIL MODAL (900px) ── */}
      {viewRefund && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setViewRefund(null)}></div>
          <div className="relative bg-white rounded-2xl shadow-2xl w-full overflow-y-auto" style={{ maxWidth: 900, maxHeight: "90vh", padding: 24, borderRadius: 20 }}>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Refund Details</h2>
                <p className="text-sm text-gray-500 mt-0.5">Refund ID: {viewRefund.id?.slice(0, 8)}</p>
              </div>
              <button onClick={() => setViewRefund(null)} className="p-2 hover:bg-gray-100 rounded-xl transition">
                <XCircle className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* ── LEFT COLUMN: Trip Info + Riders/Drivers ── */}
              <div className="space-y-4">
                {/* Trip Information */}
                <div className="bg-gray-50 rounded-2xl p-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><Car className="h-4 w-4 text-gray-400" />Trip Information</h4>
                  <div className="space-y-2 text-sm">
                    {[
                      { l: "Pickup", v: viewRefund.pickup_address || "—" },
                      { l: "Drop-off", v: viewRefund.dropoff_address || "—" },
                      { l: "Distance", v: viewRefund.distance_km ? `${viewRefund.distance_km} km` : "—" },
                      { l: "Duration", v: viewRefund.duration_min ? `${viewRefund.duration_min} min` : "—" },
                      { l: "Fare", v: formatCurrency(viewRefund.ride_fare || viewRefund.amount) },
                      { l: "City", v: viewRefund.ride_city || viewRefund.city || "—" },
                      { l: "Vehicle Class", v: viewRefund.vehicle_class || "—" },
                      { l: "Trip Status", v: viewRefund.ride_status || "—" },
                      { l: "Cancellation Reason", v: viewRefund.ride_cancellation_reason || viewRefund.cancellation_reason || "—" },
                    ].map(f => (
                      <div key={f.l} className="flex justify-between"><span className="text-gray-400 text-xs">{f.l}</span><span className="text-xs font-medium text-gray-700 text-right max-w-[60%]">{f.v}</span></div>
                    ))}
                  </div>
                </div>

                {/* Rider Payment */}
                <div className="bg-gray-50 rounded-2xl p-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><CreditCard className="h-4 w-4 text-blue-400" />Rider Payment</h4>
                  <div className="space-y-2 text-sm">
                    {[
                      { l: "Amount Paid", v: formatCurrency(viewRefund.payment_amount || viewRefund.amount) },
                      { l: "Payment Method", v: getPaymentMethodLabel(viewRefund.payment_method) },
                      { l: "Provider Reference", v: viewRefund.payment_reference || viewRefund.transaction_reference || "—" },
                      { l: "Payment Time", v: viewRefund.paid_at ? new Date(viewRefund.paid_at).toLocaleString() : "—" },
                      { l: "Payment Status", v: viewRefund.payment_status || "—" },
                    ].map(f => (
                      <div key={f.l} className="flex justify-between"><span className="text-gray-400 text-xs">{f.l}</span><span className="text-xs font-medium text-gray-700">{f.v}</span></div>
                    ))}
                  </div>
                </div>

                {/* Driver Earnings */}
                <div className="bg-gray-50 rounded-2xl p-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><Wallet className="h-4 w-4 text-green-400" />Driver Earnings</h4>
                  <div className="space-y-2 text-sm">
                    {[
                      { l: "Gross Fare", v: formatCurrency(viewRefund.gross_fare || 0) },
                      { l: "Driver Share (Net)", v: formatCurrency(viewRefund.net_earning || 0) },
                      { l: "Company Commission", v: formatCurrency(viewRefund.commission_amount || 0) },
                      { l: "Tax/VAT", v: formatCurrency(viewRefund.tax_amount || 0) },
                      { l: "Payout Status", v: viewRefund.payout_status ? (viewRefund.payout_held ? "HELD" : viewRefund.payout_status) : "No payout" },
                    ].map(f => (
                      <div key={f.l} className="flex justify-between"><span className="text-gray-400 text-xs">{f.l}</span><span className={`text-xs font-medium ${f.l.includes("Commission") || f.l.includes("Tax") ? "text-red-500" : "text-gray-700"}`}>{f.v}</span></div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── RIGHT COLUMN: Decision + Evidence ── */}
              <div className="space-y-4">
                {/* Refund Decision */}
                <div className="bg-white border border-gray-200 rounded-2xl p-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><Shield className="h-4 w-4 text-purple-400" />Refund Decision</h4>
                  
                  {viewRefund.status === "pending" ? (
                    <div className="space-y-4">
                      {/* Decision type */}
                      <div>
                        <label className="text-[11px] font-medium text-gray-500 block mb-2">Decision</label>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { value: "full_refund", label: "Full Refund", desc: "Return all money" },
                            { value: "partial_refund", label: "Partial Refund", desc: "Return portion" },
                            { value: "no_refund", label: "No Refund", desc: "Decline refund" },
                            { value: "refund_and_penalize", label: "Refund + Penalize", desc: "Fine driver too" },
                            { value: "company_absorb", label: "Company Absorbs", desc: "We pay, not driver" },
                            { value: "hold_payout", label: "Hold Payout", desc: "Freeze driver money" },
                          ].map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setRefundDecision(opt.value)}
                              className={`p-3 rounded-xl border-2 text-left transition-all ${
                                refundDecision === opt.value
                                  ? "border-green-500 bg-green-50"
                                  : "border-gray-200 hover:border-gray-300"
                              }`}
                            >
                              <p className="text-xs font-semibold text-gray-900">{opt.label}</p>
                              <p className="text-[10px] text-gray-400">{opt.desc}</p>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Partial amount */}
                      {refundDecision === "partial_refund" && (
                        <div>
                          <label className="text-[11px] font-medium text-gray-500 block mb-1">Partial Amount (MWK)</label>
                          <input type="number" value={partialAmount || ""} onChange={e => setPartialAmount(parseFloat(e.target.value) || 0)} placeholder="Enter amount..." className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
                        </div>
                      )}

                      {/* Penalty */}
                      {refundDecision === "refund_and_penalize" && (
                        <div className="space-y-3">
                          <div>
                            <label className="text-[11px] font-medium text-gray-500 block mb-1">Penalty Amount (MWK)</label>
                            <input type="number" value={penaltyAmount || ""} onChange={e => setPenaltyAmount(parseFloat(e.target.value) || 0)} placeholder="Enter penalty..." className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
                          </div>
                          <div>
                            <label className="text-[11px] font-medium text-gray-500 block mb-1">Penalty Target</label>
                            <select value={penaltyTarget} onChange={e => setPenaltyTarget(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
                              <option value="driver">Driver</option>
                              <option value="rider">Rider</option>
                              <option value="company">Company</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {/* Hold Payout toggle */}
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={holdPayout} onChange={e => setHoldPayout(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500" />
                        <span className="text-xs text-gray-700">Hold driver payout during investigation</span>
                      </label>
                    </div>
                  ) : (
                    <div className="space-y-2 text-sm">
                      <p className="text-xs text-gray-500">Current status: <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColor(viewRefund.status)}`}>{viewRefund.status}</span></p>
                      {viewRefund.decision && <p className="text-xs text-gray-500">Decision: <span className="font-medium text-gray-700">{viewRefund.decision.replace(/_/g, " ")}</span></p>}
                      {(viewRefund.partial_amount ?? 0) > 0 && <p className="text-xs text-gray-500">Partial Amount: <span className="font-medium text-gray-700">{formatCurrency(viewRefund.partial_amount ?? 0)}</span></p>}
                      {viewRefund.admin_notes && <p className="text-xs text-gray-500">Notes: <span className="text-gray-700">{viewRefund.admin_notes}</span></p>}
                    </div>
                  )}
                </div>

                {/* Evidence */}
                <div className="bg-gray-50 rounded-2xl p-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><FileText className="h-4 w-4 text-amber-400" />Evidence</h4>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-xs text-gray-400 block">Rider Complaint</span>
                      <p className="text-xs text-gray-700 mt-0.5">{viewRefund.rider_complaint || viewRefund.reason || "No complaint provided"}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400 block">Driver Response</span>
                      <p className="text-xs text-gray-700 mt-0.5">{viewRefund.driver_response || "No response yet"}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400 block">Cancellation Reason</span>
                      <p className="text-xs text-gray-700 mt-0.5">{viewRefund.ride_cancellation_reason || viewRefund.cancellation_reason || "N/A"}</p>
                    </div>
                    {viewRefund.evidence_urls && viewRefund.evidence_urls.length > 0 && (
                      <div>
                        <span className="text-xs text-gray-400 block">Uploaded Files</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {viewRefund.evidence_urls.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noopener" className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-100">File {i + 1}</a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Admin Notes */}
                <div>
                  <label className="text-xs font-medium text-gray-700 mb-1 flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />Admin Notes</label>
                  <textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} placeholder="Add internal notes..." rows={3} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => setViewRefund(null)} className="px-5 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">Close</button>
              
              {viewRefund.status === "pending" && (
                <>
                  <button onClick={() => handleEscalateToDispute(viewRefund.id)} disabled={processing} className="px-4 py-2.5 text-sm font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-xl hover:bg-orange-100 disabled:opacity-50">
                    <Flag className="h-4 w-4 inline mr-1" />Escalate
                  </button>
                  <button onClick={handleRejectRefund} disabled={processing} className="px-5 py-2.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 disabled:opacity-50">
                    <XCircle className="h-4 w-4 inline mr-1" />Reject
                  </button>
                  <button onClick={handleApproveRefund} disabled={processing} className="flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white text-sm font-medium rounded-xl hover:bg-green-700 disabled:opacity-50">
                    {processing ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>Processing...</> : <><CheckCircle className="h-4 w-4" />Apply Decision</>}
                  </button>
                </>
              )}
              
              {viewRefund.status === "failed" && (
                <button onClick={() => { handleRetryRefund(viewRefund.id); setViewRefund(null); }} className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700">
                  <RotateCcw className="h-4 w-4" />Retry Refund
                </button>
              )}

              {viewRefund.status !== "pending" && viewRefund.status !== "failed" && viewRefund.status !== "refunded" && viewRefund.status !== "rejected" && (
                <button onClick={() => handleCancelRefund(viewRefund.id)} disabled={processing} className="px-5 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 border border-gray-200 rounded-xl hover:bg-gray-200 disabled:opacity-50">
                  <Ban className="h-4 w-4 inline mr-1" />Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Initiate Refund Modal ── */}
      {initiatePayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setInitiatePayment(null)}></div>
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Initiate Refund</h2>
              <button onClick={() => setInitiatePayment(null)} className="p-1.5 hover:bg-gray-100 rounded-lg"><XCircle className="h-5 w-5 text-gray-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-semibold text-gray-900">{formatCurrency(initiatePayment.amount)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Method</span><span className="font-medium text-gray-900">{getPaymentMethodLabel(initiatePayment.payment_method)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Reference</span><span className="font-medium text-gray-900 text-xs font-mono">{initiatePayment.transaction_reference || "N/A"}</span></div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Reason for Refund</label>
                <textarea value={refundReason} onChange={e => setRefundReason(e.target.value)} placeholder="Enter reason for refund..." rows={3} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl">
              <button onClick={() => setInitiatePayment(null)} className="px-5 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-100">Cancel</button>
              <button onClick={handleInitiateRefund} disabled={processing} className="flex items-center gap-2 px-6 py-2.5 bg-orange-600 text-white text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50">
                {processing ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>Creating...</> : "Create Refund"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Payout Detail Modal ── */}
      {viewPayout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setViewPayout(null)}></div>
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md" style={{ maxHeight: "90vh", overflowY: "auto" }}>
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Payout Details</h2>
              <button onClick={() => setViewPayout(null)} className="p-1.5 hover:bg-gray-100 rounded-lg"><XCircle className="h-5 w-5 text-gray-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">Driver</span><span className="font-medium text-gray-900">{viewPayout.driver_name || "—"}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Gross Fare</span><span className="font-medium text-gray-900">{formatCurrency(viewPayout.gross_fare || viewPayout.amount || 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Commission</span><span className="font-medium text-red-500">-{formatCurrency(viewPayout.commission_amount || 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Tax/VAT</span><span className="font-medium text-red-500">-{formatCurrency(viewPayout.tax_amount || 0)}</span></div>
                <div className="flex justify-between border-t pt-2"><span className="text-gray-500 font-medium">Net Earning</span><span className="font-semibold text-green-600">{formatCurrency(viewPayout.net_earning || viewPayout.amount || 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Method</span><span className="font-medium text-gray-900">{getPaymentMethodLabel(viewPayout.payout_method)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Status</span><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(viewPayout.payout_status || "pending")}`}>{viewPayout.is_held ? "HELD" : viewPayout.payout_status || "pending"}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Date</span><span className="text-xs text-gray-700">{viewPayout.created_at ? new Date(viewPayout.created_at).toLocaleDateString() : "—"}</span></div>
              </div>
              <textarea value={payoutNotes} onChange={e => setPayoutNotes(e.target.value)} placeholder="Admin notes..." rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl">
              <button onClick={() => setViewPayout(null)} className="px-5 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-100">Close</button>
              {!viewPayout.is_held && viewPayout.payout_status !== "completed" && (
                <>
                  <button onClick={() => handleProcessPayout(viewPayout.id, "completed")} disabled={processing} className="px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-xl hover:bg-green-700 disabled:opacity-50">
                    {processing ? "Processing..." : "Mark Paid"}
                  </button>
                </>
              )}
              {viewPayout.is_held && (
                <button onClick={() => { handleReleasePayout(viewPayout.id); setViewPayout(null); }} className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700">
                  Release Payout
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}