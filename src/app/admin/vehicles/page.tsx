"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Vehicle } from "@/lib/types";
import {
  Search,
  Eye,
  CheckCircle,
  XCircle,
  X,
  Phone,
  Car,
  FileText,
  Clock,
  Ban,
  Shield,
  AlertTriangle,
  BarChart3,
  Users,
  DollarSign,
  Wrench,
  ClipboardList,
  Calendar,
  MapPin,
  Plus,
  UserPlus,
  UserMinus,
  Navigation,
  Truck,
  Bike,
} from "lucide-react";
import { formatDate, formatCurrency, getStatusColor } from "@/lib/utils";

type VehicleTab = "overview" | "all" | "types" | "documents" | "inspections" | "assignment" | "fleet" | "maintenance";

interface VehicleTypeRow {
  id: string;
  name: string;
  slug: string;
  icon: string;
  seats: number;
  is_active: boolean;
  count: number;
}

// Legacy vehicle_type vocabulary, derived from the resolved vehicle class —
// kept only so older code paths that still read that column (e.g. the
// eligibility fallback for unclassed vehicles) see a sane value.
// Eligibility itself is driven by vehicle_class_id, not this field.
function legacyTierForClassSlug(slug?: string | null): string {
  switch (slug) {
    case "economy_hatchback": return "go";
    case "standard_sedan": return "x";
    case "xl_vehicle": return "xl";
    case "comfort_sedan": return "comfort";
    case "premium_luxury": return "black";
    default: return "go";
  }
}

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<Vehicle[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignDriverId, setAssignDriverId] = useState("");
  const [detailTab, setDetailTab] = useState<"info" | "documents" | "inspections" | "trips">("info");
  const [activeTab, setActiveTab] = useState<VehicleTab>("overview");
  const [newVehicle, setNewVehicle] = useState({
    plate_number: "", make_id: "", model_id: "", year: new Date().getFullYear(), color: "White",
    driver_id: ""
  });
  const [onTripCount, setOnTripCount] = useState(0);

  // Available drivers for assignment dropdown
  const [availableDrivers, setAvailableDrivers] = useState<{ id: string; full_name: string; plate_number?: string }[]>([]);

  // Vehicle classes for the class-assignment dropdown
  const [vehicleClasses, setVehicleClasses] = useState<{ id: string; name: string; slug: string }[]>([]);

  // Make -> Model catalog for the Add Vehicle form — selecting a model
  // auto-resolves vehicle_class_id instead of an admin typing make/model
  // free text and guessing a service type.
  const [vehicleMakes, setVehicleMakes] = useState<{ id: string; name: string }[]>([]);
  const [vehicleModels, setVehicleModels] = useState<{ id: string; make_id: string; name: string; vehicle_class_id: string | null }[]>([]);

  useEffect(() => {
    async function loadVehicleClasses() {
      try {
        const { data } = await supabase.from("vehicle_classes")
          .select("id, name, slug")
          .eq("is_active", true)
          .order("sort_order");
        setVehicleClasses(data || []);
      } catch {
        // ignore
      }
    }
    loadVehicleClasses();
  }, []);

  useEffect(() => {
    async function loadCatalog() {
      try {
        const [{ data: mk }, { data: md }] = await Promise.all([
          supabase.from("vehicle_makes").select("id, name").eq("is_active", true).order("sort_order"),
          supabase.from("vehicle_models").select("id, make_id, name, vehicle_class_id").eq("is_active", true).order("sort_order"),
        ]);
        setVehicleMakes(mk || []);
        setVehicleModels(md || []);
      } catch {
        // ignore
      }
    }
    loadCatalog();
  }, []);

  useEffect(() => {
    async function loadDrivers() {
      try {
        const res = await fetch("/api/drivers/available-for-vehicle");
        const body = await res.json();
        if (res.ok) setAvailableDrivers(body.drivers || []);
      } catch {
        // ignore
      }
    }
    loadDrivers();
  }, []);

  // Real "On Trip" count from rides table
  useEffect(() => {
    async function loadOnTripCount() {
      try {
        const { count } = await supabase.from("rides")
          .select("*", { count: "exact", head: true })
          .in("status", ["in_progress", "accepted", "driver_arriving", "driver_arrived"]);
        setOnTripCount(count ?? 0);
      } catch {
        // ignore
      }
    }
    loadOnTripCount();
  }, []);

  const fetchVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("vehicles")
        .select("*, driver:drivers(user:users(full_name, phone)), vehicle_class:vehicle_classes(id, name, slug)")
        .order("created_at", { ascending: false });
      setVehicles((data as Vehicle[]) || []);
    } catch {
      setVehicles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const filterVehicles = useCallback(() => {
    let filtered = [...vehicles];
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(v =>
        v.plate_number?.toLowerCase().includes(s) ||
        v.make?.toLowerCase().includes(s) ||
        v.model?.toLowerCase().includes(s) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((v.driver as any)?.user?.full_name?.toLowerCase().includes(s))
      );
    }
    if (typeFilter !== "all") filtered = filtered.filter(v => v.vehicle_type === typeFilter);
    if (statusFilter === "active") filtered = filtered.filter(v => v.is_active);
    if (statusFilter === "inactive") filtered = filtered.filter(v => !v.is_active);
    setFilteredVehicles(filtered);
  }, [search, typeFilter, statusFilter, cityFilter, vehicles]);

  useEffect(() => { fetchVehicles(); }, [fetchVehicles]);
  useEffect(() => { filterVehicles(); }, [filterVehicles]);

  const handleAddVehicle = async () => {
    const make = vehicleMakes.find((m) => m.id === newVehicle.make_id);
    const model = vehicleModels.find((m) => m.id === newVehicle.model_id);
    if (!make || !model) return alert("Please select a make and model.");
    const vehicleClass = vehicleClasses.find((c) => c.id === model.vehicle_class_id);
    try {
      await supabase.from("vehicles").insert({
        plate_number: newVehicle.plate_number,
        make: make.name,
        model: model.name,
        year: newVehicle.year,
        color: newVehicle.color,
        vehicle_model_id: model.id,
        vehicle_class_id: model.vehicle_class_id,
        vehicle_type: legacyTierForClassSlug(vehicleClass?.slug),
        driver_id: newVehicle.driver_id || null,
      });
      fetchVehicles();
      setShowAddModal(false);
    } catch { /* ignore */ }
  };

  const handleApprove = async (id: string) => {
    try { await supabase.from("vehicles").update({ is_active: true }).eq("id", id); fetchVehicles(); } catch { /* ignore */ }
  };

  const handleSuspend = async (id: string) => {
    try { await supabase.from("vehicles").update({ is_active: false }).eq("id", id); fetchVehicles(); } catch { /* ignore */ }
  };

  const handleAssignClass = async (vehicleId: string, vehicleClassId: string) => {
    try {
      await supabase.from("vehicles").update({ vehicle_class_id: vehicleClassId || null }).eq("id", vehicleId);
      fetchVehicles();
    } catch { /* ignore */ }
  };

  const handleAssignDriver = async () => {
    if (!selectedVehicle || !assignDriverId) return;
    try {
      await supabase.from("vehicles").update({ driver_id: assignDriverId }).eq("id", selectedVehicle.id);
      fetchVehicles();
      setShowAssignModal(false);
      setAssignDriverId("");
    } catch { /* ignore */ }
  };

  const handleUnassignDriver = async (vehicleId: string) => {
    try { await supabase.from("vehicles").update({ driver_id: null }).eq("id", vehicleId); fetchVehicles(); } catch { /* ignore */ }
  };

  const isInsuranceExpired = (expiry?: string) => !expiry || new Date(expiry) < new Date();

  // Stats — all computed from real vehicles data
  const totalVehicles = vehicles.length;
  const activeCount = vehicles.filter(v => v.is_active).length;
  const pendingCount = vehicles.filter(v => v.inspection_status === "pending").length;
  const expiredDocs = vehicles.filter(v => v.inspection_status === "expired" || isInsuranceExpired(v.insurance_expiry)).length;
  const onlineCount = vehicles.filter(v => (v.driver as unknown as { is_online?: boolean })?.is_online).length;
  const fleetCount = vehicles.filter(v => v.driver_id).length;

  // ── Consumer Ride Services ──
  const consumerTypes: VehicleTypeRow[] = [
    { id: "ct1", name: "WeAfrica X", slug: "economy", icon: "car", seats: 4, is_active: true, count: vehicles.filter(v => v.vehicle_type === "economy").length },
    { id: "ct2", name: "WeAfrica Comfort", slug: "comfort", icon: "car", seats: 4, is_active: true, count: vehicles.filter(v => v.vehicle_type === "comfort").length },
    { id: "ct3", name: "WeAfrica XL", slug: "xl", icon: "van", seats: 7, is_active: true, count: vehicles.filter(v => v.vehicle_type === "xl").length },
    { id: "ct4", name: "WeAfrica Black", slug: "luxury", icon: "car", seats: 4, is_active: true, count: vehicles.filter(v => v.vehicle_type === "luxury").length },
    { id: "ct5", name: "WeAfrica Taxi", slug: "taxi", icon: "car", seats: 4, is_active: true, count: vehicles.filter(v => v.vehicle_type === "taxi").length },
    { id: "ct6", name: "WeAfrica Women", slug: "women_only", icon: "car", seats: 4, is_active: false, count: vehicles.filter(v => v.vehicle_type === "women_only").length },
    { id: "ct7", name: "WeAfrica Electric", slug: "electric", icon: "car", seats: 4, is_active: false, count: vehicles.filter(v => v.vehicle_type === "electric").length },
  ];

  // ── Bike / Delivery Services ──
  const deliveryTypes: VehicleTypeRow[] = [
    { id: "dt1", name: "WeAfrica Boda", slug: "boda", icon: "bike", seats: 1, is_active: true, count: vehicles.filter(v => v.vehicle_type === "boda").length },
    { id: "dt2", name: "WeAfrica Delivery Bike", slug: "delivery_bike", icon: "bike", seats: 1, is_active: false, count: vehicles.filter(v => v.vehicle_type === "delivery_bike").length },
    { id: "dt3", name: "WeAfrica Delivery Van", slug: "delivery_van", icon: "truck", seats: 2, is_active: false, count: vehicles.filter(v => v.vehicle_type === "delivery_van").length },
  ];

  // ── Commercial / Shared ──
  const commercialTypes: VehicleTypeRow[] = [
    { id: "cm1", name: "WeAfrica Minibus", slug: "minibus", icon: "truck", seats: 18, is_active: false, count: vehicles.filter(v => v.vehicle_type === "minibus").length },
    { id: "cm2", name: "WeAfrica Shuttle", slug: "shuttle", icon: "truck", seats: 14, is_active: false, count: vehicles.filter(v => v.vehicle_type === "shuttle").length },
  ];

  // ── Business ──
  const businessTypes: VehicleTypeRow[] = [
    { id: "bt1", name: "WeAfrica Corporate", slug: "corporate", icon: "car", seats: 4, is_active: false, count: vehicles.filter(v => v.vehicle_type === "corporate").length },
    { id: "bt2", name: "WeAfrica Rentals", slug: "rental", icon: "car", seats: 4, is_active: false, count: vehicles.filter(v => v.vehicle_type === "rental").length },
  ];

  const vehicleTypeCounts: VehicleTypeRow[] = [
    ...consumerTypes,
    ...deliveryTypes,
    ...commercialTypes,
    ...businessTypes,
  ];

  const tabs: { id: VehicleTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "all", label: "All Vehicles", icon: Car },
    { id: "types", label: "Vehicle Types", icon: Truck },
    { id: "documents", label: "Documents", icon: FileText },
    { id: "inspections", label: "Inspections", icon: Shield },
    { id: "assignment", label: "Assignments", icon: UserPlus },
    { id: "fleet", label: "Fleet", icon: Car },
    { id: "maintenance", label: "Maintenance", icon: Wrench },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getDriverName = (v: Vehicle) => (v.driver as any)?.user?.full_name || null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vehicles</h1>
          <p className="text-gray-500 mt-1">Complete vehicle fleet management</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
          <Plus className="h-4 w-4" /> Add Vehicle
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === tab.id ? "border-green-600 text-green-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}>
              <Icon className="h-4 w-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* ===== OVERVIEW ===== */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <StatBox icon={Car} label="Total Vehicles" value={totalVehicles} color="text-blue-600" bg="bg-blue-50" />
            <StatBox icon={CheckCircle} label="Active" value={activeCount} color="text-green-600" bg="bg-green-50" />
            <StatBox icon={Clock} label="Pending" value={pendingCount} color="text-amber-600" bg="bg-amber-50" />
            <StatBox icon={AlertTriangle} label="Expired Docs" value={expiredDocs} color="text-red-600" bg="bg-red-50" />
            <StatBox icon={Navigation} label="Online Now" value={onlineCount} color="text-cyan-600" bg="bg-cyan-50" />
            <StatBox icon={MapPin} label="On Trip" value={onTripCount} color="text-emerald-600" bg="bg-emerald-50" />
            <StatBox icon={Truck} label="Fleet" value={fleetCount} color="text-purple-600" bg="bg-purple-50" />
            <StatBox icon={Ban} label="Inactive" value={totalVehicles - activeCount} color="text-gray-600" bg="bg-gray-50" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold mb-3">Vehicle Type Distribution</h3>
              <div className="space-y-3">
                {vehicleTypeCounts.map(vt => (
                  <div key={vt.id}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-500">{vt.name}</span>
                      <span className="text-gray-700 font-medium">{vt.count}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${totalVehicles > 0 ? (vt.count / totalVehicles) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
              <div className="space-y-2">
                <button onClick={() => setActiveTab("all")} className="w-full flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm text-blue-700"><Car className="h-4 w-4" />View all {totalVehicles} vehicles</button>
                <button onClick={() => setActiveTab("assignment")} className="w-full flex items-center gap-2 px-3 py-2 bg-purple-50 hover:bg-purple-100 rounded-lg text-sm text-purple-700"><UserPlus className="h-4 w-4" />Assign drivers</button>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold mb-3">Compliance Status</h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs mb-1"><span className="text-gray-500">Insured</span><span className="text-gray-700">{vehicles.filter(v => v.insurance_expiry && !isInsuranceExpired(v.insurance_expiry)).length}/{totalVehicles}</span></div>
                  <div className="h-2 bg-gray-100 rounded-full"><div className="h-full bg-green-500 rounded-full" style={{ width: `${totalVehicles > 0 ? (vehicles.filter(v => v.insurance_expiry && !isInsuranceExpired(v.insurance_expiry)).length / totalVehicles) * 100 : 0}%` }} /></div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1"><span className="text-gray-500">Inspected</span><span className="text-gray-700">{vehicles.filter(v => v.inspection_status === "passed").length}/{totalVehicles}</span></div>
                  <div className="h-2 bg-gray-100 rounded-full"><div className="h-full bg-green-500 rounded-full" style={{ width: `${totalVehicles > 0 ? (vehicles.filter(v => v.inspection_status === "passed").length / totalVehicles) * 100 : 0}%` }} /></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== ALL VEHICLES ===== */}
      {activeTab === "all" && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input type="text" placeholder="Search plate, make, model, driver..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm">
                <option value="all">All Types</option>
                <option value="economy">WeAfrica X</option>
                <option value="comfort">WeAfrica Comfort</option>
                <option value="xl">WeAfrica XL</option>
                <option value="luxury">WeAfrica Black</option>
                <option value="boda">WeAfrica Boda</option>
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm">
                <option value="all">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option>
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
                      <th className="px-4 py-3 font-medium">Vehicle</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Driver</th>
                      <th className="px-4 py-3 font-medium">Insurance</th>
                      <th className="px-4 py-3 font-medium">Inspection</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVehicles.map((v) => {
                      const driverName = getDriverName(v);
                      return (
                        <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium text-gray-900">{v.plate_number}</p>
                              <p className="text-xs text-gray-400">{v.make} {v.model} ({v.year}) — {v.color}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3"><span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 capitalize">{v.vehicle_type}</span></td>
                          <td className="px-4 py-3 text-xs text-gray-500">{driverName || "Unassigned"}</td>
                          <td className="px-4 py-3">
                            {v.insurance_expiry ? (
                              <span className={`inline-flex items-center gap-1 text-xs ${isInsuranceExpired(v.insurance_expiry) ? "text-red-600" : "text-green-600"}`}>
                                {isInsuranceExpired(v.insurance_expiry) && <AlertTriangle className="h-3 w-3" />}
                                {formatDate(v.insurance_expiry)}
                              </span>
                            ) : <span className="text-gray-400 text-xs">N/A</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${v.inspection_status === "passed" ? "bg-green-100 text-green-800" : v.inspection_status === "pending" ? "bg-yellow-100 text-yellow-800" : v.inspection_status === "expired" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-800"}`}>
                              {v.inspection_status || "N/A"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${v.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                              {v.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => { setSelectedVehicle(v); setShowDetailModal(true); setDetailTab("info"); }} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500" title="View"><Eye className="h-4 w-4" /></button>
                              {v.driver_id ? <button onClick={() => handleUnassignDriver(v.id)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-600" title="Unassign"><UserMinus className="h-4 w-4" /></button> : <button onClick={() => { setSelectedVehicle(v); setShowAssignModal(true); }} className="p-1.5 hover:bg-green-50 rounded-lg text-green-600" title="Assign"><UserPlus className="h-4 w-4" /></button>}
                              {v.is_active ? <button onClick={() => handleSuspend(v.id)} className="p-1.5 hover:bg-orange-50 rounded-lg text-orange-600" title="Suspend"><Ban className="h-4 w-4" /></button> : <button onClick={() => handleApprove(v.id)} className="p-1.5 hover:bg-green-50 rounded-lg text-green-600" title="Activate"><CheckCircle className="h-4 w-4" /></button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredVehicles.length === 0 && <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">No vehicles found</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== VEHICLE TYPES ===== */}
      {activeTab === "types" && (
        <div className="space-y-6">
          {/* Consumer Ride Services */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700">Consumer Ride Services</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 bg-gray-50/50 border-b border-gray-100">
                    <th className="px-6 py-3 font-medium">Type</th>
                    <th className="px-6 py-3 font-medium">Seats</th>
                    <th className="px-6 py-3 font-medium">Vehicles</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {consumerTypes.map(vt => (
                    <tr key={vt.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-green-50 rounded-lg"><Car className="h-5 w-5 text-green-600" /></div>
                          <div><p className="font-medium text-gray-900">{vt.name}</p><p className="text-xs text-gray-400">{vt.slug}</p></div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center font-medium">{vt.seats}</td>
                      <td className="px-6 py-4 font-medium text-center">{vt.count}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${vt.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                          {vt.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bike / Delivery Services */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700">Bike / Delivery Services</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 bg-gray-50/50 border-b border-gray-100">
                    <th className="px-6 py-3 font-medium">Type</th>
                    <th className="px-6 py-3 font-medium">Seats</th>
                    <th className="px-6 py-3 font-medium">Vehicles</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveryTypes.map(vt => (
                    <tr key={vt.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-green-50 rounded-lg">{vt.slug === "delivery_van" ? <Truck className="h-5 w-5 text-green-600" /> : <Bike className="h-5 w-5 text-green-600" />}</div>
                          <div><p className="font-medium text-gray-900">{vt.name}</p><p className="text-xs text-gray-400">{vt.slug}</p></div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center font-medium">{vt.seats}</td>
                      <td className="px-6 py-4 font-medium text-center">{vt.count}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${vt.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                          {vt.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Commercial / Shared */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700">Commercial / Shared</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 bg-gray-50/50 border-b border-gray-100">
                    <th className="px-6 py-3 font-medium">Type</th>
                    <th className="px-6 py-3 font-medium">Seats</th>
                    <th className="px-6 py-3 font-medium">Vehicles</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {commercialTypes.map(vt => (
                    <tr key={vt.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-green-50 rounded-lg"><Truck className="h-5 w-5 text-green-600" /></div>
                          <div><p className="font-medium text-gray-900">{vt.name}</p><p className="text-xs text-gray-400">{vt.slug}</p></div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center font-medium">{vt.seats}</td>
                      <td className="px-6 py-4 font-medium text-center">{vt.count}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${vt.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                          {vt.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Business */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700">Business</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 bg-gray-50/50 border-b border-gray-100">
                    <th className="px-6 py-3 font-medium">Type</th>
                    <th className="px-6 py-3 font-medium">Seats</th>
                    <th className="px-6 py-3 font-medium">Vehicles</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {businessTypes.map(vt => (
                    <tr key={vt.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-green-50 rounded-lg"><Car className="h-5 w-5 text-green-600" /></div>
                          <div><p className="font-medium text-gray-900">{vt.name}</p><p className="text-xs text-gray-400">{vt.slug}</p></div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center font-medium">{vt.seats}</td>
                      <td className="px-6 py-4 font-medium text-center">{vt.count}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${vt.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                          {vt.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===== DOCUMENTS ===== */}
      {activeTab === "documents" && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <FileText className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Document Verification</p>
          <p className="text-sm text-gray-400 mt-1">Upload and verify vehicle documents — coming soon</p>
        </div>
      )}

      {/* ===== INSPECTIONS ===== */}
      {activeTab === "inspections" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 font-medium">Vehicle</th>
                  <th className="px-4 py-3 font-medium">Last Inspection</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.length === 0 ? (
                  <tr><td colSpan={4} className="px-6 py-12 text-center text-gray-400">No vehicles found</td></tr>
                ) : vehicles.slice(0, 20).map(v => (
                  <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-xs">{v.plate_number} — {v.make} {v.model}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{v.inspection_date ? formatDate(v.inspection_date) : "N/A"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${v.inspection_status === "passed" ? "bg-green-100 text-green-800" : v.inspection_status === "pending" ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"}`}>
                        {v.inspection_status || "N/A"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right"><button className="px-2 py-1 text-xs bg-green-600 text-white rounded">Schedule</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== ASSIGNMENTS ===== */}
      {activeTab === "assignment" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 font-medium">Vehicle</th>
                  <th className="px-4 py-3 font-medium">Assigned Driver</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map(v => {
                  const driverName = getDriverName(v);
                  return (
                    <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-xs">{v.plate_number} — {v.make} {v.model}</td>
                      <td className="px-4 py-3 text-xs">{driverName || <span className="text-gray-400 italic">Unassigned</span>}</td>
                      <td className="px-4 py-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${driverName ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>{driverName ? "Active" : "Open"}</span></td>
                      <td className="px-4 py-3 text-right">
                        {driverName ? <button onClick={() => handleUnassignDriver(v.id)} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Remove</button> :
                          <button onClick={() => { setSelectedVehicle(v); setShowAssignModal(true); }} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">Assign</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== FLEET ===== */}
      {activeTab === "fleet" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-400">Fleet Vehicles</p><p className="text-xl font-bold text-purple-600">{fleetCount}</p></div>
            <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-400">Assigned Drivers</p><p className="text-xl font-bold text-blue-600">{fleetCount}</p></div>
            <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-400">Active Fleet Drivers</p><p className="text-xl font-bold text-green-600">{onlineCount}</p></div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <Truck className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Fleet Management</p>
            <p className="text-sm text-gray-400 mt-1">Vehicle revenue and performance tracking — coming soon</p>
          </div>
        </div>
      )}

      {/* ===== MAINTENANCE ===== */}
      {activeTab === "maintenance" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 font-medium">Vehicle</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.length === 0 ? (
                  <tr><td colSpan={3} className="px-6 py-12 text-center text-gray-400">No vehicles to display</td></tr>
                ) : vehicles.slice(0, 20).map(v => (
                  <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-xs">{v.plate_number} — {v.make} {v.model}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{v.is_active ? "Active" : "Inactive"}</td>
                    <td className="px-4 py-3 text-right"><button className="px-2 py-1 text-xs bg-blue-600 text-white rounded">Log Service</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== VEHICLE DETAIL MODAL ===== */}
      {showDetailModal && selectedVehicle && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 bg-blue-600 rounded-lg flex items-center justify-center text-white"><Car className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-lg font-semibold">{selectedVehicle.plate_number}</h2>
                  <p className="text-xs text-gray-500">{selectedVehicle.make} {selectedVehicle.model} ({selectedVehicle.year}) — {selectedVehicle.color}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selectedVehicle.driver_id ? <button onClick={() => handleUnassignDriver(selectedVehicle.id)} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium">Unassign Driver</button> : <button onClick={() => { setShowAssignModal(true); }} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium">Assign Driver</button>}
                <button onClick={() => setShowDetailModal(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="h-5 w-5" /></button>
              </div>
            </div>

            <div className="flex border-b border-gray-200 px-6">
              {(["info", "documents", "inspections", "trips"] as const).map(tab => (
                <button key={tab} onClick={() => setDetailTab(tab)} className={`px-4 py-3 text-sm font-medium border-b-2 capitalize ${detailTab === tab ? "border-green-600 text-green-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                  {tab === "info" ? "Basic Info" : tab}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {detailTab === "info" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="text-xs font-semibold mb-2">Vehicle Info</h4>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs"><span className="text-gray-500">Plate</span><span className="font-medium">{selectedVehicle.plate_number}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-gray-500">Type</span><span className="font-medium capitalize">{selectedVehicle.vehicle_type}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-gray-500">Make</span><span className="font-medium">{selectedVehicle.make}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-gray-500">Model</span><span className="font-medium">{selectedVehicle.model}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-gray-500">Year</span><span className="font-medium">{selectedVehicle.year}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-gray-500">Color</span><span className="font-medium">{selectedVehicle.color}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-gray-500">Seats</span><span className="font-medium">{selectedVehicle.seats}</span></div>
                      <div className="flex justify-between items-center text-xs pt-1">
                        <span className="text-gray-500">Vehicle Class</span>
                        <select
                          value={selectedVehicle.vehicle_class_id || ""}
                          onChange={(e) => handleAssignClass(selectedVehicle.id, e.target.value)}
                          className="px-2 py-1 border rounded-md text-xs font-medium"
                        >
                          <option value="">Unassigned (default)</option>
                          {vehicleClasses.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="text-xs font-semibold mb-2">Status & Compliance</h4>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs"><span className="text-gray-500">Active</span><span className={`font-medium ${selectedVehicle.is_active ? "text-green-600" : "text-red-600"}`}>{selectedVehicle.is_active ? "Yes" : "No"}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-gray-500">Insurance</span><span className={`font-medium ${selectedVehicle.insurance_expiry && isInsuranceExpired(selectedVehicle.insurance_expiry) ? "text-red-600" : "text-green-600"}`}>{selectedVehicle.insurance_expiry ? formatDate(selectedVehicle.insurance_expiry) : "N/A"}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-gray-500">Inspection</span><span className="font-medium capitalize">{selectedVehicle.inspection_status || "N/A"}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-gray-500">Driver</span><span className="font-medium">{getDriverName(selectedVehicle) || "Unassigned"}</span></div>
                    </div>
                  </div>
                </div>
              )}

              {detailTab === "documents" && (
                <div className="text-center py-8 text-gray-400">
                  <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="font-medium">Document Verification</p>
                  <p className="text-sm">Upload and verify vehicle documents — coming soon</p>
                </div>
              )}

              {detailTab === "inspections" && (
                <div className="text-center py-8 text-gray-400">
                  <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="font-medium">Inspection History</p>
                  <p className="text-sm">Last inspection: {selectedVehicle.inspection_date ? formatDate(selectedVehicle.inspection_date) : "N/A"}</p>
                  <p className="text-sm">Status: {selectedVehicle.inspection_status || "N/A"}</p>
                </div>
              )}

              {detailTab === "trips" && (
                <div className="text-center py-8 text-gray-400">
                  <MapPin className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="font-medium">Trip History</p>
                  <p className="text-sm">Trip records for this vehicle will appear here</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Vehicle Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-lg mx-4 p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-semibold">Add New Vehicle</h2>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs text-gray-500 mb-1">Plate Number</label><input type="text" value={newVehicle.plate_number} onChange={(e) => setNewVehicle(p => ({ ...p, plate_number: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Make</label>
                <select
                  value={newVehicle.make_id}
                  onChange={(e) => setNewVehicle(p => ({ ...p, make_id: e.target.value, model_id: "" }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">Select make…</option>
                  {vehicleMakes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Model</label>
                <select
                  value={newVehicle.model_id}
                  onChange={(e) => setNewVehicle(p => ({ ...p, model_id: e.target.value }))}
                  disabled={!newVehicle.make_id}
                  className="w-full px-3 py-2 border rounded-lg text-sm disabled:bg-gray-100"
                >
                  <option value="">{newVehicle.make_id ? "Select model…" : "Select a make first"}</option>
                  {vehicleModels.filter((m) => m.make_id === newVehicle.make_id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              {newVehicle.model_id && (() => {
                const model = vehicleModels.find((m) => m.id === newVehicle.model_id);
                const vc = vehicleClasses.find((c) => c.id === model?.vehicle_class_id);
                return (
                  <div className="text-xs text-gray-500 -mt-2">
                    Vehicle class: <span className="font-medium text-gray-700">{vc?.name || "Unassigned"}</span>
                  </div>
                );
              })()}
              <div><label className="block text-xs text-gray-500 mb-1">Year</label><input type="number" value={newVehicle.year} onChange={(e) => setNewVehicle(p => ({ ...p, year: parseInt(e.target.value) }))} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">Color</label><input type="text" value={newVehicle.color} onChange={(e) => setNewVehicle(p => ({ ...p, color: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            </div>
            <div className="flex gap-2 pt-2"><button onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-2 border rounded-lg text-sm">Cancel</button><button onClick={handleAddVehicle} className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg text-sm">Add Vehicle</button></div>
          </div>
        </div>
      )}

      {/* Assign Driver Modal */}
      {showAssignModal && selectedVehicle && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h2 className="text-lg font-semibold">Assign Driver — {selectedVehicle.plate_number}</h2>
            <p className="text-sm text-gray-500">Select a driver to assign to this vehicle</p>
            <select value={assignDriverId} onChange={(e) => setAssignDriverId(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
              <option value="">Select driver...</option>
              {availableDrivers.map(d => (
                <option key={d.id} value={d.id}>{d.full_name}{d.plate_number ? ` (${d.plate_number})` : ""}</option>
              ))}
            </select>
            <div className="flex gap-2"><button onClick={() => setShowAssignModal(false)} className="flex-1 px-4 py-2 border rounded-lg text-sm">Cancel</button><button onClick={handleAssignDriver} className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg text-sm">Assign</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ icon: Icon, label, value, color, bg }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`${bg} rounded-xl p-4`}>
      <Icon className={`h-4 w-4 ${color}`} />
      <p className="text-xl font-bold mt-2 text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}