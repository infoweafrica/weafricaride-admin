"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import {
  RefreshCw,
  Search,
  Eye,
  X,
  FileText,
  IdCard,
  Car,
  Shield,
  User,
} from "lucide-react";

// ── Two-Stage Approval Statuses ──
type ApprovalStatus =
  | "pending_verification"
  | "approved_driver"
  | "rejected"
  | "pending_vehicle_review"
  | "approved"
  | "suspended";

// Separate filter sets for Stage 1 (identity) and Stage 2 (vehicle)
const IDENTITY_STATUSES: { value: ApprovalStatus | "all"; label: string }[] = [
  { value: "all", label: "All Identity" },
  { value: "pending_verification", label: "Pending Verification" },
  { value: "approved_driver", label: "Approved (Identity)" },
  { value: "rejected", label: "Rejected" },
];

const VEHICLE_STATUSES: { value: ApprovalStatus | "all"; label: string }[] = [
  { value: "all", label: "All Vehicle" },
  { value: "pending_vehicle_review", label: "Pending Vehicle Review" },
  { value: "approved", label: "Fully Approved" },
];

const STATUS_COLORS: Record<string, string> = {
  pending_verification: "bg-amber-100 text-amber-700",
  approved_driver: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  pending_vehicle_review: "bg-purple-100 text-purple-700",
  approved: "bg-emerald-100 text-emerald-700",
  suspended: "bg-gray-100 text-gray-700",
};

interface OnboardingDriver {
  id: string;
  firebase_uid: string;
  full_name: string;
  email: string;
  phone: string;
  driver_type: string;
  city: string;
  approval_status: ApprovalStatus;
  rejection_reason: string | null;
  created_at: string;
  identity_verified_at: string | null;

  // Stage 1: Identity documents
  id_document_url: string | null;
  license_document_url: string | null;
  police_clearance_url: string | null;
  selfie_url: string | null;
  profile_photo_url: string | null;
  profile_picture_url: string | null;

  // Stage 2: Vehicle
  vehicle_registration_url: string | null;
  insurance_document_url: string | null;
  vehicle_photo_front_url: string | null;
  vehicle_photo_back_url: string | null;
  vehicle_photo_side_url: string | null;
  vehicle_plate: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: string | null;
  vehicle_color: string | null;
  vehicle_category: string | null;

  // Emergency contact
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;

  // Identity numbers
  national_id: string | null;
  license_number: string | null;

  // Payment
  mobile_money_number: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
}

export default function OnboardingPage() {
  return (
    <PermissionGuard any={["approve_drivers", "manage_drivers"]}>
      <OnboardingContent />
    </PermissionGuard>
  );
}

// ── Stage 1 (Identity) missing documents ──
function getStage1Missing(driver: OnboardingDriver): string[] {
  const missing: string[] = [];
  if (!driver.profile_picture_url && !driver.profile_photo_url)
    missing.push("Profile photo");
  if (!driver.id_document_url && !driver.national_id) missing.push("National ID");
  if (!driver.license_document_url && !driver.license_number)
    missing.push("Driver license");
  if (!driver.emergency_contact_name || !driver.emergency_contact_phone)
    missing.push("Emergency contact");
  return missing;
}

// ── Stage 2 (Vehicle) missing documents ──
function getStage2Missing(driver: OnboardingDriver): string[] {
  const missing: string[] = [];
  if (!driver.vehicle_registration_url) missing.push("Vehicle registration");
  if (!driver.insurance_document_url) missing.push("Insurance");
  if (!driver.vehicle_plate) missing.push("Plate number");
  if (!driver.vehicle_make) missing.push("Make");
  if (!driver.vehicle_model) missing.push("Model");
  return missing;
}

function getStageLabel(stage: 1 | 2): string {
  return stage === 1 ? "Identity Verification" : "Vehicle Registration";
}

function OnboardingContent() {
  const [drivers, setDrivers] = useState<OnboardingDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Stage 1 (Identity) filter
  const [identityFilter, setIdentityFilter] = useState<ApprovalStatus | "all">("all");
  // Stage 2 (Vehicle) filter
  const [vehicleFilter, setVehicleFilter] = useState<ApprovalStatus | "all">("all");

  // Which stage tab is active
  const [activeStage, setActiveStage] = useState<1 | 2>(1);

  // Modal state
  const [selectedDriver, setSelectedDriver] = useState<OnboardingDriver | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Active filter based on tab
  const activeFilter =
    activeStage === 1 ? identityFilter : vehicleFilter;

  const fetchDrivers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc("admin_list_drivers", {
        p_page: 1,
        p_page_size: 200,
        p_search: search || "",
        p_approval_status: "",
        p_is_online: null,
        p_city_id: null,
        p_driver_tier: "",
      });

      if (err) throw new Error(err.message);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = data as any;
      const raw = (result?.data || result || []) as any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: OnboardingDriver[] = raw.map((d: any) => {
        const user = d.user || {};
        const vehicle = d.vehicle || {};
        return {
          id: d.id,
          firebase_uid: d.firebase_uid || "",
          full_name: d.full_name || user?.full_name || "Unknown",
          email: user.email || "",
          phone: user.phone || "",
          driver_type: d.driver_type || "own_vehicle",
          city: d.city || "",
          approval_status: d.approval_status || "pending_verification",
          rejection_reason: d.rejection_reason || null,
          created_at: d.created_at,
          identity_verified_at: d.identity_verified_at || null,
          id_document_url: d.id_document_url || null,
          license_document_url: d.driver_license_url || d.license_document_url || null,
          police_clearance_url: d.police_clearance_url || null,
          selfie_url: d.selfie_url || null,
          profile_picture_url: d.profile_picture_url || d.profile_photo_url || null,
          profile_photo_url: d.profile_photo_url || d.profile_picture_url || null,
          vehicle_registration_url: d.vehicle_registration_url || null,
          insurance_document_url: d.insurance_document_url || null,
          vehicle_photo_front_url: vehicle.photo_front_url || null,
          vehicle_photo_back_url: vehicle.photo_back_url || null,
          vehicle_photo_side_url: vehicle.photo_side_url || null,
          vehicle_plate: vehicle.plate_number || d.vehicle_plate || null,
          vehicle_make: vehicle.make || d.vehicle_make || null,
          vehicle_model: vehicle.model || d.vehicle_model || null,
          vehicle_year: vehicle.year ? String(vehicle.year) : null,
          vehicle_color: vehicle.color || d.vehicle_color || null,
          vehicle_category: d.vehicle_category || vehicle.vehicle_type || null,
          emergency_contact_name: d.emergency_contact_name || d.emergency_contact || null,
          emergency_contact_phone: d.emergency_contact_phone || d.emergency_phone || null,
          national_id: d.national_id || d.id_number || null,
          license_number: d.license_number || d.driver_license_number || null,
          mobile_money_number: null,
          bank_name: null,
          bank_account_name: null,
          bank_account_number: null,
        };
      });
      setDrivers(mapped);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load drivers");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchDrivers();
  }, [fetchDrivers]);

  // ── Stage 1: Approve identity ──
  const handleApproveIdentity = async (driver: OnboardingDriver) => {
    const missing = getStage1Missing(driver);
    if (missing.length > 0) {
      alert("Missing: " + missing.join(", "));
      return;
    }
    setActionLoading(driver.id);
    try {
      const { error: err } = await supabase
        .from("drivers")
        .update({
          approval_status: "approved_driver",
          identity_verified_at: new Date().toISOString(),
          documents_verified: true,
          rejection_reason: null,
        })
        .eq("id", driver.id);
      if (err) throw new Error(err.message);
      setSelectedDriver(null);
      fetchDrivers();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setActionLoading(null);
    }
  };

  // ── Stage 2: Approve vehicle → fully approved ──
  const handleApproveVehicle = async (driver: OnboardingDriver) => {
    const missing = getStage2Missing(driver);
    if (missing.length > 0) {
      alert("Missing vehicle: " + missing.join(", "));
      return;
    }
    setActionLoading(driver.id);
    try {
      const { error: err } = await supabase
        .from("drivers")
        .update({
          approval_status: "approved",
          vehicle_verified: true,
          can_go_online: true,
          rejection_reason: null,
        })
        .eq("id", driver.id);
      if (err) throw new Error(err.message);
      setSelectedDriver(null);
      fetchDrivers();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setActionLoading(null);
    }
  };

  // ── Reject (works for both stages) ──
  const handleReject = async (driver: OnboardingDriver) => {
    if (!rejectReason.trim()) {
      alert("Please enter a rejection reason");
      return;
    }
    setActionLoading(driver.id);
    try {
      const { error: err } = await supabase
        .from("drivers")
        .update({
          approval_status: "rejected",
          rejection_reason: rejectReason.trim(),
          documents_verified: false,
          vehicle_verified: false,
          can_go_online: false,
        })
        .eq("id", driver.id);
      if (err) throw new Error(err.message);
      setRejectReason("");
      setSelectedDriver(null);
      fetchDrivers();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Rejection failed");
    } finally {
      setActionLoading(null);
    }
  };

  // ── Filter by stage ──
  const identityStatuses = new Set(IDENTITY_STATUSES.filter(s => s.value !== "all").map(s => s.value));
  const vehicleStatuses = new Set(VEHICLE_STATUSES.filter(s => s.value !== "all").map(s => s.value));

  const filteredDrivers = drivers.filter((d) => {
    // Text search
    if (search) {
      const q = search.toLowerCase();
      const name = (d.full_name || "").toLowerCase();
      const email = (d.email || "").toLowerCase();
      if (!name.includes(q) && !email.includes(q)) return false;
    }
    if (activeStage === 1) {
      if (!identityStatuses.has(d.approval_status) && d.approval_status !== "rejected") return false;
      if (identityFilter !== "all" && d.approval_status !== identityFilter) return false;
    } else {
      if (!vehicleStatuses.has(d.approval_status)) return false;
      if (vehicleFilter !== "all" && d.approval_status !== vehicleFilter) return false;
    }
    return true;
  });

  // Counts for pipeline
  const identityCounts = IDENTITY_STATUSES.filter(s => s.value !== "all").reduce((acc, s) => {
    acc[s.value] = drivers.filter(d => d.approval_status === s.value).length;
    return acc;
  }, {} as Record<string, number>);

  const vehicleCounts = VEHICLE_STATUSES.filter(s => s.value !== "all").reduce((acc, s) => {
    acc[s.value] = drivers.filter(d => d.approval_status === s.value).length;
    return acc;
  }, {} as Record<string, number>);

  const filters = activeStage === 1 ? IDENTITY_STATUSES : VEHICLE_STATUSES;
  const counts = activeStage === 1 ? identityCounts : vehicleCounts;
  const setFilter = activeStage === 1 ? setIdentityFilter : setVehicleFilter;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Driver Onboarding</h1>
          <p className="text-sm text-gray-500 mt-1">
            Stage 1: Identity → Stage 2: Vehicle → Go Online
          </p>
        </div>
        <button
          onClick={fetchDrivers}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Stage Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => { setActiveStage(1); setIdentityFilter("all"); }}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            activeStage === 1
              ? "border-green-600 text-green-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          🛡️ Stage 1: Driver Verification
          <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
            {identityCounts["pending_verification"] || 0} pending
          </span>
        </button>
        <button
          onClick={() => { setActiveStage(2); setVehicleFilter("all"); }}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            activeStage === 2
              ? "border-green-600 text-green-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          🚗 Stage 2: Vehicle Verification
          <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
            {vehicleCounts["pending_vehicle_review"] || 0} pending
          </span>
        </button>
      </div>

      {/* Pipeline filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          {getStageLabel(activeStage)} Pipeline
        </h3>
        <div className="flex flex-wrap gap-2">
          {filters.map((stage) => (
            <button
              key={stage.value}
              onClick={() => setFilter(stage.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                (activeStage === 1 ? identityFilter : vehicleFilter) === stage.value
                  ? "bg-green-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {stage.label} ({stage.value === "all" ? (activeStage === 1
                ? drivers.filter(d => identityStatuses.has(d.approval_status) || d.approval_status === "rejected").length
                : drivers.filter(d => vehicleStatuses.has(d.approval_status)).length)
                : (counts[stage.value] || 0)})
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      {/* Driver list */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="divide-y divide-gray-100">
          {loading ? (
            <div className="p-6 text-center text-sm text-gray-400">Loading drivers...</div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-red-500">{error}</div>
          ) : filteredDrivers.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No drivers found</div>
          ) : (
            filteredDrivers.map((d) => {
              const stage1Missing = activeStage === 1 ? getStage1Missing(d) : [];
              const stage2Missing = activeStage === 2 ? getStage2Missing(d) : [];

              return (
                <div key={d.id} className="px-6 py-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900">{d.full_name}</p>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[d.approval_status] || "bg-gray-100 text-gray-600"}`}>
                          {d.approval_status?.replace(/_/g, " ") || "unknown"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-gray-500">{d.email}</span>
                        <span className="text-xs text-gray-400">{d.phone}</span>
                        <span className="text-xs text-gray-400">{d.city || "—"}</span>
                      </div>
                      {d.rejection_reason && (
                        <p className="text-xs text-red-500 mt-1">
                          Reason: {d.rejection_reason}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* View documents button */}
                      <button
                        onClick={() => setSelectedDriver(d)}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                        title="View documents"
                      >
                        <Eye className="h-4 w-4" />
                      </button>

                      {/* Stage 1: Approve identity */}
                      {activeStage === 1 && d.approval_status === "pending_verification" && (
                        <button
                          onClick={() => handleApproveIdentity(d)}
                          disabled={actionLoading === d.id}
                          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 disabled:opacity-50"
                        >
                          {actionLoading === d.id ? "..." : "Approve Identity"}
                        </button>
                      )}

                      {/* Stage 2: Approve vehicle */}
                      {activeStage === 2 && d.approval_status === "pending_vehicle_review" && (
                        <button
                          onClick={() => handleApproveVehicle(d)}
                          disabled={actionLoading === d.id}
                          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 disabled:opacity-50"
                        >
                          {actionLoading === d.id ? "..." : "Approve Vehicle"}
                        </button>
                      )}

                      {/* Reject button for pending stages */}
                      {(d.approval_status === "pending_verification" || d.approval_status === "pending_vehicle_review") && (
                        <button
                          onClick={() => setSelectedDriver(d)}
                          className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-semibold hover:bg-red-200"
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Missing docs hint */}
                  {activeStage === 1 && stage1Missing.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {stage1Missing.map((m) => (
                        <span key={m} className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded">
                          ⚠ {m}
                        </span>
                      ))}
                    </div>
                  )}
                  {activeStage === 2 && stage2Missing.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {stage2Missing.map((m) => (
                        <span key={m} className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded">
                          ⚠ {m}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Driver Detail Modal ── */}
      {selectedDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">
                {selectedDriver.full_name}
              </h2>
              <button
                onClick={() => { setSelectedDriver(null); setRejectReason(""); }}
                className="p-1 hover:bg-gray-100 rounded-lg"
              >
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            {/* Identity documents */}
            <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <IdCard className="h-4 w-4" /> Stage 1: Identity Documents
            </h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <DocThumb label="Profile Photo" url={selectedDriver.profile_photo_url} />
              <DocThumb label="National ID" url={selectedDriver.id_document_url} />
              <DocThumb label="Driver License" url={selectedDriver.license_document_url} />
              <DocThumb label="Police Clearance" url={selectedDriver.police_clearance_url} />
              <DocThumb label="Selfie" url={selectedDriver.selfie_url} />
            </div>
            <div className="text-xs text-gray-500 mb-4 space-y-1">
              {selectedDriver.national_id && <p>ID Number: {selectedDriver.national_id}</p>}
              {selectedDriver.license_number && <p>License: {selectedDriver.license_number}</p>}
              {selectedDriver.emergency_contact_name && (
                <p>Emergency: {selectedDriver.emergency_contact_name} — {selectedDriver.emergency_contact_phone}</p>
              )}
            </div>

            {/* Vehicle documents */}
            <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <Car className="h-4 w-4" /> Stage 2: Vehicle Documents
            </h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <DocThumb label="Front" url={selectedDriver.vehicle_photo_front_url} />
              <DocThumb label="Back" url={selectedDriver.vehicle_photo_back_url} />
              <DocThumb label="Side" url={selectedDriver.vehicle_photo_side_url} />
              <DocThumb label="Registration" url={selectedDriver.vehicle_registration_url} />
              <DocThumb label="Insurance" url={selectedDriver.insurance_document_url} />
            </div>
            {selectedDriver.vehicle_make && (
              <div className="text-xs text-gray-500 mb-4">
                {selectedDriver.vehicle_make} {selectedDriver.vehicle_model} • {selectedDriver.vehicle_year} • {selectedDriver.vehicle_color} • Plate: {selectedDriver.vehicle_plate}
                {selectedDriver.vehicle_category && <span> • {selectedDriver.vehicle_category}</span>}
              </div>
            )}

            {/* Rejection reason input */}
            <div className="mt-4">
              <label className="text-xs font-semibold text-gray-600">Rejection Reason</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Why is this application being rejected?"
                className="w-full mt-1 p-2 border border-gray-200 rounded-lg text-sm"
                rows={3}
              />
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  if (activeStage === 1) handleApproveIdentity(selectedDriver);
                  else handleApproveVehicle(selectedDriver);
                }}
                disabled={actionLoading === selectedDriver.id}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
              >
                {actionLoading === selectedDriver.id
                  ? "Processing..."
                  : activeStage === 1
                  ? "✅ Approve Identity"
                  : "✅ Approve Vehicle"}
              </button>
              <button
                onClick={() => handleReject(selectedDriver)}
                disabled={actionLoading === selectedDriver.id}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading === selectedDriver.id ? "..." : "❌ Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small document thumbnail ──
function DocThumb({ label, url }: { label: string; url: string | null }) {
  if (!url) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
        <FileText className="h-5 w-5 text-gray-300 mx-auto" />
        <p className="text-xs text-gray-400 mt-1">{label}</p>
        <p className="text-xs text-gray-300">Not uploaded</p>
      </div>
    );
  }
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={label}
        className="w-full h-28 object-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
      <p className="text-xs text-gray-500 text-center py-1">{label}</p>
    </div>
  );
}