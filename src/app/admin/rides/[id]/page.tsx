"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  ArrowLeft,
  MapPin,
  Clock,
  DollarSign,
  User,
  Car,
  Shield,
  HeadphonesIcon,
  FileText,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Navigation2,
  Play,
  Pause,
} from "lucide-react";
import {
  formatCurrency,
  formatDate,
  getStatusColor,
  getRideStatusLabel,
  getPaymentMethodLabel,
} from "@/lib/utils";
import type { Ride } from "@/lib/types";

type RideWithRelations = Ride & {
  rider?: Record<string, any>;
  driver?: Record<string, any>;
  vehicle?: Record<string, any>;
  category?: Record<string, any>;
};

type AuditEntry = {
  id: string;
  action: string;
  created_at: string;
  actor: string;
};

type ComplaintEntry = {
  id: string;
  type: string;
  status: string;
  description: string;
  created_at: string;
};

export default function RideDetailPage() {
  const params = useParams();
  const router = useRouter();
  const rideId = params.id as string;

  const [ride, setRide] = useState<RideWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "timeline" | "payment" | "playback" | "support" | "audit">("details");
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [complaints, setComplaints] = useState<ComplaintEntry[]>([]);
  const [adminNote, setAdminNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const fetchRideDetails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from("rides")
        .select("*, rider:riders(user:users(full_name, phone, email)), driver:drivers(user:users(full_name, phone, email)), vehicle:vehicles(make, model, plate_number, color, year), category:ride_categories(name, icon, description)")
        .eq("id", rideId)
        .single();

      if (fetchError) throw new Error(fetchError.message);
      setRide(data as unknown as RideWithRelations);

      // Fetch related complaints
      const { data: compData } = await supabase
        .from("support_tickets")
        .select("id, category, status, description, created_at")
        .eq("ride_id", rideId)
        .order("created_at", { ascending: false });

      if (compData) {
        setComplaints((compData as unknown) as ComplaintEntry[]);
      }

      // Fetch audit logs
      const { data: auditData } = await supabase
        .from("audit_logs")
        .select("id, action, created_at, admin_email")
        .eq("entity_id", rideId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (auditData) {
        setAuditLogs((auditData as unknown) as AuditEntry[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ride");
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => {
    fetchRideDetails();
  }, [fetchRideDetails]);

  // Realtime subscription for live updates
  useEffect(() => {
    const channel = supabase
      .channel(`ride_${rideId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rides", filter: `id=eq.${rideId}` }, (payload) => {
        if (payload.new) setRide(payload.new as RideWithRelations);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [rideId]);

  const handleSaveNote = async () => {
    if (!adminNote.trim() || !ride) return;
    setSavingNote(true);
    try {
      await supabase.from("audit_logs").insert({
        action: "admin_note",
        entity_type: "ride",
        entity_id: ride.id,
        details: { note: adminNote.trim() },
        admin_email: "admin@weafrica.com",
      });
      setAdminNote("");
      fetchRideDetails();
    } finally {
      setSavingNote(false);
    }
  };

  const handleCancelRide = async () => {
    if (!ride || !confirm("Are you sure you want to cancel this ride?")) return;
    const { data: transition, error: transitionError } = await supabase.rpc("transition_trip_state", {
      p_trip_id: rideId,
      p_new_state: "system_cancelled",
      p_actor_type: "system",
      p_metadata: { reason: "Cancelled by admin" },
    });
    if (transitionError || !(transition as { success?: boolean } | null)?.success) {
      setError(
        transitionError?.message ??
          (transition as { error?: string } | null)?.error ??
          "Could not cancel ride"
      );
      return;
    }
    const { error: cancelError } = await supabase
      .from("rides")
      .update({ cancelled_at: new Date().toISOString(), cancellation_reason: "Cancelled by admin" })
      .eq("id", rideId);
    if (!cancelError) fetchRideDetails();
  };

  const handleRefundRide = async () => {
    if (!ride || !confirm("Process refund for this ride?")) return;
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("id")
      .eq("ride_id", rideId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (paymentError || !payment) {
      setError(paymentError?.message ?? "No payment found for this ride");
      return;
    }
    const { data: refund, error: createError } = await supabase
      .rpc("admin_create_refund", { p_payment_id: payment.id, p_reason: "Admin refund" })
      .single();
    if (createError) {
      setError(createError.message);
      return;
    }
    const refundId = (refund as { refund_id?: string } | null)?.refund_id;
    if (!refundId) {
      setError("Refund creation did not return an id");
      return;
    }
    const { error: processError } = await supabase.rpc("admin_process_refund", {
      p_refund_id: refundId,
      p_status: "approved",
      p_admin_notes: "Admin refund",
    });
    if (processError) {
      setError(processError.message);
      return;
    }
    fetchRideDetails();
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </button>
          <div className="animate-pulse h-8 w-48 bg-gray-200 rounded" />
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-gray-200 rounded-xl" />
          <div className="h-64 bg-gray-200 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !ride) {
    return (
      <div className="space-y-6">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-5 w-5" /> Back to Rides
        </button>
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
          <AlertTriangle className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-red-700">Ride Not Found</h2>
          <p className="text-red-500 mt-2">{error || "This ride may have been deleted or you don't have access."}</p>
        </div>
      </div>
    );
  }

  const riderObj = ride.rider as Record<string, any> | undefined;
  const riderUser = riderObj?.user as Record<string, any> | undefined;
  const driverObj = ride.driver as Record<string, any> | undefined;
  const driverUser = driverObj?.user as Record<string, any> | undefined;
  const vehicleObj = ride.vehicle as Record<string, any> | undefined;
  const categoryObj = ride.category as Record<string, any> | undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Ride Details</h1>
            <p className="text-gray-500 text-sm mt-1 font-mono">ID: {ride.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchRideDetails} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <span className={`inline-flex px-3 py-1.5 rounded-full text-sm font-medium ${getStatusColor(ride.status)}`}>
            {getRideStatusLabel(ride.status)}
          </span>
        </div>
      </div>

      {/* Status Bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm text-gray-700 font-medium">Live</span>
        </div>
        <div className="text-sm text-gray-500">
          <span className="text-gray-900 font-medium">{ride.pickup_address}</span>
          <span className="mx-2">→</span>
          <span className="text-gray-900 font-medium">{ride.dropoff_address}</span>
        </div>
        {ride.actual_fare && (
          <div className="text-sm font-semibold text-green-600">{formatCurrency(ride.actual_fare)}</div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg overflow-x-auto">
        {[
          { id: "details" as const, label: "Ride Info", icon: FileText },
          { id: "timeline" as const, label: "Timeline", icon: Clock },
          { id: "payment" as const, label: "Payment", icon: DollarSign },
          { id: "playback" as const, label: "Playback", icon: Play },
          { id: "support" as const, label: "Support", icon: HeadphonesIcon },
          { id: "audit" as const, label: "Audit", icon: Shield },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* ─── RIDE INFO TAB ─── */}
          {activeTab === "details" && (
            <>
              {/* Rider & Driver */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <User className="h-5 w-5 text-blue-600" />
                    </div>
                    <h3 className="font-semibold text-gray-900">Rider</h3>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p className="font-medium text-gray-900">{riderUser?.full_name || riderObj?.full_name || "N/A"}</p>
                    <p className="text-gray-500">{riderUser?.phone || riderObj?.phone || "No phone"}</p>
                    <p className="text-gray-500">{riderUser?.email || ""}</p>
                    <p className="text-xs text-gray-400">Rider ID: {ride.rider_id?.slice(0, 8)}</p>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-purple-50 rounded-lg">
                      <Car className="h-5 w-5 text-purple-600" />
                    </div>
                    <h3 className="font-semibold text-gray-900">Driver</h3>
                  </div>
                  <div className="space-y-2 text-sm">
                    {ride.driver_id ? (
                      <>
                        <p className="font-medium text-gray-900">{driverUser?.full_name || driverObj?.full_name || "N/A"}</p>
                        <p className="text-gray-500">{driverUser?.phone || driverObj?.phone || ""}</p>
                        {vehicleObj && (
                          <p className="text-gray-500">
                            {vehicleObj.make} {vehicleObj.model} ({vehicleObj.plate_number})
                          </p>
                        )}
                        <p className="text-xs text-gray-400">Driver ID: {ride.driver_id?.slice(0, 8)}</p>
                      </>
                    ) : (
                      <p className="text-gray-400 italic">No driver assigned</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Locations */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-amber-50 rounded-lg">
                    <MapPin className="h-5 w-5 text-amber-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Locations</h3>
                </div>
                <div className="space-y-4">
                  <div className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-3 h-3 rounded-full bg-green-500" />
                      <div className="w-0.5 h-12 bg-gray-200" />
                      <div className="w-3 h-3 rounded-full bg-red-500" />
                    </div>
                    <div className="space-y-8">
                      <div>
                        <p className="text-xs text-gray-400 font-medium">PICKUP</p>
                        <p className="text-sm font-medium text-gray-900">{ride.pickup_address}</p>
                        {ride.actual_distance_km && (
                          <p className="text-xs text-gray-500">{ride.actual_distance_km} km away</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 font-medium">DROPOFF</p>
                        <p className="text-sm font-medium text-gray-900">{ride.dropoff_address}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500 pt-2 border-t">
                    <span>Category: <strong>{categoryObj?.name || "N/A"}</strong></span>
                    {ride.actual_distance_km && <span>Distance: <strong>{ride.actual_distance_km} km</strong></span>}
                    {ride.actual_duration_minutes && <span>Duration: <strong>{ride.actual_duration_minutes} min</strong></span>}
                  </div>
                </div>
              </div>

              {/* Category & Vehicle */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-green-50 rounded-lg">
                    <Car className="h-5 w-5 text-green-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Category & Vehicle</h3>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-400 text-xs">Category</p>
                    <p className="font-medium">{categoryObj?.name || "N/A"}</p>
                    <p className="text-gray-500 text-xs">{categoryObj?.description || ""}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-xs">Vehicle</p>
                    {vehicleObj ? (
                      <>
                        <p className="font-medium">{vehicleObj.make} {vehicleObj.model}</p>
                        <p className="text-gray-500">{vehicleObj.plate_number} • {vehicleObj.color} • {vehicleObj.year}</p>
                      </>
                    ) : (
                      <p className="text-gray-400 italic">No vehicle assigned</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ─── TIMELINE TAB ─── */}
          {activeTab === "timeline" && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Clock className="h-5 w-5 text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-900">Ride Timeline</h3>
              </div>
              <div className="space-y-0">
                {[
                  { label: "Requested", time: ride.requested_at || ride.created_at, icon: "📝" },
                  { label: "Driver Assigned", time: ride.accepted_at, icon: "👤" },
                  { label: "Accepted", time: ride.accepted_at, icon: "✅" },
                  { label: "Arrived", time: ride.arrived_at, icon: "📍" },
                  { label: "Started", time: ride.started_at, icon: "🚀" },
                  { label: "Completed", time: ride.completed_at, icon: "🏁" },
                  { label: "Cancelled", time: ride.cancelled_at, icon: "❌" },
                ]
                  .filter((e) => e.time)
                  .map((event, idx, arr) => (
                    <div key={event.label} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm">
                          {event.icon}
                        </div>
                        {idx < arr.length - 1 && <div className="w-0.5 h-8 bg-gray-200" />}
                      </div>
                      <div className="pb-6">
                        <p className="text-sm font-medium text-gray-900">{event.label}</p>
                        <p className="text-xs text-gray-500">{formatDate(event.time!)}</p>
                      </div>
                    </div>
                  ))}
              </div>
              {ride.cancellation_reason && (
                <div className="mt-4 p-3 bg-red-50 rounded-lg text-sm text-red-700">
                  <strong>Cancellation Reason:</strong> {ride.cancellation_reason}
                </div>
              )}
            </div>
          )}

          {/* ─── PAYMENT TAB ─── */}
          {activeTab === "payment" && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-yellow-50 rounded-lg">
                  <DollarSign className="h-5 w-5 text-yellow-600" />
                </div>
                <h3 className="font-semibold text-gray-900">Payment Breakdown</h3>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-400">Payment Method</p>
                    <p className="text-sm font-medium">{getPaymentMethodLabel(ride.payment_method)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-400">Payment Status</p>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(ride.payment_status)}`}>
                      {ride.payment_status?.toUpperCase() || "N/A"}
                    </span>
                  </div>
                </div>

                <div className="border rounded-lg divide-y">
                  <div className="flex justify-between p-3 text-sm">
                    <span className="text-gray-500">Base Fare</span>
                    <span>{formatCurrency(ride.base_fare || 0)}</span>
                  </div>
                  <div className="flex justify-between p-3 text-sm">
                    <span className="text-gray-500">Distance ({ride.actual_distance_km || ride.estimated_distance_km || 0} km)</span>
                    <span>{formatCurrency(ride.distance_fare || 0)}</span>
                  </div>
                  <div className="flex justify-between p-3 text-sm">
                    <span className="text-gray-500">Time ({ride.actual_duration_minutes || ride.estimated_duration_minutes || 0} min)</span>
                    <span>{formatCurrency(ride.time_fare || 0)}</span>
                  </div>
                  {ride.waiting_fee ? (
                    <div className="flex justify-between p-3 text-sm">
                      <span className="text-gray-500">Waiting Fee</span>
                      <span>{formatCurrency(ride.waiting_fee)}</span>
                    </div>
                  ) : null}
                  {ride.cancellation_fee ? (
                    <div className="flex justify-between p-3 text-sm">
                      <span className="text-gray-500">Cancellation Fee</span>
                      <span>{formatCurrency(ride.cancellation_fee)}</span>
                    </div>
                  ) : null}
                  {ride.promo_discount ? (
                    <div className="flex justify-between p-3 text-sm">
                      <span className="text-green-600">Promo Discount</span>
                      <span className="text-green-600">-{formatCurrency(ride.promo_discount)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between p-3 text-sm font-semibold bg-gray-50">
                    <span>Total Fare</span>
                    <span>{formatCurrency(ride.actual_fare || ride.estimated_fare || 0)}</span>
                  </div>
                  {(() => {
                    const totalFare = ride.actual_fare || ride.estimated_fare || 0;
                    const hasLedgerData = ride.company_commission != null || ride.commission_amount != null || ride.driver_earnings != null;
                    const commission = ride.company_commission ?? ride.commission_amount ?? Math.round(totalFare * 0.15);
                    const earnings = ride.driver_earnings ?? Math.round(totalFare - commission);
                    return (
                      <>
                        <div className="flex justify-between p-3 text-sm text-green-700 bg-green-50">
                          <span>
                            Commission (platform){!hasLedgerData && <span className="text-xs text-gray-400"> (estimated)</span>}
                          </span>
                          <span>-{formatCurrency(commission)}</span>
                        </div>
                        <div className="flex justify-between p-3 text-sm font-semibold text-blue-700 bg-blue-50">
                          <span>
                            Driver Earnings{!hasLedgerData && <span className="text-xs text-gray-400"> (estimated)</span>}
                          </span>
                          <span>{formatCurrency(earnings)}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>

                {ride.payment_method === "cash" && (ride.cash_received != null) && (
                  <div className="border rounded-lg divide-y mt-4">
                    <div className="p-3 text-xs font-medium text-gray-400 uppercase bg-gray-50">Cash Collection</div>
                    <div className="flex justify-between p-3 text-sm">
                      <span className="text-gray-500">Cash Received</span>
                      <span className="font-medium">{formatCurrency(ride.cash_received || 0)}</span>
                    </div>
                    {(ride.change_amount ?? 0) > 0 && (
                      <div className="flex justify-between p-3 text-sm">
                        <span className="text-gray-500">Change Given</span>
                        <span>{formatCurrency(ride.change_amount || 0)}</span>
                      </div>
                    )}
                    {(ride.rider_credit_amount ?? 0) > 0 && (
                      <div className="flex justify-between p-3 text-sm text-blue-700 bg-blue-50">
                        <span>Added to Rider Credit</span>
                        <span>{formatCurrency(ride.rider_credit_amount || 0)}</span>
                      </div>
                    )}
                    {(ride.cash_outstanding_amount ?? 0) > 0 && (
                      <div className="flex justify-between p-3 text-sm text-amber-700 bg-amber-50">
                        <span>Still Owed by Rider</span>
                        <span>{formatCurrency(ride.cash_outstanding_amount || 0)}</span>
                      </div>
                    )}
                    <div className="flex justify-between p-3 text-sm">
                      <span className="text-gray-500">Driver Settlement</span>
                      <span className="capitalize">{ride.settlement_status?.replace(/_/g, " ") || "not required"}</span>
                    </div>
                    {ride.cash_confirmed_at && (
                      <div className="flex justify-between p-3 text-sm">
                        <span className="text-gray-500">Confirmed At</span>
                        <span>{new Date(ride.cash_confirmed_at).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── PLAYBACK TAB ─── */}
          {activeTab === "playback" && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-indigo-50 rounded-lg">
                  <Navigation2 className="h-5 w-5 text-indigo-600" />
                </div>
                <h3 className="font-semibold text-gray-900">Route Playback</h3>
              </div>
              <div className="bg-gray-50 rounded-lg h-80 flex items-center justify-center border-2 border-dashed border-gray-200">
                <div className="text-center">
                  <MapPin className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500 font-medium">Map View</p>
                  <p className="text-xs text-gray-400 mt-1">Route from pickup to dropoff will display here</p>
                  <div className="mt-4 flex items-center justify-center gap-4 text-xs text-gray-500">
                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500" /> Pickup</div>
                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500" /> Dropoff</div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-4">
                <button className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
                  <Play className="h-4 w-4" /> Play Route
                </button>
                <button className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">
                  <Pause className="h-4 w-4" /> Pause
                </button>
                <span className="text-xs text-gray-400">Full route replay (requires location tracking data)</span>
              </div>
            </div>
          )}

          {/* ─── SUPPORT TAB ─── */}
          {activeTab === "support" && (
            <>
              {/* Complaints */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-red-50 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Complaints & Issues</h3>
                </div>
                {complaints.length > 0 ? (
                  <div className="space-y-3">
                    {complaints.map((c) => (
                      <div key={c.id} className="border rounded-lg p-3 text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium capitalize">{c.type.replace(/_/g, " ")}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            c.status === "open" ? "bg-yellow-100 text-yellow-700" :
                            c.status === "resolved" ? "bg-green-100 text-green-700" :
                            "bg-gray-100 text-gray-600"
                          }`}>{c.status}</span>
                        </div>
                        <p className="text-gray-600">{c.description}</p>
                        <p className="text-xs text-gray-400 mt-1">{formatDate(c.created_at)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No complaints reported for this ride.</p>
                )}
              </div>

              {/* Admin Notes */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <FileText className="h-5 w-5 text-blue-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Admin Notes</h3>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Add an internal note about this ride..."
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <button
                    onClick={handleSaveNote}
                    disabled={!adminNote.trim() || savingNote}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    {savingNote ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ─── AUDIT TAB ─── */}
          {activeTab === "audit" && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-gray-50 rounded-lg">
                  <Shield className="h-5 w-5 text-gray-600" />
                </div>
                <h3 className="font-semibold text-gray-900">Audit Trail</h3>
              </div>
              {auditLogs.length > 0 ? (
                <div className="space-y-2">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="flex items-start gap-3 text-sm border-b border-gray-50 pb-2">
                      <div className="w-2 h-2 rounded-full bg-gray-300 mt-1.5" />
                      <div className="flex-1">
                        <p className="text-gray-700">
                          <span className="font-medium capitalize">{log.action.replace(/_/g, " ")}</span>
                          <span className="text-gray-400"> by {log.actor}</span>
                        </p>
                        <p className="text-xs text-gray-400">{formatDate(log.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">No audit entries for this ride yet.</p>
              )}
            </div>
          )}
        </div>

        {/* Sidebar — Actions & Quick Stats */}
        <div className="space-y-6">
          {/* Quick Stats */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Quick Stats</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Status</span>
                <span className={`font-medium ${getStatusColor(ride.status)}`}>{getRideStatusLabel(ride.status)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Payment</span>
                <span className="font-medium">{getPaymentMethodLabel(ride.payment_method)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Category</span>
                <span className="font-medium">{categoryObj?.name || "N/A"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Distance</span>
                <span className="font-medium">{ride.actual_distance_km || ride.estimated_distance_km || 0} km</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Duration</span>
                <span className="font-medium">{ride.actual_duration_minutes || ride.estimated_duration_minutes || 0} min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Fare</span>
                <span className="font-medium">{formatCurrency(ride.actual_fare || ride.estimated_fare || 0)}</span>
              </div>
            </div>
          </div>

          {/* Admin Actions */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Actions</h3>
            <div className="space-y-3">
              {!["completed", "cancelled", "admin_cancelled"].includes(ride.status) && (
                <button
                  onClick={handleCancelRide}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
                >
                  <XCircle className="h-4 w-4" /> Cancel Ride
                </button>
              )}
              {ride.payment_status === "paid" && ride.status === "completed" && (
                <button
                  onClick={handleRefundRide}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700"
                >
                  <DollarSign className="h-4 w-4" /> Process Refund
                </button>
              )}
              <button
                onClick={() => setActiveTab("support")}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                <HeadphonesIcon className="h-4 w-4" /> View Support
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}