"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import {
  RefreshCw,
  Search,
  ChevronDown,
  Eye,
  X,
  FileText,
  IdCard,
  Car,
  Shield,
  Camera,
  User,
} from "lucide-react";

// Matches drivers_approval_status_check on the drivers table exactly —
// there is no "pending" or "changes_required" value in the real schema.
type ApprovalStatus =
  | "pending_verification"
  | "approved_driver"
  | "pending_vehicle_review"
  | "approved"
  | "rejected"
  | "suspended";

interface OnboardingDriver {
  id: string;
  firebase_uid: string;
  full_name: string;
  email: string;
  phone: string;
  driver_type: string;
  city: string;
  address: string;
  approval_status: ApprovalStatus;
  rejection_reason: string | null;
  created_at: string;
  submitted_at: string | null;

  // Document URLs
  id_document_url: string | null;
  license_document_url: string | null;
  vehicle_registration_url: string | null;
  insurance_document_url: string | null;
  profile_picture_url: string | null;
  vehicle_photo_urls: string[] | null;

  // Vehicle info
  vehicle_plate: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: string | null;
  vehicle_color: string | null;
  vehicle_photo_front_url: string | null;
  vehicle_photo_back_url: string | null;
  vehicle_photo_side_url: string | null;
  vehicle_photo_interior_url: string | null;

  // Fleet driver
  driving_experience_years: number | null;
  employment_type: string | null;
  preferred_vehicle_type: string | null;

  // Emergency contact
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;

  // Identity
  national_id: string | null;
  license_number: string | null;
  id_verified: boolean;
  license_verified: boolean;
  date_of_birth: string | null;

  // Payment
  payout_method: string | null;
  mobile_money_number: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
}

const STATUS_FILTERS: { value: ApprovalStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending_verification", label: "Pending Identity" },
  { value: "approved_driver", label: "Needs Vehicle" },
  { value: "pending_vehicle_review", label: "Pending Vehicle" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "suspended", label: "Suspended" },
];

const STATUS_COLORS: Record<string, string> = {
  pending_verification: "bg-amber-100 text-amber-700",
  approved_driver: "bg-blue-100 text-blue-700",
  pending_vehicle_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  suspended: "bg-gray-200 text-gray-700",
};

// Stages where an admin action (approve/reject) is actually expected.
const ACTIONABLE_STAGES: ApprovalStatus[] = ["pending_verification", "pending_vehicle_review"];

export default function OnboardingPage() {
  return (
    <PermissionGuard any={["approve_drivers", "manage_drivers"]}>
      <OnboardingContent />
    </PermissionGuard>
  );
}

function OnboardingContent() {
  const [drivers, setDrivers] = useState<OnboardingDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<ApprovalStatus | "all">("pending_verification");
  const [search, setSearch] = useState("");
  const [selectedDriver, setSelectedDriver] = useState<OnboardingDriver | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchDrivers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Use admin_list_drivers RPC for proper user + vehicle JOINs
      const { data, error: err } = await supabase.rpc("admin_list_drivers", {
        p_page: 1,
        p_page_size: 100,
        p_search: search || "",
        p_approval_status: selectedStatus === "all" ? "" : selectedStatus,
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
          full_name: user.full_name || "Unknown",
          email: user.email || "",
          phone: user.phone || "",
          driver_type: d.driver_type || "own_vehicle",
          city: d.city || "",
          address: d.address || "",
          approval_status: d.approval_status || "pending_verification",
          rejection_reason: d.rejection_reason || null,
          created_at: d.created_at,
          submitted_at: d.submitted_at || null,
          id_document_url: d.id_document_url || null,
          license_document_url: d.license_document_url || null,
          vehicle_registration_url: d.vehicle_registration_url || null,
          insurance_document_url: d.insurance_document_url || null,
          profile_picture_url: d.profile_picture_url || null,
          vehicle_photo_urls: d.vehicle_photo_urls || null,
          vehicle_plate: vehicle.plate_number || d.vehicle_plate || null,
          vehicle_make: vehicle.make || d.vehicle_make || null,
          vehicle_model: vehicle.model || d.vehicle_model || null,
          vehicle_year: vehicle.year ? String(vehicle.year) : null,
          vehicle_color: vehicle.color || d.vehicle_color || null,
          vehicle_photo_front_url: vehicle.photo_front_url || null,
          vehicle_photo_back_url: vehicle.photo_back_url || null,
          vehicle_photo_side_url: vehicle.photo_side_url || null,
          vehicle_photo_interior_url: vehicle.photo_interior_url || null,
          driving_experience_years: d.driving_experience_years || null,
          employment_type: d.employment_type || null,
          preferred_vehicle_type: d.preferred_vehicle_type || null,
          emergency_contact_name: d.emergency_contact_name || null,
          emergency_contact_phone: d.emergency_contact_phone || null,
          national_id: d.national_id || null,
          license_number: d.license_number || d.driver_license_number || null,
          id_verified: d.id_verified === true,
          license_verified: d.license_verified === true,
          date_of_birth: d.date_of_birth || null,
          payout_method: null, // fetched from wallet below
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
  }, [selectedStatus, search]);

  useEffect(() => {
    fetchDrivers();
  }, [fetchDrivers]);

  const handleApprove = async (driver: OnboardingDriver) => {
    setActionLoading(driver.id);
    try {
      // admin_approve_driver is stage-aware: pending_verification -> approved_driver
      // (identity approved, still needs vehicle), pending_vehicle_review -> approved
      // (fully approved). Never force-sets "approved" directly.
      const { data, error: err } = await supabase
        .rpc("admin_approve_driver", { p_driver_id: driver.id })
        .single();
      if (err) throw new Error(err.message);
      const result = data as { success?: boolean; error?: string } | null;
      if (result?.success === false) throw new Error(result.error || "Approval failed");
      fetchDrivers();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setActionLoading(null);
    }
  };

  // Admin-editable fallback for drivers who applied before the driver-app
  // collected date_of_birth (or who never went through onboarding there at
  // all) — also required by validate_driver_approval before final approval.
  const handleUpdateDateOfBirth = async (driver: OnboardingDriver, value: string) => {
    setActionLoading(driver.id);
    try {
      const { error: err } = await supabase
        .from("drivers")
        .update({ date_of_birth: value || null })
        .eq("id", driver.id);
      if (err) throw new Error(err.message);
      setDrivers((prev) => prev.map((d) => (d.id === driver.id ? { ...d, date_of_birth: value || null } : d)));
      setSelectedDriver((prev) => (prev && prev.id === driver.id ? { ...prev, date_of_birth: value || null } : prev));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update date of birth");
    } finally {
      setActionLoading(null);
    }
  };

  // Sets id_verified/license_verified once an admin has actually checked the
  // document against the driver's stated details — required by the
  // validate_driver_approval DB trigger before final approval is allowed.
  const handleToggleVerification = async (
    driver: OnboardingDriver,
    field: "id_verified" | "license_verified",
    value: boolean
  ) => {
    setActionLoading(driver.id);
    try {
      const { error: err } = await supabase.from("drivers").update({ [field]: value }).eq("id", driver.id);
      if (err) throw new Error(err.message);
      setDrivers((prev) => prev.map((d) => (d.id === driver.id ? { ...d, [field]: value } : d)));
      setSelectedDriver((prev) => (prev && prev.id === driver.id ? { ...prev, [field]: value } : prev));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update verification");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (driver: OnboardingDriver) => {
    if (!rejectReason.trim()) {
      alert("Please enter a rejection reason");
      return;
    }
    setActionLoading(driver.id);
    try {
      const { data, error: err } = await supabase
        .rpc("admin_reject_driver", { p_driver_id: driver.id, p_reason: rejectReason.trim() })
        .single();
      if (err) throw new Error(err.message);
      const result = data as { success?: boolean; error?: string } | null;
      if (result?.success === false) throw new Error(result.error || "Rejection failed");
      setRejectReason("");
      setSelectedDriver(null);
      fetchDrivers();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Rejection failed");
    } finally {
      setActionLoading(null);
    }
  };

  const counts = STATUS_FILTERS.filter((s) => s.value !== "all").reduce(
    (acc, stage) => {
      acc[stage.value] = drivers.filter((d) => d.approval_status === stage.value).length;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Driver Onboarding</h1>
          <p className="text-sm text-gray-500 mt-1">Review and process driver applications</p>
        </div>
        <button
          onClick={fetchDrivers}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Pipeline stages */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Onboarding Pipeline</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedStatus("all")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${
              selectedStatus === "all" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            All ({drivers.length})
          </button>
          {STATUS_FILTERS.filter((s) => s.value !== "all").map((stage) => (
            <button
              key={stage.value}
              onClick={() => setSelectedStatus(stage.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                selectedStatus === stage.value
                  ? "bg-green-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {stage.label} ({counts[stage.value] || 0})
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
          ) : drivers.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No drivers found</div>
          ) : (
            drivers.map((d) => (
              <div key={d.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{d.full_name}</p>
                      <span className="text-xs text-gray-400">{d.driver_type === "own_vehicle" ? "Own Vehicle" : "Fleet"}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-gray-500">{d.email}</span>
                      {d.phone && <span className="text-xs text-gray-400">{d.phone}</span>}
                      {d.national_id && <span className="text-xs text-gray-400">ID: {d.national_id}</span>}
                    </div>
                    <div className="flex items-center gap-4 mt-1">
                      {d.city && <span className="text-xs text-gray-400">📍 {d.city}</span>}
                      {d.submitted_at && (
                        <span className="text-xs text-gray-400">
                          Submitted: {new Date(d.submitted_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {/* Document indicators */}
                    <div className="flex items-center gap-2 mt-2">
                      {d.id_document_url && (
                        <a href={d.id_document_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-0.5 rounded">
                          <IdCard className="h-3 w-3" /> ID
                        </a>
                      )}
                      {d.license_document_url && (
                        <a href={d.license_document_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-0.5 rounded">
                          <FileText className="h-3 w-3" /> License
                        </a>
                      )}
                      {d.profile_picture_url && (
                        <a href={d.profile_picture_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-0.5 rounded">
                          <User className="h-3 w-3" /> Photo
                        </a>
                      )}
                      {d.vehicle_registration_url && (
                        <a href={d.vehicle_registration_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-0.5 rounded">
                          <Car className="h-3 w-3" /> Reg
                        </a>
                      )}
                      {d.insurance_document_url && (
                        <a href={d.insurance_document_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-0.5 rounded">
                          <Shield className="h-3 w-3" /> Insurance
                        </a>
                      )}
                      {d.vehicle_photo_urls && d.vehicle_photo_urls.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                          <Camera className="h-3 w-3" /> {d.vehicle_photo_urls.length} photos
                        </span>
                      )}
                    </div>
                    {/* Rejection reason */}
                    {d.rejection_reason && (
                      <p className="text-xs text-red-600 mt-1 bg-red-50 px-2 py-1 rounded">Reason: {d.rejection_reason}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[d.approval_status] || "bg-gray-100 text-gray-700"}`}>
                      {d.approval_status.replace("_", " ")}
                    </span>
                    {/* View details */}
                    <button
                      onClick={() => setSelectedDriver(d)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                      title="View details"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    {/* Quick approve */}
                    {ACTIONABLE_STAGES.includes(d.approval_status) && (
                      <button
                        onClick={() => handleApprove(d)}
                        disabled={actionLoading === d.id}
                        className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 disabled:opacity-50"
                      >
                        {actionLoading === d.id ? "..." : "Approve"}
                      </button>
                    )}
                    {/* Quick reject button opens reason input */}
                    {ACTIONABLE_STAGES.includes(d.approval_status) && (
                      <button
                        onClick={() => { setSelectedDriver(d); setRejectReason(""); }}
                        className="px-3 py-1.5 bg-red-100 text-red-700 text-xs rounded-lg hover:bg-red-200"
                      >
                        Reject
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* DETAIL MODAL */}
      {selectedDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-bold text-gray-900">{selectedDriver.full_name}</h2>
              <button onClick={() => setSelectedDriver(null)} className="p-1 hover:bg-gray-100 rounded">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Basic Info */}
              <Section title="Basic Information">
                <InfoRow label="Email" value={selectedDriver.email} />
                <InfoRow label="Phone" value={selectedDriver.phone || "—"} />
                <InfoRow label="Driver Type" value={selectedDriver.driver_type === "own_vehicle" ? "Own Vehicle" : "Fleet Driver"} />
                <InfoRow label="City" value={selectedDriver.city || "—"} />
                <InfoRow label="Address" value={selectedDriver.address || "—"} />
                <InfoRow label="Status" value={selectedDriver.approval_status} />
                <div className="flex items-center text-sm">
                  <span className="w-32 text-gray-500 shrink-0">Date of Birth</span>
                  <input
                    type="date"
                    defaultValue={selectedDriver.date_of_birth ?? ""}
                    disabled={actionLoading === selectedDriver.id}
                    onBlur={(e) => {
                      if (e.target.value !== (selectedDriver.date_of_birth ?? "")) {
                        handleUpdateDateOfBirth(selectedDriver, e.target.value);
                      }
                    }}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                {selectedDriver.submitted_at && (
                  <InfoRow label="Submitted" value={new Date(selectedDriver.submitted_at).toLocaleString()} />
                )}
              </Section>

              {/* Identity Documents */}
              <Section title="Identity & Documents">
                <InfoRow label="National ID" value={selectedDriver.national_id || "—"} />
                <DocLink label="ID Photo" url={selectedDriver.id_document_url} />
                <VerifyToggle
                  label="ID verified"
                  checked={selectedDriver.id_verified}
                  disabled={actionLoading === selectedDriver.id}
                  onChange={(v) => handleToggleVerification(selectedDriver, "id_verified", v)}
                />
                <InfoRow label="License Number" value={selectedDriver.license_number || "—"} />
                <DocLink label="License Photo" url={selectedDriver.license_document_url} />
                <VerifyToggle
                  label="License verified"
                  checked={selectedDriver.license_verified}
                  disabled={actionLoading === selectedDriver.id}
                  onChange={(v) => handleToggleVerification(selectedDriver, "license_verified", v)}
                />
                <DocLink label="Profile Photo" url={selectedDriver.profile_picture_url} />
              </Section>

              {/* Vehicle (own vehicle drivers) */}
              {selectedDriver.driver_type === "own_vehicle" && (
                <Section title="Vehicle">
                  <InfoRow label="Plate" value={selectedDriver.vehicle_plate || "—"} />
                  <InfoRow label="Make / Model" value={selectedDriver.vehicle_make && selectedDriver.vehicle_model ? `${selectedDriver.vehicle_make} ${selectedDriver.vehicle_model}` : "—"} />
                  <InfoRow label="Year" value={selectedDriver.vehicle_year || "—"} />
                  <InfoRow label="Color" value={selectedDriver.vehicle_color || "—"} />
                  <DocLink label="Vehicle Registration" url={selectedDriver.vehicle_registration_url} />
                  <DocLink label="Insurance" url={selectedDriver.insurance_document_url} />
                  <DocLink label="Photo: Front" url={selectedDriver.vehicle_photo_front_url} />
                  <DocLink label="Photo: Back" url={selectedDriver.vehicle_photo_back_url} />
                  <DocLink label="Photo: Side" url={selectedDriver.vehicle_photo_side_url} />
                  <DocLink label="Photo: Interior" url={selectedDriver.vehicle_photo_interior_url} />
                  {selectedDriver.vehicle_photo_urls && selectedDriver.vehicle_photo_urls.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Vehicle Photos:</p>
                      <div className="flex flex-wrap gap-2">
                        {selectedDriver.vehicle_photo_urls.map((url, idx) => (
                          <a key={idx} href={url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 underline">
                            <Camera className="h-3 w-3" /> Photo {idx + 1}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </Section>
              )}

              {/* Fleet driver info */}
              {selectedDriver.driver_type === "fleet" && (
                <Section title="Fleet Driver Preferences">
                  <InfoRow label="Driving Experience" value={selectedDriver.driving_experience_years ? `${selectedDriver.driving_experience_years} years` : "—"} />
                  <InfoRow label="Availability" value={selectedDriver.employment_type === "full_time" ? "Full Time" : selectedDriver.employment_type === "part_time" ? "Part Time" : "—"} />
                  <InfoRow label="Preferred Vehicle" value={selectedDriver.preferred_vehicle_type || "—"} />
                </Section>
              )}

              {/* Emergency Contact */}
              <Section title="Emergency Contact">
                <InfoRow label="Name" value={selectedDriver.emergency_contact_name || "—"} />
                <InfoRow label="Phone" value={selectedDriver.emergency_contact_phone || "—"} />
              </Section>

              {/* Rejection reason + actions */}
              {ACTIONABLE_STAGES.includes(selectedDriver.approval_status) && (
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-gray-700">
                    Rejection Reason {rejectReason ? null : <span className="text-gray-400">(required for reject)</span>}
                  </label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Enter reason for rejection..."
                    rows={2}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprove(selectedDriver)}
                      disabled={actionLoading === selectedDriver.id}
                      className="flex-1 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      {actionLoading === selectedDriver.id ? "Processing..." : "✅ Approve"}
                    </button>
                    <button
                      onClick={() => handleReject(selectedDriver)}
                      disabled={actionLoading === selectedDriver.id}
                      className="flex-1 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
                    >
                      {actionLoading === selectedDriver.id ? "Processing..." : "❌ Reject"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-2 border-b pb-1">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex text-sm">
      <span className="w-32 text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-800">{value}</span>
    </div>
  );
}

function VerifyToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
      />
      <span className={checked ? "text-green-700 font-medium" : "text-gray-500"}>{label}</span>
    </label>
  );
}

function DocLink({ label, url }: { label: string; url: string | null }) {
  if (!url) return null;
  const isImage = /\.(jpg|jpeg|png|webp|gif)/i.test(url);
  return (
    <div className="flex text-sm items-center gap-2">
      <span className="w-32 text-gray-500 shrink-0">{label}</span>
      <a href={url} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 underline text-xs">
        <Eye className="h-3 w-3" />
        {isImage ? "View Image" : "Open Document"}
      </a>
    </div>
  );
}