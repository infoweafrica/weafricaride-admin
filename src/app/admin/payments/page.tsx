"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Payment, DriverPayout } from "@/lib/types";
import { Search, Filter, Eye, Download, RefreshCw } from "lucide-react";
import { formatCurrency, formatDate, timeAgo, getStatusColor, getPaymentMethodLabel } from "@/lib/utils";

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [filteredPayments, setFilteredPayments] = useState<Payment[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [showRefund, setShowRefund] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [activeTab, setActiveTab] = useState<"payments" | "payouts">("payments");
  const [payouts, setPayouts] = useState<DriverPayout[]>([]);

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { filterPayments(); }, [search, statusFilter, methodFilter, payments]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: p } = await supabase.from("payments").select("*, ride:rides(rider:riders(user:users(full_name)))").order("created_at", { ascending: false }).limit(50);
      setPayments(p || []);
      const { data: po } = await supabase.from("driver_payouts").select("*, driver:drivers(user:users(full_name))").order("created_at", { ascending: false }).limit(20);
      setPayouts(po || []);
    } catch {
      setPayments([]);
      setPayouts([]);
    } finally { setLoading(false); }
  };

  const filterPayments = () => {
    let filtered = [...payments];
    if (search) { const s = search.toLowerCase(); filtered = filtered.filter(p => p.transaction_reference?.toLowerCase().includes(s) || p.ride_id?.slice(0,8).includes(s)); }
    if (statusFilter !== "all") filtered = filtered.filter(p => p.payment_status === statusFilter);
    if (methodFilter !== "all") filtered = filtered.filter(p => p.payment_method === methodFilter);
    setFilteredPayments(filtered);
  };

  const handleRefund = async () => {
    if (!selectedPayment) return;
    try { await supabase.from("payments").update({ payment_status: "refunded", refund_reason: refundReason, refund_amount: selectedPayment.amount, refunded_at: new Date().toISOString() }).eq("id", selectedPayment.id); fetchData(); setShowRefund(false); setRefundReason(""); } catch {}
  };

  const totalRevenue = payments.filter(p => p.payment_status === "completed").reduce((sum, p) => sum + p.amount, 0);
  const totalRefunded = payments.filter(p => p.payment_status === "refunded").reduce((sum, p) => sum + (p.refund_amount ?? 0), 0);
  const totalFailed = payments.filter(p => p.payment_status === "failed").reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payments & Payouts</h1>
        <p className="text-gray-500 mt-1">Manage ride payments and driver payouts</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Total Revenue</p>
          <p className="text-xl font-bold text-green-600">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Total Refunded</p>
          <p className="text-xl font-bold text-orange-600">{formatCurrency(totalRefunded)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Failed Payments</p>
          <p className="text-xl font-bold text-red-600">{formatCurrency(totalFailed)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        <button onClick={() => setActiveTab("payments")} className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === "payments" ? "border-green-600 text-green-600" : "border-transparent text-gray-500"}`}>Ride Payments</button>
        <button onClick={() => setActiveTab("payouts")} className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === "payouts" ? "border-green-600 text-green-600" : "border-transparent text-gray-500"}`}>Driver Payouts</button>
      </div>

      {/* Filters */}
      {activeTab === "payments" && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input type="text" placeholder="Search transaction ref..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm">
                <option value="all">All Status</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
                <option value="refunded">Refunded</option>
              </select>
              <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm">
                <option value="all">All Methods</option>
                <option value="cash">Cash</option>
                <option value="airtel_money">Airtel Money</option>
                <option value="tnm_mpamba">TNM Mpamba</option>
                <option value="wallet">Wallet</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-3 font-medium">Transaction</th>
                      <th className="px-4 py-3 font-medium">Method</th>
                      <th className="px-4 py-3 font-medium text-right">Amount</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.map((pay) => (
                      <tr key={pay.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-3 text-xs"><p className="font-mono text-gray-400">{pay.transaction_reference || "N/A"}</p></td>
                        <td className="px-4 py-3"><span className="text-xs">{getPaymentMethodLabel(pay.payment_method || "Unknown")}</span></td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(pay.amount)}</td>
                        <td className="px-4 py-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(pay.payment_status || "unknown")}`}>{pay.payment_status || "Unknown"}</span></td>
                        <td className="px-4 py-3 text-xs text-gray-500">{timeAgo(pay.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {pay.payment_status === "completed" && (
                              <button onClick={() => { setSelectedPayment(pay); setShowRefund(true); }} className="px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200">Refund</button>
                            )}
                            <Download className="h-4 w-4 text-gray-400" />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredPayments.length === 0 && <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-400">No payments found</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === "payouts" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 font-medium">Driver</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((po) => (
                  <tr key={po.id} className="border-b border-gray-50">
                    <td className="px-4 py-3 text-xs">{po.driver?.user?.full_name || "Unknown"}</td>
                    <td className="px-4 py-3 text-xs">{getPaymentMethodLabel(po.payout_method || "Unknown")}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(po.amount)}</td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(po.payout_status || "unknown")}`}>{po.payout_status || "Unknown"}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-500">{timeAgo(po.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {po.payout_status === "pending" && (
                        <button className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">Process</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showRefund && selectedPayment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h2 className="text-lg font-semibold">Process Refund</h2>
            <p className="text-sm text-gray-600">Amount: <strong>{formatCurrency(selectedPayment.amount)}</strong></p>
            <textarea value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Reason for refund..." rows={3} className="w-full px-3 py-2 border rounded-lg text-sm" />
            <div className="flex gap-2">
              <button onClick={() => setShowRefund(false)} className="flex-1 px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={handleRefund} className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm">Confirm Refund</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}