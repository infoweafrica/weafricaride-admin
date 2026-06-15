"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { ErrorBoundary, ApiErrorDisplay, EmptyState } from "@/components/ErrorBoundary";
import { useCityContext } from "@/lib/city-context";
import Pagination from "@/components/Pagination";
import { supabase } from "@/lib/supabase";
import {
  Search,
  Eye,
  CheckCircle,
  XCircle,
  X,
  Star,
  Ban,
  Circle,
  Navigation,
  BarChart3,
  Users,
  Shield,
  DollarSign,
  TrendingUp,
  Clock,
  MapPin,
  Phone,
  MessageCircle,
  FileText,
  IdCard,
  Car,
  Camera,
  User,
  Pencil,
  Trash2,
  UserPlus,
} from "lucide-react";
import { formatCurrency, timeAgo, getStatusColor, getApprovalStatusLabel } from "@/lib/utils";
import type { Driver } from "@/lib/types";
import {
  fetchDrivers,
  approveDriver,
  rejectDriver,
  suspendDriver,
  deleteDriver,
  forceDriverOffline,
  fetchTotalDriversCount,
  fetchActiveDriversCount,
  fetchPendingApprovalsCount,
  fetchApprovedDriversCount,
  fetchRejectedDriversCount,
  fetchTopDrivers,
  fetchTopDriversByEarnings,
  fetchDriversOnTripCount,
} from "@/lib/api/drivers";
import type { PaginatedResult } from "@/lib/api/base";

// Dynamically import Leaflet map to avoid SSR issues
const LiveMapView = dynamic(() => import("@/app/admin/operations/live-map/LiveMapView"), {
  ssr: false,
  loading: () => (
    <div className="bg-white rounded-xl border h-[400px] flex items-center justify-center text-gray-400">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"></div>
    </div>
  ),
});

interface DriverLocation {
  id: string;
  driver_id: string;
  driver_name: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  is_online: boolean;
  updated_at: string;
}

type DriverTab = "overview" | "all" | "verification" | "earnings" | "live" | "analytics";

export default function DriversPage() {
  return (
    <ErrorBoundary>
      <DriversContent />
    </ErrorBoundary>
  );
}

function DriversContent() {
  const { selectedCityId, selectedCityName } = useCityContext();
  const [activeTab, setActiveTab] = useState<DriverTab>("overview");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Filters
  const [search, setSearch] = useState("");
  const [approvalFilter, setApprovalFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"online" | "offline" | "all">("all");

  // Data
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<Omit<PaginatedResult<Driver[]>, "data">>({
    page: 1, pageSize: 25, totalCount: 0, totalPages: 0, count: 0, error: null,
  });

  // Stats
  const [totalDrivers, setTotalDrivers] = useState(0);
  const [activeDrivers, setActiveDrivers] = useState(0);
  const [driversOnTrip, setDriversOnTrip] = useState(0);
  const [driversOverdueDocs, setDriversOverdueDocs] = useState(0);
  const [avgRating, setAvgRating] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [approvedCount, setApprovedCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [topDrivers, setTopDrivers] = useState<Driver[]>([]);
  const [topEarners, setTopEarners] = useState<Driver[]>([]);

  // Modal
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showSuspend, setShowSuspend] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Edit form state
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCanGoOnline, setEditCanGoOnline] = useState(false);
  const [editPlateNumber, setEditPlateNumber] = useState("");
  const [editVehicleMake, setEditVehicleMake] = useState("");
  const [editVehicleModel, setEditVehicleModel] = useState("");
  const [editVehicleYear, setEditVehicleYear] = useState("");
  const [editVehicleColor, setEditVehicleColor] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null);
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null);
  const [editCurrentAvatar, setEditCurrentAvatar] = useState<string | null>(null);
  const [editUploading, setEditUploading] = useState(false);
  const [editLicenseFile, setEditLicenseFile] = useState<File | null>(null);
  const [editVehicleRegFile, setEditVehicleRegFile] = useState<File | null>(null);
  const [editInsuranceFile, setEditInsuranceFile] = useState<File | null>(null);

  // Detail sub-tab
  const [detailTab, setDetailTab] = useState<"details" | "documents" | "rides" | "wallet">("details");

  // Add Driver form
  const [newDriverName, setNewDriverName] = useState("");
  const [newDriverEmail, setNewDriverEmail] = useState("");
  const [newDriverPhone, setNewDriverPhone] = useState("");
  const [newDriverPassword, setNewDriverPassword] = useState("");
  const [newDriverPlate, setNewDriverPlate] = useState("");
  const [newDriverMake, setNewDriverMake] = useState("");
  const [newDriverModel, setNewDriverModel] = useState("");
  const [newDriverYear, setNewDriverYear] = useState(new Date().getFullYear().toString());
  const [newDriverColor, setNewDriverColor] = useState("White");
  const [newDriverType, setNewDriverType] = useState("economy");
  const [addDriverLoading, setAddDriverLoading] = useState(false);
  const [addDriverError, setAddDriverError] = useState<string | null>(null);

  const handleAddDriver = async () => {
    if (!newDriverName.trim() || !newDriverPhone.trim()) return;
    setAddDriverLoading(true);
    setAddDriverError(null);
    try {
      // 1. Create user in users table (no Firebase auth needed for admin-created drivers)
      const { data: userData, error: userErr } = await supabase
        .from("users")
        .insert({
          full_name: newDriverName.trim(),
          email: newDriverEmail.trim() || null,
          phone: newDriverPhone.trim(),
          is_active: true,
        })
        .select("id")
        .single();

      if (userErr) throw new Error("Failed to create user: " + userErr.message);
      const userId = userData.id;

      // 2. Create driver record
      const { data: driverData, error: driverErr } = await supabase
        .from("drivers")
        .insert({
          user_id: userId,
          approval_status: "approved",
          is_online: false,
          is_approved: true,
          can_go_online: true,
          driver_tier: "starter",
          total_rides: 0,
          total_earnings: 0,
          rating: 5.0,
        })
        .select("id")
        .single();

      if (driverErr) throw new Error("Failed to create driver: " + driverErr.message);
      const driverId = driverData.id;

      // 3. Create vehicle if plate provided
      if (newDriverPlate.trim()) {
        const { data: vehicleData, error: vehicleErr } = await supabase
          .from("vehicles")
          .insert({
            driver_id: driverId,
            vehicle_type: newDriverType,
            plate_number: newDriverPlate.trim(),
            make: newDriverMake.trim() || null,
            model: newDriverModel.trim() || null,
            year: parseInt(newDriverYear) || new Date().getFullYear(),
            color: newDriverColor,
            is_active: true,
          })
          .select("id")
          .single();

        if (vehicleErr) throw new Error("Failed to create vehicle: " + vehicleErr.message);

        // Link vehicle to driver
        await supabase.from("drivers").update({ vehicle_id: vehicleData.id }).eq("id", driverId);
      }

      // 4. Create driver wallet
      await supabase.from("driver_wallets").insert({
        driver_id: driverId,
        available_balance: 0,
        pending_balance: 0,
        cash_collected: 0,
        total_earned: 0,
      });

      setShowAddDriver(false);
      resetAddDriverForm();
      loadData();
    } catch (e: any) {
      setAddDriverError(e?.message || "Failed to add driver");
    } finally {
      setAddDriverLoading(false);
    }
  };

  const resetAddDriverForm = () => {
    setNewDriverName(""); setNewDriverEmail(""); setNewDriverPhone("");
    setNewDriverPassword(""); setNewDriverPlate(""); setNewDriverMake("");
    setNewDriverModel(""); setNewDriverYear(new Date().getFullYear().toString());
    setNewDriverColor("White"); setNewDriverType("economy");
    setAddDriverError(null);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cityFilter = selectedCityId || undefined;

      // Map filter values for the API
      const approvalStatusProp = approvalFilter === "all" ? "" : approvalFilter;
      const isOnlineProp = statusFilter === "all" ? undefined : statusFilter === "online";

      const [stats, realtimeStats, driversResult] = await Promise.all([
        Promise.all([
          fetchTotalDriversCount(cityFilter),
          fetchActiveDriversCount(cityFilter),
          fetchPendingApprovalsCount(),
          fetchApprovedDriversCount(),
          fetchRejectedDriversCount(),
          fetchTopDrivers(10),
          fetchTopDriversByEarnings(10),
        ]),
        Promise.all([
          fetchDriversOnTripCount(),
        ]),
        activeTab === "all"
          ? fetchDrivers(page, pageSize, {
              cityId: cityFilter,
              search,
              approvalStatus: approvalStatusProp,
              isOnline: isOnlineProp,
            })
          : fetchDrivers(1, 10),
      ]);

      const [total, active, pending, approved, rejected, top, topEarn] = stats;
      const [onTrip] = realtimeStats;
      setTotalDrivers(total);
      setActiveDrivers(active);
      setDriversOnTrip(onTrip);
      setPendingCount(pending);
      setApprovedCount(approved);
      setRejectedCount(rejected);
      setTopDrivers(top);
      setTopEarners(topEarn);

      if (driversResult.error) {
        setError(driversResult.error);
        setDrivers([]);
      } else {
        setDrivers(driversResult.data || []);
        setPagination({
          page: driversResult.page,
          pageSize: driversResult.pageSize,
          totalCount: driversResult.totalCount,
          totalPages: driversResult.totalPages,
          count: driversResult.count,
          error: driversResult.error,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load drivers");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, approvalFilter, statusFilter, activeTab, selectedCityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => { setPage(1); }, [approvalFilter, statusFilter, search]);

  const handleApprove = async (driverId: string) => {
    setActionLoading(driverId);
    if (await approveDriver(driverId)) loadData();
    setActionLoading(null);
  };

  const handleReject = async () => {
    if (!selectedDriver) return;
    setActionLoading(selectedDriver.id);
    if (await rejectDriver(selectedDriver.id, rejectReason)) {
      loadData();
      setShowReject(false);
      setRejectReason("");
    }
    setActionLoading(null);
  };

  const handleSuspend = async () => {
    if (!selectedDriver) return;
    setActionLoading(selectedDriver.id);
    if (await suspendDriver(selectedDriver.id, suspendReason)) {
      loadData();
      setShowSuspend(false);
      setSuspendReason("");
    }
    setActionLoading(null);
  };

  const handleForceOffline = async (driverId: string) => {
    setActionLoading(driverId);
    if (await forceDriverOffline(driverId)) loadData();
    setActionLoading(null);
  };

  const openDeleteModal = () => {
    setDeleteConfirmText("");
    setShowDelete(true);
  };

  const handleDelete = async () => {
    if (!selectedDriver || deleteConfirmText !== "DELETE") return;
    setActionLoading(selectedDriver.id);

    try {
      const driverId = selectedDriver.id;
      const userId = selectedDriver.user_id as string;

      // 1. Unlink vehicle (set driver_id to NULL instead of deleting vehicle)
      await supabase.from("vehicles").update({ driver_id: null }).eq("driver_id", driverId);
      // Also unlink from drivers.vehicle_id
      await supabase.from("drivers").update({ vehicle_id: null }).eq("id", driverId);

      // 2. Delete child records
      await supabase.from("driver_locations").delete().eq("driver_id", driverId);
      await supabase.from("driver_wallets").delete().eq("driver_id", driverId);
      await supabase.from("driver_settings").delete().eq("driver_id", driverId);
      await supabase.from("driver_performance").delete().eq("driver_id", driverId);
      await supabase.from("driver_mission_progress").delete().eq("driver_id", driverId);
      await supabase.from("driver_achievement_unlocks").delete().eq("driver_id", driverId);
      await supabase.from("driver_safety_contacts").delete().eq("driver_id", driverId);
      await supabase.from("driver_transactions").delete().eq("driver_id", driverId);
      await supabase.from("driver_payouts").delete().eq("driver_id", driverId);

      // 3. Null-out rides referencing this driver
      await supabase.from("rides").update({ driver_id: null }).eq("driver_id", driverId);

      // 4. Delete driver record
      const { error: delErr } = await supabase.from("drivers").delete().eq("id", driverId);
      if (delErr) { alert("Failed to delete driver: " + delErr.message); setActionLoading(null); return; }

      loadData();
      setShowDelete(false);
      setShowDetail(false);
    } catch (e: any) {
      alert("Error deleting driver: " + (e?.message || e?.toString() || "Unknown error"));
    }
    setActionLoading(null);
  };

  const handleEdit = () => {
    if (!selectedDriver) return;
    const d = selectedDriver;
    setEditFullName(d.user?.full_name || "");
    setEditPhone(d.user?.phone || "");
    setEditEmail(d.user?.email || "");
    setEditAddress(d.address || "");
    setEditCanGoOnline(d.can_go_online || false);
    setEditPlateNumber(d.vehicle?.plate_number || "");
    setEditVehicleMake(d.vehicle?.make || "");
    setEditVehicleModel(d.vehicle?.model || "");
    setEditVehicleYear(String(d.vehicle?.year || ""));
    setEditVehicleColor(d.vehicle?.color || "");
    setEditError(null);
    setEditSuccess(null);
    setEditAvatarFile(null);
    setEditAvatarPreview(null);
    setEditCurrentAvatar(d.avatar_url || d.user?.avatar_url || null);
    setEditUploading(false);
    setEditLicenseFile(null);
    setEditVehicleRegFile(null);
    setEditInsuranceFile(null);
    setShowEdit(true);
  };

  async function handleSaveEdit() {
    if (!selectedDriver) return;
    setEditSaving(true);
    setEditError(null);
    setEditSuccess(null);

    try {
      const driverId = selectedDriver.id;
      const userId = (selectedDriver as unknown as Record<string, unknown>)?.user_id as string || selectedDriver.user_id as string;
      const vehicleId = (selectedDriver as unknown as Record<string, unknown>)?.vehicle_id as string;

      // Upload profile picture if a file was selected
      let avatarUrl = editCurrentAvatar;
      if (editAvatarFile && userId) {
        setEditUploading(true);
        const fileExt = editAvatarFile.name.split('.').pop();
        const filePath = `${userId}/profile.${fileExt}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('driver-profile-photos')
          .upload(filePath, editAvatarFile, { upsert: true, contentType: editAvatarFile.type });

        if (!uploadError && uploadData) {
          const { data: urlData } = supabase.storage
            .from('driver-profile-photos')
            .getPublicUrl(filePath);
          avatarUrl = urlData.publicUrl;
        }
        setEditUploading(false);
      }

      // Upload license document if selected
      let licenseUrl = selectedDriver.license_document_url || null;
      if (editLicenseFile && driverId) {
        const fileExt = editLicenseFile.name.split('.').pop();
        const filePath = `licenses/${driverId}.${fileExt}`;
        const { data: upData, error: upErr } = await supabase.storage
          .from('driver-documents')
          .upload(filePath, editLicenseFile, { upsert: true, contentType: editLicenseFile.type });
        if (!upErr && upData) {
          const { data: urlData } = supabase.storage.from('driver-documents').getPublicUrl(filePath);
          licenseUrl = urlData.publicUrl;
        }
      }

      // Upload vehicle registration if selected
      let vehicleRegUrl = selectedDriver.vehicle_registration_url || null;
      if (editVehicleRegFile && driverId) {
        const fileExt = editVehicleRegFile.name.split('.').pop();
        const filePath = `registrations/${driverId}.${fileExt}`;
        const { data: upData, error: upErr } = await supabase.storage
          .from('driver-documents')
          .upload(filePath, editVehicleRegFile, { upsert: true, contentType: editVehicleRegFile.type });
        if (!upErr && upData) {
          const { data: urlData } = supabase.storage.from('driver-documents').getPublicUrl(filePath);
          vehicleRegUrl = urlData.publicUrl;
        }
      }

      // Upload insurance if selected
      let insuranceUrl = selectedDriver.insurance_document_url || null;
      if (editInsuranceFile && driverId) {
        const fileExt = editInsuranceFile.name.split('.').pop();
        const filePath = `insurance/${driverId}.${fileExt}`;
        const { data: upData, error: upErr } = await supabase.storage
          .from('driver-documents')
          .upload(filePath, editInsuranceFile, { upsert: true, contentType: editInsuranceFile.type });
        if (!upErr && upData) {
          const { data: urlData } = supabase.storage.from('driver-documents').getPublicUrl(filePath);
          insuranceUrl = urlData.publicUrl;
        }
      }

      // Update users table via supabase
      if (userId && (editFullName || editPhone || editEmail)) {
        const updates: Record<string, string> = {};
        if (editFullName) updates.full_name = editFullName;
        if (editPhone) updates.phone = editPhone;
        if (editEmail) updates.email = editEmail;
        updates.updated_at = new Date().toISOString();
        if (avatarUrl) updates.avatar_url = avatarUrl;
        await supabase.from("users").update(updates).eq("id", userId);
      }

      // Update drivers table
      const driverUpdates: Record<string, unknown> = {
        address: editAddress,
        can_go_online: editCanGoOnline,
        updated_at: new Date().toISOString(),
      };
      if (licenseUrl) driverUpdates.license_document_url = licenseUrl;
      if (vehicleRegUrl) driverUpdates.vehicle_registration_url = vehicleRegUrl;
      if (insuranceUrl) driverUpdates.insurance_document_url = insuranceUrl;
      await supabase.from("drivers").update(driverUpdates).eq("id", driverId);

      // Update or create vehicle
      if (editPlateNumber.trim()) {
        if (vehicleId) {
          await supabase.from("vehicles").update({
            plate_number: editPlateNumber,
            make: editVehicleMake,
            model: editVehicleModel,
            year: editVehicleYear ? parseInt(editVehicleYear) : null,
            color: editVehicleColor,
            updated_at: new Date().toISOString(),
          }).eq("id", vehicleId);
        } else {
          const { data: newV } = await supabase.from("vehicles").insert({
            driver_id: driverId,
            vehicle_type: "economy",
            plate_number: editPlateNumber,
            make: editVehicleMake,
            model: editVehicleModel,
            year: editVehicleYear ? parseInt(editVehicleYear) : null,
            color: editVehicleColor,
          }).select("id").single();
          if (newV) {
            await supabase.from("drivers").update({ vehicle_id: newV.id }).eq("id", driverId);
          }
        }
      }

      setEditSuccess("Driver updated successfully");
      loadData();
      setTimeout(() => {
        setShowEdit(false);
        setEditSuccess(null);
      }, 1200);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setEditSaving(false);
    }
  }

  // Live map driver locations from driver_locations table (real-time)
  const [liveLocations, setLiveLocations] = useState<DriverLocation[]>([]);

  const tabs: { id: DriverTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "all", label: "All Drivers", icon: Users },
    { id: "verification", label: "Verification", icon: Shield },
    { id: "earnings", label: "Earnings", icon: DollarSign },
    { id: "live", label: "Live Map", icon: Navigation },
    { id: "analytics", label: "Analytics", icon: TrendingUp },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapDriverLocation = (d: any): DriverLocation => ({
    id: d.id,
    driver_id: d.driver_id,
    driver_name: `Driver ${d.driver_id?.slice(0, 8) || "???"}`,
    latitude: d.latitude,
    longitude: d.longitude,
    heading: d.heading,
    speed: d.speed,
    is_online: d.is_online || false,
    updated_at: d.updated_at,
  });

  // Load live locations on mount + subscribe to real-time
  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const { data } = await supabase
          .from("driver_locations")
          .select("id, driver_id, latitude, longitude, heading, speed, is_online, updated_at")
          .eq("is_online", true)
          .order("updated_at", { ascending: false })
          .limit(200);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped = ((data as any[]) || []).map((d: any) => mapDriverLocation(d));
        // Enrich with driver names from drivers+users table
        const driverIds = [...new Set(mapped.map((d: DriverLocation) => d.driver_id).filter(Boolean))];
        if (driverIds.length > 0) {
          try {
            const { data: driverData } = await supabase
              .from("drivers")
              .select("id, user:users(full_name)")
              .in("id", driverIds);
            const nameMap: Record<string, string> = {};
            (driverData as any[])?.forEach((d: any) => {
              nameMap[d.id] = d.user?.full_name || d.id.slice(0, 8);
            });
            setLiveLocations(mapped.map((d: DriverLocation) => ({
              ...d,
              driver_name: nameMap[d.driver_id] || d.driver_name,
            })));
          } catch {
            setLiveLocations(mapped);
          }
        } else {
          setLiveLocations(mapped);
        }
      } catch {
        // silently ignore
      }
    };

    fetchLocations();

    const channel = supabase
      .channel("drivers_page_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_locations" },
        async (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const newRow = (payload.new as any) || {};
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const oldRow = (payload.eventType === "DELETE" ? (payload.old as any) : null);

          if (payload.eventType === "DELETE") {
            setLiveLocations((prev) => prev.filter((d) => d.id !== oldRow?.id));
            return;
          }

          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const mapped = mapDriverLocation(newRow);
            // Enrich with driver name from DB
            try {
              const { data: driverData } = await supabase
                .from("drivers")
                .select("id, user:users(full_name)")
                .eq("id", mapped.driver_id)
                .maybeSingle();
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const fullName = (driverData as any)?.user?.full_name;
              const enriched = { ...mapped, driver_name: fullName || mapped.driver_name };
              setLiveLocations((prev) => {
                const idx = prev.findIndex((d) => d.id === enriched.id);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = enriched;
                  return copy;
                }
                return [...prev, enriched];
              });
            } catch {
              setLiveLocations((prev) => {
                const idx = prev.findIndex((d) => d.id === mapped.id);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = mapped;
                  return copy;
                }
                return [...prev, mapped];
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also update live locations when drivers change (for name enrichment)
  useEffect(() => {
    if (drivers.length === 0 || liveLocations.length === 0) return;
    const nameMap: Record<string, string> = {};
    drivers.forEach((d) => {
      if (d.id && d.user?.full_name) nameMap[d.id] = d.user.full_name;
    });
    setLiveLocations((prev) =>
      prev.map((loc) => ({
        ...loc,
        driver_name: nameMap[loc.driver_id] || loc.driver_name,
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers]);

  const onlineCount = activeDrivers;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Drivers</h1>
          <p className="text-gray-500 mt-1">
            {selectedCityName === "All Cities"
              ? `${totalDrivers.toLocaleString()} registered drivers`
              : `${totalDrivers.toLocaleString()} drivers in ${selectedCityName}`}
          </p>
        </div>
        <button
          onClick={() => setShowAddDriver(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 shadow-sm shadow-green-200 transition-colors"
        >
          <UserPlus className="h-4 w-4" /> Add Driver
        </button>
      </div>

      <ApiErrorDisplay error={error} onRetry={loadData} />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id ? "border-green-600 text-green-600" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon className="h-4 w-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* ===== OVERVIEW TAB ===== */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <StatBox icon={Users} label="Total Drivers" value={totalDrivers} color="text-blue-600" bg="bg-blue-50" />
            <StatBox icon={Circle} label="Online Now" value={onlineCount} color="text-green-600" bg="bg-green-50" dot="bg-green-500" />
            <StatBox icon={Navigation} label="On Trip" value={driversOnTrip} color="text-cyan-600" bg="bg-cyan-50" />
            <StatBox icon={Clock} label="Pending" value={pendingCount} color="text-amber-600" bg="bg-amber-50" />
            <StatBox icon={Ban} label="Rejected" value={rejectedCount} color="text-red-600" bg="bg-red-50" />
            <StatBox icon={DollarSign} label="Approved" value={approvedCount} color="text-emerald-600" bg="bg-emerald-50" />
            <StatBox icon={Star} label="Avg Rating" value={(drivers.length > 0 ? drivers.reduce((s,d)=>s+(d.rating||0),0)/drivers.length : 0).toFixed(1)} color="text-yellow-600" bg="bg-yellow-50" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border p-5">
              <h3 className="text-sm font-semibold mb-3">Approval Status</h3>
              <ProgressBar label="Approved" value={approvedCount} max={totalDrivers} color="bg-green-500" />
              <ProgressBar label="Pending" value={pendingCount} max={totalDrivers} color="bg-amber-500" />
              <ProgressBar label="Rejected" value={rejectedCount} max={totalDrivers} color="bg-red-500" />
            </div>
            <div className="bg-white rounded-xl border p-5">
              <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
              <div className="space-y-2">
                <button onClick={() => setActiveTab("verification")} className="w-full flex items-center gap-2 px-3 py-2 bg-amber-50 hover:bg-amber-100 rounded-lg text-sm text-amber-700">
                  <Shield className="h-4 w-4" /> {pendingCount} pending verification
                </button>
                <button onClick={() => setActiveTab("all")} className="w-full flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm text-blue-700">
                  <Users className="h-4 w-4" /> View all {totalDrivers} drivers
                </button>
              </div>
            </div>
            <div className="bg-white rounded-xl border p-5">
              <h3 className="text-sm font-semibold mb-3">Top Drivers</h3>
              <div className="space-y-2">
                {topDrivers.slice(0, 5).map((d, i) => (
                  <div key={d.id} className="flex items-center justify-between text-xs">
                    <span>{d.user?.full_name || "Unknown"}</span>
                    <span className="text-gray-500">{d.total_rides || 0} rides</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== ALL DRIVERS TAB ===== */}
      {activeTab === "all" && (
        <>
          <div className="bg-white rounded-xl border p-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input type="text" placeholder="Search name, phone, license, plate..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <select value={approvalFilter} onChange={(e) => setApprovalFilter(e.target.value)} className="px-4 py-2 border rounded-lg text-sm bg-white">
                <option value="all">All Approvals</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="documents_missing">Missing Docs</option>
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "online" | "offline" | "all")} className="px-4 py-2 border rounded-lg text-sm bg-white">
                <option value="all">All Status</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-xl border overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div></div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 bg-gray-50 border-b">
                        <th className="px-4 py-3 font-medium">Driver</th>
                        <th className="px-4 py-3 font-medium">Phone</th>
                        <th className="px-4 py-3 font-medium">Vehicle</th>
                        <th className="px-4 py-3 font-medium">Rating</th>
                        <th className="px-4 py-3 font-medium">Earnings</th>
                        <th className="px-4 py-3 font-medium">Online</th>
                        <th className="px-4 py-3 font-medium">Verification</th>
                        <th className="px-4 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drivers.map((driver) => (
                        <tr key={driver.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="relative">
                                <div className="h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-medium overflow-hidden bg-purple-600">
                                  {driver.user?.avatar_url ? (
                                    <img src={driver.user.avatar_url as string} alt="" className="h-full w-full object-cover" />
                                  ) : (
                                    <span>{driver.user?.full_name?.charAt(0) || "D"}</span>
                                  )}
                                </div>
                                <span className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white ${driver.is_online ? "bg-green-500" : "bg-gray-400"}`} />
                              </div>
                              <div>
                                <p className="font-medium text-gray-900">{driver.user?.full_name || "Unknown"}</p>
                                <p className="text-xs text-gray-400">{driver.driver_license_number || "No license"}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">{driver.user?.phone || "N/A"}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {driver.vehicle ? <>{driver.vehicle.plate_number}<br />{driver.vehicle.make} {driver.vehicle.model}</> : "No vehicle"}
                          </td>
                          <td className="px-4 py-3"><div className="flex items-center gap-1"><Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" /><span className="font-medium">{driver.rating?.toFixed(1) || "5.0"}</span></div></td>
                          <td className="px-4 py-3 font-medium text-xs">{formatCurrency(driver.total_earnings || 0)}</td>
                          <td className="px-4 py-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${driver.is_online ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>{driver.is_online ? "Online" : "Offline"}</span></td>
                          <td className="px-4 py-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(driver.approval_status || "pending")}`}>{getApprovalStatusLabel(driver.approval_status || "pending")}</span></td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => { setSelectedDriver(driver); setShowDetail(true); setDetailTab("details"); }} className="p-1.5 hover:bg-gray-100 rounded text-gray-500"><Eye className="h-4 w-4" /></button>
                              {driver.is_online && <button onClick={() => handleForceOffline(driver.id)} className="p-1.5 hover:bg-red-50 rounded text-red-600"><XCircle className="h-4 w-4" /></button>}
                              {driver.approval_status === "pending" && <><button onClick={() => handleApprove(driver.id)} className="p-1.5 hover:bg-green-50 rounded text-green-600"><CheckCircle className="h-4 w-4" /></button><button onClick={() => { setSelectedDriver(driver); setShowReject(true); }} className="p-1.5 hover:bg-red-50 rounded text-red-600"><XCircle className="h-4 w-4" /></button></>}
                              {driver.approval_status === "approved" && <button onClick={() => { setSelectedDriver(driver); setShowSuspend(true); }} className="p-1.5 hover:bg-orange-50 rounded text-orange-600"><Ban className="h-4 w-4" /></button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {drivers.length === 0 && <tr><td colSpan={8} className="px-6 py-12"><EmptyState icon={Users} title="No drivers found" description="Drivers will appear here after registration" /></td></tr>}
                    </tbody>
                  </table>
                </div>
                <Pagination page={pagination.page} totalPages={pagination.totalPages} totalCount={pagination.totalCount} pageSize={pagination.pageSize} onPageChange={setPage} onPageSizeChange={(ps) => { setPageSize(ps); setPage(1); }} />
              </>
            )}
          </div>
        </>
      )}

      {/* ===== VERIFICATION TAB ===== */}
      {activeTab === "verification" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <VerificationCard label="Pending" value={pendingCount} color="bg-amber-50" textColor="text-amber-700" />
            <VerificationCard label="Approved" value={approvedCount} color="bg-green-50" textColor="text-green-700" />
            <VerificationCard label="Rejected" value={rejectedCount} color="bg-red-50" textColor="text-red-700" />
            <VerificationCard label="Expired Docs" value={0} color="bg-gray-50" textColor="text-gray-700" />
          </div>
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500 bg-gray-50 border-b"><th className="px-4 py-3 font-medium">Driver</th><th className="px-4 py-3 font-medium">License</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium text-right">Actions</th></tr></thead>
                <tbody>
                  {drivers.filter(d => d.approval_status === "pending").slice(0, 20).map(driver => (
                    <tr key={driver.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-xs">{driver.user?.full_name}</td>
                      <td className="px-4 py-3 text-xs">{driver.driver_license_number || "—"}</td>
                      <td className="px-4 py-3"><span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Pending Review</span></td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleApprove(driver.id)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">Approve</button>
                          <button onClick={() => { setSelectedDriver(driver); setShowReject(true); }} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Reject</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {drivers.filter(d => d.approval_status === "pending").length === 0 && <tr><td colSpan={4} className="px-6 py-12 text-center text-gray-400">No pending verifications</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===== EARNINGS TAB ===== */}
      {activeTab === "earnings" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500 bg-gray-50 border-b"><th className="px-4 py-3 font-medium">Driver</th><th className="px-4 py-3 font-medium">Available</th><th className="px-4 py-3 font-medium">Pending</th><th className="px-4 py-3 font-medium">Cash</th><th className="px-4 py-3 font-medium">Total</th></tr></thead>
                <tbody>
                  {topEarners.slice(0, 20).map(driver => (
                    <tr key={driver.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-xs">{driver.user?.full_name}</td>
                      <td className="px-4 py-3 text-xs text-green-600">{formatCurrency(driver.available_balance || 0)}</td>
                      <td className="px-4 py-3 text-xs text-amber-600">{formatCurrency(driver.pending_balance || 0)}</td>
                      <td className="px-4 py-3 text-xs">{formatCurrency(driver.cash_collected || 0)}</td>
                      <td className="px-4 py-3 text-xs font-medium">{formatCurrency(driver.total_earnings || 0)}</td>
                    </tr>
                  ))}
                  {topEarners.length === 0 && <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400">No earnings data</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===== LIVE TAB ===== */}
      {activeTab === "live" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-xl border overflow-hidden" style={{ minHeight: "500px" }}>
            <LiveMapView drivers={liveLocations} />
          </div>
          <div className="bg-white rounded-xl border p-4">
            <h3 className="text-sm font-semibold mb-3">Active Drivers ({liveLocations.length})</h3>
            <div className="space-y-2 max-h-[450px] overflow-y-auto">
              {liveLocations.map(loc => (
                <div key={loc.id} className="flex items-center justify-between p-2 border rounded-lg hover:bg-gray-50">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 bg-purple-600 rounded-full flex items-center justify-center text-white text-xs font-medium">
                      {loc.driver_name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-xs font-medium">{loc.driver_name}</p>
                      <p className="text-xs text-gray-400">{loc.speed != null ? `${loc.speed.toFixed(1)} km/h` : "Stationary"}</p>
                    </div>
                  </div>
                </div>
              ))}
              {liveLocations.length === 0 && <p className="text-center text-gray-400 text-sm py-4">No drivers online</p>}
            </div>
          </div>
        </div>
      )}

      {/* ===== ANALYTICS TAB ===== */}
      {activeTab === "analytics" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border p-5">
            <h3 className="text-sm font-semibold mb-3">Top Drivers by Rides</h3>
            <div className="space-y-3">
              {topDrivers.map((d, i) => (
                <div key={d.id} className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span><span className="text-xs font-medium">{d.user?.full_name}</span></div><span className="text-xs text-gray-500">{d.total_rides || 0} rides</span></div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border p-5">
            <h3 className="text-sm font-semibold mb-3">Top Earners</h3>
            <div className="space-y-3">
              {topEarners.map((d, i) => (
                <div key={d.id} className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span><span className="text-xs font-medium">{d.user?.full_name}</span></div><span className="text-xs text-green-600 font-medium">{formatCurrency(d.total_earnings || 0)}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== DRIVER DETAIL MODAL ===== */}
      {showDetail && selectedDriver && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-6 border-b">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="h-12 w-12 bg-purple-600 rounded-full flex items-center justify-center text-white text-lg font-medium">{selectedDriver.user?.full_name?.charAt(0)}</div>
                  <span className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-white ${selectedDriver.is_online ? "bg-green-500" : "bg-gray-400"}`} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">{selectedDriver.user?.full_name}</h2>
                  <p className="text-xs text-gray-500">{selectedDriver.user?.phone} • {selectedDriver.vehicle?.plate_number}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleEdit} className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium flex items-center gap-1 hover:bg-purple-700"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                <button onClick={openDeleteModal} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium flex items-center gap-1 hover:bg-red-700"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                {selectedDriver.approval_status === "pending" && <><button onClick={() => handleApprove(selectedDriver.id)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium">Approve</button><button onClick={() => setShowReject(true)} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium">Reject</button></>}
                {selectedDriver.approval_status === "approved" && <><button onClick={() => setShowSuspend(true)} className="px-3 py-1.5 bg-orange-600 text-white rounded-lg text-xs font-medium">Suspend</button><button onClick={() => handleForceOffline(selectedDriver.id)} className="px-3 py-1.5 bg-gray-600 text-white rounded-lg text-xs font-medium">Force Offline</button></>}
                <button onClick={() => setShowDetail(false)} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="flex border-b px-6">
              {(["details","documents","rides","wallet"] as const).map(tab => (
                <button key={tab} onClick={() => setDetailTab(tab)} className={`px-4 py-3 text-sm font-medium border-b-2 capitalize ${detailTab === tab ? "border-green-600 text-green-600" : "border-transparent text-gray-500"}`}>{tab}</button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {detailTab === "details" && (
                <div className="grid grid-cols-3 gap-4">
                  <DetailSection title="Personal Info" items={[["Phone", selectedDriver.user?.phone || "N/A"],["Email", selectedDriver.user?.email || "N/A"],["ID Number", selectedDriver.id_number || "N/A"],["ID Type", selectedDriver.id_type === "national_id" ? "National ID" : "Passport"],["Date of Birth", selectedDriver.date_of_birth || "N/A"],["Address", selectedDriver.address || "N/A"]]} />
                  <DetailSection title="License & Vehicle" items={[["License No", selectedDriver.driver_license_number || "N/A"],["License Expiry", selectedDriver.driver_license_expiry || "N/A"],["Plate", selectedDriver.vehicle?.plate_number || "N/A"],["Vehicle", selectedDriver.vehicle ? `${selectedDriver.vehicle.make} ${selectedDriver.vehicle.model}` : "N/A"],["Type", selectedDriver.vehicle?.vehicle_type || "N/A"],["Color", selectedDriver.vehicle?.color || "N/A"]]} />
                  <DetailSection title="Performance" items={[["Total Rides", String(selectedDriver.total_rides || 0)],["Total Earnings", formatCurrency(selectedDriver.total_earnings || 0)],["Rating", `★ ${selectedDriver.rating?.toFixed(1) || "5.0"}`],["Cash Collected", formatCurrency(selectedDriver.cash_collected || 0)],["Status", selectedDriver.is_online ? "Online" : "Offline"],["Approval", selectedDriver.approval_status || "N/A"]]} />
                </div>
              )}
              {detailTab === "documents" && (
                <div className="space-y-4">
                  {/* Identity Documents */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-2 border-b pb-1">Identity Documents</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <DocCard icon={IdCard} label="ID Document" url={selectedDriver.id_document_url} />
                      <DocCard icon={FileText} label="Driver License" url={selectedDriver.license_document_url} />
                      <DocCard icon={User} label="Profile Photo" url={selectedDriver.profile_picture_url} />
                    </div>
                  </div>
                  {/* Vehicle Documents */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-2 border-b pb-1">Vehicle Documents</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <DocCard icon={Car} label="Vehicle Registration" url={selectedDriver.vehicle_registration_url} />
                      <DocCard icon={Shield} label="Insurance" url={selectedDriver.insurance_document_url} />
                    </div>
                  </div>
                  {/* Vehicle Photos */}
                  {selectedDriver.vehicle_photo_urls && selectedDriver.vehicle_photo_urls.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-2 border-b pb-1">Vehicle Photos</h4>
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
                  {/* Emergency Contact */}
                  {(selectedDriver.emergency_contact_name || selectedDriver.emergency_contact_phone) && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-2 border-b pb-1">Emergency Contact</h4>
                      <div className="text-xs space-y-1">
                        {selectedDriver.emergency_contact_name && <p><span className="text-gray-500">Name:</span> {selectedDriver.emergency_contact_name}</p>}
                        {selectedDriver.emergency_contact_phone && <p><span className="text-gray-500">Phone:</span> {selectedDriver.emergency_contact_phone}</p>}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {detailTab === "rides" && <div className="text-center py-8 text-gray-400"><MapPin className="h-12 w-12 mx-auto mb-2 opacity-50" /><p>Completed: {selectedDriver.total_rides || 0} rides</p></div>}
              {detailTab === "wallet" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="bg-green-50 rounded-lg p-4 text-center"><p className="text-xs text-gray-500">Available</p><p className="text-xl font-bold text-green-700">{formatCurrency(selectedDriver.available_balance || 0)}</p></div>
                    <div className="bg-yellow-50 rounded-lg p-4 text-center"><p className="text-xs text-gray-500">Pending</p><p className="text-xl font-bold text-yellow-700">{formatCurrency(selectedDriver.pending_balance || 0)}</p></div>
                    <div className="bg-blue-50 rounded-lg p-4 text-center"><p className="text-xs text-gray-500">Cash</p><p className="text-xl font-bold text-blue-700">{formatCurrency(selectedDriver.cash_collected || 0)}</p></div>
                    <div className="bg-purple-50 rounded-lg p-4 text-center"><p className="text-xs text-gray-500">Earned</p><p className="text-xl font-bold text-purple-700">{formatCurrency(selectedDriver.total_earnings || 0)}</p></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showReject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-red-600">Reject Driver</h2>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Rejection reason..." rows={3} className="w-full px-3 py-2 border rounded-lg text-sm" />
            <div className="flex gap-2"><button onClick={() => setShowReject(false)} className="flex-1 px-4 py-2 border rounded-lg text-sm">Cancel</button><button onClick={handleReject} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm">Reject</button></div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {showDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-red-600">Delete Driver</h2>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
              <p className="font-medium">⚠️ This action cannot be undone.</p>
              <p className="mt-1 text-xs text-red-600">
                This will permanently remove <strong>{selectedDriver?.user?.full_name}</strong>'s account, 
                vehicle, wallet, ride history, and all associated data.
              </p>
            </div>
            <p className="text-sm text-gray-600">
              Type <strong className="text-red-600">DELETE</strong> to confirm:
            </p>
            <input
              type="text"
              placeholder="Type DELETE to confirm"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowDelete(false)} className="flex-1 px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirmText !== "DELETE"}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm disabled:opacity-50"
              >
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEdit && selectedDriver && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="text-lg font-semibold text-gray-900">Edit Driver</h2>
              <button onClick={() => setShowEdit(false)} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
            </div>

            {editError && (
              <div className="mx-5 mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{editError}</div>
            )}
            {editSuccess && (
              <div className="mx-5 mt-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{editSuccess}</div>
            )}

            <div className="p-5 space-y-4">
              {/* Account Section */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Account Information</h3>
                <div className="space-y-3">
                  {/* Profile Picture */}
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <div className="h-16 w-16 rounded-full bg-purple-100 flex items-center justify-center overflow-hidden border-2 border-purple-200">
                        {editAvatarPreview ? (
                          <img src={editAvatarPreview} alt="Preview" className="h-full w-full object-cover" />
                        ) : editCurrentAvatar ? (
                          <img src={editCurrentAvatar} alt="Current" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-purple-600 text-xl font-bold">{editFullName?.charAt(0) || "D"}</span>
                        )}
                      </div>
                      {editUploading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-full">
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-600"></div>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="cursor-pointer px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-xs font-medium transition-colors">
                        Change Photo
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setEditAvatarFile(file);
                              const reader = new FileReader();
                              reader.onload = () => setEditAvatarPreview(reader.result as string);
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                      </label>
                      {editAvatarFile && (
                        <button
                          onClick={() => { setEditAvatarFile(null); setEditAvatarPreview(null); }}
                          className="ml-2 text-xs text-red-500 hover:text-red-700"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Full Name</label>
                    <input type="text" value={editFullName} onChange={(e) => setEditFullName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                      <input type="text" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                      <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
                    <input type="text" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editCanGoOnline} onChange={(e) => setEditCanGoOnline(e.target.checked)} className="rounded border-gray-300 text-green-600" />
                    Can go online
                  </label>
                </div>
              </div>

              {/* Documents Section */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Documents</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Driver License</label>
                    <div className="flex items-center gap-3">
                      <label className="cursor-pointer px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-medium transition-colors">
                        {editLicenseFile ? editLicenseFile.name : 'Upload License'}
                        <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setEditLicenseFile(e.target.files?.[0] || null)} />
                      </label>
                      {editLicenseFile && (
                        <button onClick={() => setEditLicenseFile(null)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                      )}
                      {(selectedDriver.license_document_url) && !editLicenseFile && (
                        <a href={selectedDriver.license_document_url} target="_blank" className="text-xs text-blue-600 underline">View current</a>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Vehicle Registration</label>
                    <div className="flex items-center gap-3">
                      <label className="cursor-pointer px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-medium transition-colors">
                        {editVehicleRegFile ? editVehicleRegFile.name : 'Upload Registration'}
                        <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setEditVehicleRegFile(e.target.files?.[0] || null)} />
                      </label>
                      {editVehicleRegFile && (
                        <button onClick={() => setEditVehicleRegFile(null)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                      )}
                      {(selectedDriver.vehicle_registration_url) && !editVehicleRegFile && (
                        <a href={selectedDriver.vehicle_registration_url} target="_blank" className="text-xs text-blue-600 underline">View current</a>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Insurance Document</label>
                    <div className="flex items-center gap-3">
                      <label className="cursor-pointer px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-medium transition-colors">
                        {editInsuranceFile ? editInsuranceFile.name : 'Upload Insurance'}
                        <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setEditInsuranceFile(e.target.files?.[0] || null)} />
                      </label>
                      {editInsuranceFile && (
                        <button onClick={() => setEditInsuranceFile(null)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                      )}
                      {(selectedDriver.insurance_document_url) && !editInsuranceFile && (
                        <a href={selectedDriver.insurance_document_url} target="_blank" className="text-xs text-blue-600 underline">View current</a>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Vehicle Section */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Vehicle Information</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Plate Number</label>
                    <input type="text" value={editPlateNumber} onChange={(e) => setEditPlateNumber(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Make</label>
                      <input type="text" value={editVehicleMake} onChange={(e) => setEditVehicleMake(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Model</label>
                      <input type="text" value={editVehicleModel} onChange={(e) => setEditVehicleModel(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Year</label>
                      <input type="number" value={editVehicleYear} onChange={(e) => setEditVehicleYear(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
                      <input type="text" value={editVehicleColor} onChange={(e) => setEditVehicleColor(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 p-5 border-t">
              <button onClick={() => setShowEdit(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleSaveEdit} disabled={editSaving} className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">{editSaving ? "Saving..." : "Save Changes"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Suspend Modal */}
      {showSuspend && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-orange-600">Suspend Driver</h2>
            <p className="text-sm">Suspend <strong>{selectedDriver?.user?.full_name}</strong>?</p>
            <textarea value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder="Reason..." rows={2} className="w-full px-3 py-2 border rounded-lg text-sm" />
            <div className="flex gap-2"><button onClick={() => setShowSuspend(false)} className="flex-1 px-4 py-2 border rounded-lg text-sm">Cancel</button><button onClick={handleSuspend} className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm">Suspend</button></div>
          </div>
        </div>
      )}

      {/* Add Driver Modal */}
      {showAddDriver && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-lg mx-4 p-6 space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Add New Driver</h2>
              <button onClick={() => { setShowAddDriver(false); resetAddDriverForm(); }} className="p-1 hover:bg-gray-100 rounded-lg"><X className="h-5 w-5" /></button>
            </div>

            {addDriverError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{addDriverError}</div>
            )}

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Driver Information</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Full Name *</label>
                    <input type="text" value={newDriverName} onChange={e => setNewDriverName(e.target.value)} className="w-full h-11 px-3 border border-gray-200 rounded-xl text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Phone *</label>
                    <input type="text" value={newDriverPhone} onChange={e => setNewDriverPhone(e.target.value)} className="w-full h-11 px-3 border border-gray-200 rounded-xl text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Email</label>
                    <input type="email" value={newDriverEmail} onChange={e => setNewDriverEmail(e.target.value)} className="w-full h-11 px-3 border border-gray-200 rounded-xl text-sm" />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Vehicle (Optional)</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Plate Number</label>
                    <input type="text" value={newDriverPlate} onChange={e => setNewDriverPlate(e.target.value)} className="w-full h-11 px-3 border border-gray-200 rounded-xl text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Type</label>
                    <select value={newDriverType} onChange={e => setNewDriverType(e.target.value)} className="w-full h-11 px-3 border border-gray-200 rounded-xl text-sm bg-white">
                      <option value="economy">WeAfrica X</option>
                      <option value="comfort">WeAfrica Comfort</option>
                      <option value="xl">WeAfrica XL</option>
                      <option value="boda">WeAfrica Boda</option>
                      <option value="luxury">WeAfrica Black</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Make</label>
                    <input type="text" value={newDriverMake} onChange={e => setNewDriverMake(e.target.value)} className="w-full h-11 px-3 border border-gray-200 rounded-xl text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Model</label>
                    <input type="text" value={newDriverModel} onChange={e => setNewDriverModel(e.target.value)} className="w-full h-11 px-3 border border-gray-200 rounded-xl text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Year</label>
                    <input type="number" value={newDriverYear} onChange={e => setNewDriverYear(e.target.value)} className="w-full h-11 px-3 border border-gray-200 rounded-xl text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Color</label>
                    <input type="text" value={newDriverColor} onChange={e => setNewDriverColor(e.target.value)} className="w-full h-11 px-3 border border-gray-200 rounded-xl text-sm" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowAddDriver(false); resetAddDriverForm(); }} className="flex-1 h-11 border border-gray-200 rounded-xl text-sm font-medium">Cancel</button>
              <button onClick={handleAddDriver} disabled={addDriverLoading || !newDriverName.trim() || !newDriverPhone.trim()} className="flex-1 h-11 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                {addDriverLoading ? "Adding..." : "Add Driver"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- HELPERS ---

function StatBox({ icon: Icon, label, value, color, bg, dot }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; color: string; bg: string; dot?: string }) {
  return <div className={`${bg} rounded-xl p-4`}><div className="flex items-center gap-2"><Icon className={`h-4 w-4 ${color}`} />{dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}</div><p className="text-xl font-bold mt-2 text-gray-900">{value}</p><p className="text-xs text-gray-500">{label}</p></div>;
}

function ProgressBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return <div className="mb-3"><div className="flex justify-between text-xs mb-1"><span className="text-gray-500">{label}</span><span className="text-gray-700">{value}</span></div><div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} /></div></div>;
}

function VerificationCard({ label, value, color, textColor }: { label: string; value: number; color: string; textColor: string }) {
  return <div className={`${color} rounded-xl p-4`}><p className={`text-xl font-bold ${textColor}`}>{value}</p><p className="text-xs text-gray-600">{label}</p></div>;
}

function DetailSection({ title, items }: { title: string; items: [string, string][] }) {
  return <div className="bg-gray-50 rounded-lg p-4"><h4 className="text-xs font-semibold text-gray-900 mb-2">{title}</h4><div className="space-y-1.5">{items.map(([label, value], i) => <div key={i} className="flex justify-between text-xs"><span className="text-gray-500">{label}</span><span className="font-medium truncate ml-2 max-w-[140px]">{value}</span></div>)}</div></div>;
}

function DocCard({ icon: Icon, label, url }: { icon: React.ComponentType<{ className?: string }>; label: string; url: string | null | undefined }) {
  if (!url) {
    return (
      <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-2 border border-gray-100">
        <Icon className="h-4 w-4 text-gray-300" />
        <div>
          <p className="text-xs font-medium text-gray-400">{label}</p>
          <p className="text-xs text-gray-300">Not uploaded</p>
        </div>
      </div>
    );
  }
  const isImage = /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(url);
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="bg-blue-50 rounded-lg p-3 flex items-center gap-2 border border-blue-100 hover:bg-blue-100 transition-colors">
      <Icon className="h-4 w-4 text-blue-600" />
      <div>
        <p className="text-xs font-medium text-blue-700">{label}</p>
        <p className="text-xs text-blue-500 underline">{isImage ? "View Image" : "Open Document"}</p>
      </div>
    </a>
  );
}
