"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Plus, Pencil, Trash2, X, RefreshCw, Car } from "lucide-react";

const inputClass = "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100";

interface VehicleClass {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

interface RideCategory {
  slug: string;
  name: string;
}

interface EligibilityRow {
  vehicle_class_id: string;
  ride_category_slug: string;
  priority: number;
}

export default function VehicleClassesPage() {
  const [classes, setClasses] = useState<VehicleClass[]>([]);
  const [rideCategories, setRideCategories] = useState<RideCategory[]>([]);
  const [eligibility, setEligibility] = useState<EligibilityRow[]>([]);
  const [vehicleCounts, setVehicleCounts] = useState<Record<string, number>>({});
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [editingClass, setEditingClass] = useState<VehicleClass | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [selectedTiers, setSelectedTiers] = useState<Record<string, string>>({}); // slug -> priority string

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: cls }, { data: cats }, { data: elig }, { data: vehicles }] = await Promise.all([
        supabase.from("vehicle_classes").select("*").order("sort_order"),
        supabase.from("ride_categories").select("slug, name").eq("is_active", true).order("sort_order"),
        supabase.from("vehicle_class_eligibility").select("vehicle_class_id, ride_category_slug, priority"),
        supabase.from("vehicles").select("vehicle_class_id"),
      ]);
      setClasses((cls || []) as VehicleClass[]);
      setRideCategories((cats || []) as RideCategory[]);
      setEligibility((elig || []) as EligibilityRow[]);

      const counts: Record<string, number> = {};
      let unassigned = 0;
      (vehicles || []).forEach((v: { vehicle_class_id: string | null }) => {
        if (v.vehicle_class_id) counts[v.vehicle_class_id] = (counts[v.vehicle_class_id] || 0) + 1;
        else unassigned += 1;
      });
      setVehicleCounts(counts);
      setUnassignedCount(unassigned);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const resetForm = () => {
    setEditingClass(null);
    setName("");
    setSlug("");
    setDescription("");
    setSortOrder("0");
    setIsActive(true);
    setSelectedTiers({});
  };

  const openCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const openEdit = (c: VehicleClass) => {
    setEditingClass(c);
    setName(c.name);
    setSlug(c.slug);
    setDescription(c.description || "");
    setSortOrder(String(c.sort_order));
    setIsActive(c.is_active);
    const tiers: Record<string, string> = {};
    eligibility
      .filter((e) => e.vehicle_class_id === c.id)
      .forEach((e) => { tiers[e.ride_category_slug] = String(e.priority); });
    setSelectedTiers(tiers);
    setShowModal(true);
  };

  const toggleTier = (catSlug: string) => {
    setSelectedTiers((prev) => {
      const next = { ...prev };
      if (catSlug in next) delete next[catSlug];
      else next[catSlug] = String(Object.keys(prev).length + 1);
      return next;
    });
  };

  const save = async () => {
    if (!name.trim() || !slug.trim()) return alert("Name and slug are required.");
    const { data, error } = await supabase.rpc("admin_upsert_vehicle_class", {
      p_id: editingClass?.id || null,
      p_name: name.trim(),
      p_slug: slug.trim(),
      p_description: description.trim() || null,
      p_sort_order: Number(sortOrder) || 0,
      p_is_active: isActive,
    });
    if (error) return alert(error.message);

    const classId = editingClass?.id || (data as { id: string })?.id;
    const eligibilityPayload = Object.entries(selectedTiers).map(([ride_category_slug, priority]) => ({
      ride_category_slug,
      priority: Number(priority) || 0,
    }));
    const { error: eligError } = await supabase.rpc("admin_upsert_vehicle_class_eligibility", {
      p_vehicle_class_id: classId,
      p_eligibility: eligibilityPayload,
    });
    if (eligError) return alert(eligError.message);

    setShowModal(false);
    resetForm();
    loadAll();
  };

  const deleteClass = async (c: VehicleClass) => {
    if (!confirm(`Delete "${c.name}"? Vehicles assigned to it will become unassigned, not broken — they'll fall back to default eligibility.`)) return;
    const { error } = await supabase.rpc("admin_delete_vehicle_class", { p_id: c.id });
    if (error) return alert(error.message);
    loadAll();
  };

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-zinc-900">Vehicle Classes</h1>
            <p className="text-sm text-zinc-500">
              Define vehicle classes and which ride categories each is eligible for. Vehicles with no class assigned keep working via the built-in default.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadAll} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white">
              <Plus className="h-4 w-4" /> New Class
            </button>
          </div>
        </div>

        {unassignedCount > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <strong>{unassignedCount}</strong> vehicle{unassignedCount === 1 ? "" : "s"} not assigned to any class — using the built-in default eligibility. Assign a class from the Vehicles page to make them admin-configurable.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading ? (
            [1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
                <div className="h-8 bg-gray-200 rounded w-16" />
              </div>
            ))
          ) : (
            classes.map((c) => {
              const tiers = eligibility
                .filter((e) => e.vehicle_class_id === c.id)
                .sort((a, b) => a.priority - b.priority);
              return (
                <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-orange-50 rounded-lg"><Car className="h-5 w-5 text-orange-600" /></div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{c.name}</h3>
                        <p className="text-xs text-gray-400">{c.slug}</p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {c.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  {c.description && <p className="text-xs text-gray-500 mb-3">{c.description}</p>}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {tiers.length === 0 ? (
                      <span className="text-xs text-gray-400">No ride categories configured</span>
                    ) : tiers.map((t) => (
                      <span key={t.ride_category_slug} className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 font-medium">
                        {t.priority}. {t.ride_category_slug}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mb-3">{vehicleCounts[c.id] || 0} vehicle{(vehicleCounts[c.id] || 0) === 1 ? "" : "s"} assigned</p>
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(c)} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold text-zinc-700 hover:bg-zinc-50">
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button onClick={() => deleteClass(c)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-black text-zinc-900">{editingClass ? "Edit Vehicle Class" : "New Vehicle Class"}</h2>
                <button onClick={() => { setShowModal(false); resetForm(); }}><X className="h-5 w-5 text-zinc-400" /></button>
              </div>
              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs font-bold text-zinc-600">Name</span>
                  <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard Sedan" />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-zinc-600">Slug</span>
                  <input className={inputClass} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. standard_sedan" />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-zinc-600">Description</span>
                  <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-bold text-zinc-600">Sort Order</span>
                    <input type="number" className={inputClass} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
                  </label>
                  <label className="flex items-center gap-2 pt-6">
                    <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                    <span className="text-sm font-medium text-zinc-700">Active</span>
                  </label>
                </div>

                <div>
                  <span className="text-xs font-bold text-zinc-600">Eligible ride categories</span>
                  <p className="text-xs text-zinc-400 mb-2">Check the ones this vehicle class qualifies for. The number shown is priority order (editable after checking).</p>
                  <div className="space-y-1.5">
                    {rideCategories.map((cat) => {
                      const checked = cat.slug in selectedTiers;
                      return (
                        <div key={cat.slug} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5">
                          <input type="checkbox" checked={checked} onChange={() => toggleTier(cat.slug)} />
                          <span className="flex-1 text-sm text-zinc-700">{cat.name}</span>
                          {checked && (
                            <input
                              type="number"
                              className="w-14 rounded-md border border-zinc-200 px-2 py-1 text-xs"
                              value={selectedTiers[cat.slug]}
                              onChange={(e) => setSelectedTiers((prev) => ({ ...prev, [cat.slug]: e.target.value }))}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => { setShowModal(false); resetForm(); }} className="flex-1 rounded-xl border px-4 py-2 text-sm font-bold text-zinc-700">Cancel</button>
                <button onClick={save} className="flex-1 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white">Save</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
