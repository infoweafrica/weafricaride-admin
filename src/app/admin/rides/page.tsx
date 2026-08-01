"use client";

import { useState, useEffect, useCallback } from "react";
import { ErrorBoundary, ApiErrorDisplay, EmptyState } from "@/components/ErrorBoundary";
import { useCityContext } from "@/lib/city-context";
import Pagination from "@/components/Pagination";
import { Search, Eye, MapPin, Filter, X } from "lucide-react";
import {
  formatCurrency,
  formatDate,
  timeAgo,
  getStatusColor,
  getRideStatusLabel,
  getPaymentMethodLabel,
} from "@/lib/utils";
import type { Ride, RideStatus } from "@/lib/types";
import {
  fetchRides,
  reassignRideDriver,
  refundRide,
  type RideFilters,
} from "@/lib/api/rides";
import type { PaginatedResult } from "@/lib/api/base";

export default function RidesPage() {
  return (
    <ErrorBoundary>
      <RidesContent />
    </ErrorBoundary>
  );
}

function RidesContent() {
  const { selectedCityId, selectedCityName } = useCityContext();

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RideStatus | "all">("all");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Data state
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<Omit<PaginatedResult<Ride[]>, "data">>({
    page: 1,
    pageSize: 25,
    totalCount: 0,
    totalPages: 0,
    count: 0,
    error: null,
  });

  // Detail modal
  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadRides = useCallback(async () => {
    setLoading(true);
    setError(null);

    const filters: RideFilters = {
      cityId: selectedCityId,
      status: statusFilter,
      paymentStatus: paymentStatusFilter,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      search: search || undefined,
    };

    const result = await fetchRides(page, pageSize, filters);

    if (result.error) {
      setError(result.error);
      setRides([]);
    } else {
      setRides(result.data || []);
    }

    setPagination({
      page: result.page,
      pageSize: result.pageSize,
      totalCount: result.totalCount ?? 0,
      totalPages: result.totalPages,
      count: result.count,
      error: result.error,
    });

    setLoading(false);
  }, [page, pageSize, statusFilter, paymentStatusFilter, dateFrom, dateTo, search]);

  useEffect(() => {
    loadRides();
  }, [loadRides, selectedCityId]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, paymentStatusFilter, dateFrom, dateTo, search]);

  const handleReassign = async (rideId: string) => {
    setActionLoading(rideId);
    const ok = await reassignRideDriver(rideId);
    if (ok) {
      loadRides();
      setShowDetail(false);
    }
    setActionLoading(null);
  };

  const handleRefund = async (rideId: string) => {
    setActionLoading(rideId);
    const ok = await refundRide(rideId);
    if (ok) {
      loadRides();
      setShowDetail(false);
    }
    setActionLoading(null);
  };

  // Client-side text search for rider/driver name
  const filteredRides = search
    ? rides.filter((r) => {
        const s = search.toLowerCase();
        const riderName = (
          r.rider as unknown as { user?: { full_name?: string } }
        )?.user?.full_name?.toLowerCase();
        const driverName = (
          r.driver as unknown as { user?: { full_name?: string } }
        )?.user?.full_name?.toLowerCase();
        const rideId = r.id?.toLowerCase().slice(0, 8);
        return (
          riderName?.includes(s) ||
          driverName?.includes(s) ||
          rideId?.includes(s)
        );
      })
    : rides;

  const rideStatuses: (RideStatus | "all")[] = [
    "all",
    "requested",
    "searching",
    "accepted",
    "driver_arriving",
    "driver_arrived",
    "in_progress",
    "completed",
    "cancelled",
    "scheduled",
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rides</h1>
          <p className="text-gray-500 mt-1">
            {selectedCityName === "All Cities"
              ? `${String(pagination.totalCount ?? 0)} total rides — view and manage`
              : `${String(pagination.totalCount ?? 0)} rides in ${selectedCityName}`}
          </p>
        </div>
      </div>

      {/* API Error Banner */}
      <ApiErrorDisplay error={error} onRetry={loadRides} />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by rider, driver, or ride ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as RideStatus | "all")}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm bg-white"
          >
            {rideStatuses.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All Status" : getRideStatusLabel(s)}
              </option>
            ))}
          </select>
          <select
            value={paymentStatusFilter}
            onChange={(e) => setPaymentStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm bg-white"
          >
            <option value="all">All Payments</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm"
            title="From date"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm"
            title="To date"
          />
        </div>
      </div>

      {/* Rides Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 font-medium">Ride ID</th>
                    <th className="px-4 py-3 font-medium">Rider</th>
                    <th className="px-4 py-3 font-medium">Driver</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Payment</th>
                    <th className="px-4 py-3 font-medium text-right">Fare</th>
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRides.length > 0 ? (
                    filteredRides.map((ride) => {
                      const riderName =
                        (ride.rider as unknown as { user?: { full_name?: string } })?.user?.full_name || "N/A";
                      const driverName =
                        (ride.driver as unknown as { user?: { full_name?: string } })?.user?.full_name || "Unassigned";
                      const categoryName =
                        (ride.category as unknown as { name?: string })?.name || "N/A";
                      return (
                        <tr
                          key={ride.id}
                          className="border-b border-gray-50 hover:bg-gray-50"
                        >
                          <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                            {ride.id?.slice(0, 8)}
                          </td>
                          <td className="px-4 py-3 text-xs font-medium">
                            {riderName}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {driverName}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {categoryName}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(ride.status)}`}
                            >
                              {getRideStatusLabel(ride.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <span
                              className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(ride.payment_status)}`}
                            >
                              {getPaymentMethodLabel(ride.payment_method)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-xs font-medium">
                            {formatCurrency(ride.actual_fare || ride.estimated_fare || 0)}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {timeAgo(ride.created_at)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => {
                                setSelectedRide(ride);
                                setShowDetail(true);
                              }}
                              className="p-1.5 hover:bg-gray-100 rounded text-gray-500"
                              title="View details"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9} className="px-6 py-12">
                        <EmptyState
                          icon={MapPin}
                          title="No rides found"
                          description="Rides will appear here as they happen. Adjust filters to see more."
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              totalCount={pagination.totalCount}
              pageSize={pagination.pageSize}
              onPageChange={(p) => setPage(p)}
              onPageSizeChange={(ps) => {
                setPageSize(ps);
                setPage(1);
              }}
            />
          </>
        )}
      </div>

      {/* Ride Detail Modal */}
      {showDetail && selectedRide && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="p-6 border-b flex items-center justify-between sticky top-0 bg-white rounded-t-xl z-10">
              <h2 className="text-lg font-semibold">Ride Details</h2>
              <button
                onClick={() => setShowDetail(false)}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-gray-400">Ride ID</p>
                  <p className="text-sm font-mono">{selectedRide.id}</p>
                </div>
                <span
                  className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(selectedRide.status)}`}
                >
                  {getRideStatusLabel(selectedRide.status)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-400 mb-2">Rider</p>
                  <p className="text-sm font-medium">
                    {(selectedRide.rider as unknown as { user?: { full_name?: string } })?.user?.full_name || "Unknown"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {(selectedRide.rider as unknown as { user?: { phone?: string } })?.user?.phone || ""}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-400 mb-2">Driver</p>
                  <p className="text-sm font-medium">
                    {(selectedRide.driver as unknown as { user?: { full_name?: string } })?.user?.full_name || "Unassigned"}
                  </p>
                  {selectedRide.vehicle && (
                    <p className="text-xs text-gray-500">
                      {(selectedRide.vehicle as unknown as { plate_number?: string; make?: string; model?: string }).plate_number} — {(selectedRide.vehicle as unknown as { make?: string }).make} {(selectedRide.vehicle as unknown as { model?: string }).model}
                    </p>
                  )}
                </div>
              </div>

              {/* Fare Breakdown */}
              <div className="border rounded-lg p-4">
                <h3 className="text-sm font-semibold mb-3">Fare Breakdown</h3>
                <div className="space-y-2 text-sm">
                  <FareRow label="Base Fare" value={selectedRide.base_fare || 0} />
                  <FareRow
                    label={`Distance (${selectedRide.actual_distance_km || selectedRide.estimated_distance_km || 0} km)`}
                    value={selectedRide.distance_fare || 0}
                  />
                  <FareRow
                    label={`Time (${selectedRide.actual_duration_minutes || selectedRide.estimated_duration_minutes || 0} min)`}
                    value={selectedRide.time_fare || 0}
                  />
                  {selectedRide.waiting_fee ? (
                    <FareRow label="Waiting Fee" value={selectedRide.waiting_fee} />
                  ) : null}
                  {selectedRide.cancellation_fee ? (
                    <FareRow label="Cancellation Fee" value={selectedRide.cancellation_fee} />
                  ) : null}
                  {selectedRide.promo_discount ? (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Promo Discount</span>
                      <span className="text-green-600">
                        -{formatCurrency(selectedRide.promo_discount)}
                      </span>
                    </div>
                  ) : null}
                  <div className="border-t pt-2 flex justify-between font-medium">
                    <span>Total</span>
                    <span>
                      {formatCurrency(selectedRide.actual_fare || selectedRide.estimated_fare || 0)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Timeline */}
              <div className="border rounded-lg p-4">
                <h3 className="text-sm font-semibold mb-2">Timeline</h3>
                <div className="space-y-1 text-xs">
                  {selectedRide.requested_at && (
                    <TimelineItem label="Requested" time={selectedRide.requested_at} />
                  )}
                  {selectedRide.accepted_at && (
                    <TimelineItem label="Accepted" time={selectedRide.accepted_at} />
                  )}
                  {selectedRide.arrived_at && (
                    <TimelineItem label="Arrived" time={selectedRide.arrived_at} />
                  )}
                  {selectedRide.started_at && (
                    <TimelineItem label="Started" time={selectedRide.started_at} />
                  )}
                  {selectedRide.completed_at && (
                    <TimelineItem label="Completed" time={selectedRide.completed_at} />
                  )}
                  {selectedRide.cancelled_at && (
                    <TimelineItem label="Cancelled" time={selectedRide.cancelled_at} />
                  )}
                  {selectedRide.cancellation_reason && (
                    <div className="ml-4 text-red-600">
                      Reason: {selectedRide.cancellation_reason}
                    </div>
                  )}
                </div>
              </div>

              {/* Admin Actions */}
              {["searching", "requested"].includes(selectedRide.status) && (
                <button
                  onClick={() => handleReassign(selectedRide.id)}
                  disabled={actionLoading === selectedRide.id}
                  className="w-full px-4 py-2 bg-yellow-600 text-white rounded-lg text-sm font-medium hover:bg-yellow-700 disabled:opacity-50"
                >
                  {actionLoading === selectedRide.id ? "Working..." : "Reassign Driver"}
                </button>
              )}
              {selectedRide.payment_status === "paid" &&
                selectedRide.status === "completed" && (
                  <button
                    onClick={() => handleRefund(selectedRide.id)}
                    disabled={actionLoading === selectedRide.id}
                    className="w-full px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
                  >
                    {actionLoading === selectedRide.id ? "Working..." : "Process Refund"}
                  </button>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Helpers ---

function FareRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span>{formatCurrency(value)}</span>
    </div>
  );
}

function TimelineItem({ label, time }: { label: string; time: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-1.5 rounded-full bg-green-500 flex-shrink-0"></div>
      <span className="text-gray-500 w-20">{label}</span>
      <span className="text-gray-700">{formatDate(time)}</span>
    </div>
  );
}