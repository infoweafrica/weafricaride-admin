"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, RefreshCw, X, Package, Loader2 } from "lucide-react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { ErrorBoundary, ApiErrorDisplay, EmptyState } from "@/components/ErrorBoundary";
import Pagination from "@/components/Pagination";
import { formatCurrency, formatDate, timeAgo, getStatusColor } from "@/lib/utils";
import {
  fetchDeliveries,
  cancelDelivery,
  retryDeliveryDispatch,
  deliveryStatusLabel,
  DELIVERY_ACTIVE_STATUSES,
  DELIVERY_STATUSES,
  type DeliveryRequest,
  type DeliveryFilters,
} from "@/lib/api/deliveries";

export default function DeliveriesPage() {
  return (
    <PermissionGuard permission="manage_rides">
      <ErrorBoundary>
        <DeliveriesContent />
      </ErrorBoundary>
    </PermissionGuard>
  );
}

function DeliveriesContent() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [rows, setRows] = useState<DeliveryRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [selected, setSelected] = useState<DeliveryRequest | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const filters: DeliveryFilters = {
      status: statusFilter,
      paymentStatus: paymentStatusFilter,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    };
    const res = await fetchDeliveries(page, pageSize, filters);
    if (res.error) {
      setError(res.error);
      setRows([]);
    } else {
      setRows(res.data || []);
    }
    setTotalCount(res.totalCount ?? 0);
    setTotalPages(res.totalPages ?? 0);
    setLoading(false);
  }, [page, pageSize, statusFilter, paymentStatusFilter, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, paymentStatusFilter, dateFrom, dateTo]);

  async function handleCancel(d: DeliveryRequest) {
    const reason = window.prompt("Cancellation reason (optional):", "Cancelled by admin");
    if (reason === null) return;
    setActionId(d.id);
    setActionError(null);
    try {
      await cancelDelivery(d.id, reason);
      setSelected(null);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setActionId(null);
    }
  }

  async function handleRetry(d: DeliveryRequest) {
    setActionId(d.id);
    setActionError(null);
    try {
      await retryDeliveryDispatch(d.id);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Re-dispatch failed");
    } finally {
      setActionId(null);
    }
  }

  const visible = search
    ? rows.filter((r) => {
        const s = search.toLowerCase();
        return (
          r.reference?.toLowerCase().includes(s) ||
          r.recipient_name?.toLowerCase().includes(s) ||
          r.recipient_phone?.toLowerCase().includes(s) ||
          r.pickup_contact_phone?.toLowerCase().includes(s) ||
          r.driver?.full_name?.toLowerCase().includes(s) ||
          r.pickup_address?.toLowerCase().includes(s) ||
          r.dropoff_address?.toLowerCase().includes(s)
        );
      })
    : rows;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="h-6 w-6 text-green-600" /> Deliveries
          </h1>
          <p className="text-gray-500 mt-1">
            {totalCount} package {totalCount === 1 ? "delivery" : "deliveries"} — courier jobs, separate from Rides.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <ApiErrorDisplay error={error} onRetry={load} />
      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[220px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search ref, recipient, phone, driver, address…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm bg-white"
          >
            <option value="all">All statuses</option>
            <option value="active">Active (in flight)</option>
            {DELIVERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {deliveryStatusLabel(s)}
              </option>
            ))}
          </select>
          <select
            value={paymentStatusFilter}
            onChange={(e) => setPaymentStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm bg-white"
          >
            <option value="all">Any payment</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No deliveries"
            description="No package deliveries match these filters."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Ref</th>
                  <th className="px-4 py-3 text-left">Package</th>
                  <th className="px-4 py-3 text-left">Route</th>
                  <th className="px-4 py-3 text-left">Recipient</th>
                  <th className="px-4 py-3 text-left">Driver</th>
                  <th className="px-4 py-3 text-right">Fee</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Requested</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((d) => {
                  const isActive = DELIVERY_ACTIVE_STATUSES.includes(d.status);
                  const canRetry = ["no_driver", "searching_driver", "requested"].includes(d.status);
                  const busy = actionId === d.id;
                  return (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setSelected(d)}
                          className="font-mono font-medium text-green-700 hover:underline"
                        >
                          {d.reference}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span className="capitalize">{d.package_type}</span>
                        {d.is_fragile && (
                          <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            FRAGILE
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-[260px]">
                        <div className="truncate text-gray-900">{d.pickup_address || "—"}</div>
                        <div className="truncate text-gray-400">→ {d.dropoff_address || "—"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-900">{d.recipient_name || "—"}</div>
                        <div className="text-gray-400">{d.recipient_phone || ""}</div>
                      </td>
                      <td className="px-4 py-3">{d.driver?.full_name || <span className="text-gray-400">Unassigned</span>}</td>
                      <td className="px-4 py-3 text-right">
                        {formatCurrency(d.delivery_fee ?? 0, d.currency || "MWK")}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(
                            d.status,
                          )}`}
                        >
                          {deliveryStatusLabel(d.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500" title={formatDate(d.requested_at || d.created_at)}>
                        {timeAgo(d.requested_at || d.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {canRetry && (
                            <button
                              disabled={busy}
                              onClick={() => handleRetry(d)}
                              className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50"
                            >
                              {busy ? "…" : "Re-dispatch"}
                            </button>
                          )}
                          {isActive && (
                            <button
                              disabled={busy}
                              onClick={() => handleCancel(d)}
                              className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              {busy ? "…" : "Cancel"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={() => setSelected(null)}>
          <div
            className="w-full max-w-lg rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="font-mono text-lg font-bold">{selected.reference}</h2>
                <span
                  className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(selected.status)}`}
                >
                  {deliveryStatusLabel(selected.status)}
                </span>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-lg p-1 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <dl className="space-y-2 text-sm">
              <Row label="Package">
                <span className="capitalize">{selected.package_type}</span>
                {selected.is_fragile ? " · fragile" : ""}
                {selected.package_description ? ` · ${selected.package_description}` : ""}
              </Row>
              <Row label="Pickup">{selected.pickup_address || "—"}</Row>
              <Row label="Pickup contact">
                {(selected.pickup_contact_name || "—") + (selected.pickup_contact_phone ? ` · ${selected.pickup_contact_phone}` : "")}
              </Row>
              <Row label="Drop-off">{selected.dropoff_address || "—"}</Row>
              <Row label="Recipient">
                {(selected.recipient_name || "—") + (selected.recipient_phone ? ` · ${selected.recipient_phone}` : "")}
              </Row>
              <Row label="Driver">{selected.driver?.full_name || "Unassigned"}{selected.driver?.phone ? ` · ${selected.driver.phone}` : ""}</Row>
              <Row label="PINs">
                <span className="font-mono">pickup {selected.pickup_pin || "----"} · dropoff {selected.dropoff_pin || "----"}</span>
              </Row>
              <Row label="Fee">
                {formatCurrency(selected.delivery_fee ?? 0, selected.currency || "MWK")} · {selected.payment_method} · {selected.payment_status}
              </Row>
              <Row label="Distance">{selected.distance_km != null ? `${selected.distance_km} km` : "—"}</Row>
              <Row label="Requested">{formatDate(selected.requested_at || selected.created_at)}</Row>
              {selected.cancellation_reason && <Row label="Cancel reason">{selected.cancellation_reason}</Row>}
              {selected.failure_reason && <Row label="Failure">{selected.failure_reason}</Row>}
            </dl>
            <div className="mt-5 flex justify-end gap-2">
              {["no_driver", "searching_driver", "requested"].includes(selected.status) && (
                <button
                  disabled={actionId === selected.id}
                  onClick={() => handleRetry(selected)}
                  className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50"
                >
                  Re-dispatch
                </button>
              )}
              {DELIVERY_ACTIVE_STATUSES.includes(selected.status) && (
                <button
                  disabled={actionId === selected.id}
                  onClick={() => handleCancel(selected)}
                  className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Cancel delivery
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-gray-400">{label}</dt>
      <dd className="text-gray-900">{children}</dd>
    </div>
  );
}
