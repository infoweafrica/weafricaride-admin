"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Plus, Pencil, Trash2, X, RefreshCw, Car, ChevronRight } from "lucide-react";

const inputClass = "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100";

interface VehicleMake {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
}

interface VehicleModel {
  id: string;
  make_id: string;
  name: string;
  slug: string;
  vehicle_class_id: string | null;
  passenger_capacity: number | null;
  sort_order: number;
  is_active: boolean;
}

interface VehicleClass {
  id: string;
  name: string;
  slug: string;
}

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export default function VehicleCatalogPage() {
  const [makes, setMakes] = useState<VehicleMake[]>([]);
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [classes, setClasses] = useState<VehicleClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMakeId, setSelectedMakeId] = useState<string | null>(null);

  const [showMakeModal, setShowMakeModal] = useState(false);
  const [editingMake, setEditingMake] = useState<VehicleMake | null>(null);
  const [makeName, setMakeName] = useState("");

  const [showModelModal, setShowModelModal] = useState(false);
  const [editingModel, setEditingModel] = useState<VehicleModel | null>(null);
  const [modelName, setModelName] = useState("");
  const [modelClassId, setModelClassId] = useState("");
  const [modelCapacity, setModelCapacity] = useState("5");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: mk }, { data: md }, { data: cls }] = await Promise.all([
        supabase.from("vehicle_makes").select("*").order("sort_order"),
        supabase.from("vehicle_models").select("*").order("sort_order"),
        supabase.from("vehicle_classes").select("id, name, slug").order("sort_order"),
      ]);
      setMakes((mk || []) as VehicleMake[]);
      setModels((md || []) as VehicleModel[]);
      setClasses((cls || []) as VehicleClass[]);
      setSelectedMakeId((prev) => prev || ((mk || [])[0] as VehicleMake | undefined)?.id || null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const modelsForSelectedMake = useMemo(
    () => models.filter((m) => m.make_id === selectedMakeId),
    [models, selectedMakeId]
  );

  const classById = useMemo(() => {
    const map: Record<string, VehicleClass> = {};
    classes.forEach((c) => { map[c.id] = c; });
    return map;
  }, [classes]);

  // ── Makes ──
  const openCreateMake = () => {
    setEditingMake(null);
    setMakeName("");
    setShowMakeModal(true);
  };
  const openEditMake = (m: VehicleMake) => {
    setEditingMake(m);
    setMakeName(m.name);
    setShowMakeModal(true);
  };
  const saveMake = async () => {
    if (!makeName.trim()) return alert("Name is required.");
    const { error } = await supabase.rpc("admin_upsert_vehicle_make", {
      p_id: editingMake?.id || null,
      p_name: makeName.trim(),
      p_slug: editingMake?.slug || slugify(makeName),
      p_sort_order: editingMake?.sort_order ?? makes.length + 1,
      p_is_active: true,
    });
    if (error) return alert(error.message);
    setShowMakeModal(false);
    loadAll();
  };
  const deleteMake = async (m: VehicleMake) => {
    if (!confirm(`Delete "${m.name}" and all of its models?`)) return;
    const { error } = await supabase.rpc("admin_delete_vehicle_make", { p_id: m.id });
    if (error) return alert(error.message);
    if (selectedMakeId === m.id) setSelectedMakeId(null);
    loadAll();
  };

  // ── Models ──
  const openCreateModel = () => {
    if (!selectedMakeId) return;
    setEditingModel(null);
    setModelName("");
    setModelClassId("");
    setModelCapacity("5");
    setShowModelModal(true);
  };
  const openEditModel = (m: VehicleModel) => {
    setEditingModel(m);
    setModelName(m.name);
    setModelClassId(m.vehicle_class_id || "");
    setModelCapacity(String(m.passenger_capacity ?? 5));
    setShowModelModal(true);
  };
  const saveModel = async () => {
    if (!selectedMakeId) return;
    if (!modelName.trim()) return alert("Name is required.");
    const { error } = await supabase.rpc("admin_upsert_vehicle_model", {
      p_id: editingModel?.id || null,
      p_make_id: selectedMakeId,
      p_name: modelName.trim(),
      p_slug: editingModel?.slug || slugify(modelName),
      p_vehicle_class_id: modelClassId || null,
      p_passenger_capacity: Number(modelCapacity) || null,
      p_sort_order: editingModel?.sort_order ?? modelsForSelectedMake.length + 1,
      p_is_active: true,
    });
    if (error) return alert(error.message);
    setShowModelModal(false);
    loadAll();
  };
  const deleteModel = async (m: VehicleModel) => {
    if (!confirm(`Delete "${m.name}"?`)) return;
    const { error } = await supabase.rpc("admin_delete_vehicle_model", { p_id: m.id });
    if (error) return alert(error.message);
    loadAll();
  };

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-zinc-900">Vehicle Catalog</h1>
            <p className="text-sm text-zinc-500">
              Make → Model → Vehicle Class. Drivers pick a make and model at onboarding; the class (and its eligible services, configured on the Vehicle Classes page) resolves automatically.
            </p>
          </div>
          <button onClick={loadAll} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Makes column */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-zinc-900 text-sm">Makes</h2>
              <button onClick={openCreateMake} className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-2.5 py-1 text-xs font-bold text-white">
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-9 bg-gray-100 rounded-lg animate-pulse" />)}
              </div>
            ) : (
              <div className="space-y-1 max-h-[60vh] overflow-y-auto">
                {makes.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => setSelectedMakeId(m.id)}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm cursor-pointer ${selectedMakeId === m.id ? "bg-orange-50 text-orange-700 font-bold" : "hover:bg-zinc-50 text-zinc-700"}`}
                  >
                    <span className="flex items-center gap-2">
                      <Car className="h-3.5 w-3.5 opacity-60" /> {m.name}
                      <span className="text-xs text-zinc-400">({models.filter((mo) => mo.make_id === m.id).length})</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <button onClick={(e) => { e.stopPropagation(); openEditMake(m); }} className="p-1 hover:bg-white rounded"><Pencil className="h-3 w-3" /></button>
                      <button onClick={(e) => { e.stopPropagation(); deleteMake(m); }} className="p-1 hover:bg-white rounded text-red-500"><Trash2 className="h-3 w-3" /></button>
                      <ChevronRight className="h-3.5 w-3.5 opacity-40" />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Models column */}
          <div className="md:col-span-2 bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-zinc-900 text-sm">
                Models {selectedMakeId && <span className="text-zinc-400 font-normal">— {makes.find((m) => m.id === selectedMakeId)?.name}</span>}
              </h2>
              <button
                onClick={openCreateModel}
                disabled={!selectedMakeId}
                className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" /> Add Model
              </button>
            </div>
            {!selectedMakeId ? (
              <p className="text-sm text-zinc-400 py-8 text-center">Select a make to see its models.</p>
            ) : modelsForSelectedMake.length === 0 ? (
              <p className="text-sm text-zinc-400 py-8 text-center">No models yet for this make.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-400 border-b">
                    <th className="pb-2 font-medium">Model</th>
                    <th className="pb-2 font-medium">Vehicle Class</th>
                    <th className="pb-2 font-medium">Seats</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {modelsForSelectedMake.map((m) => (
                    <tr key={m.id} className="border-b border-zinc-50">
                      <td className="py-2 font-medium text-zinc-800">{m.name}</td>
                      <td className="py-2">
                        {m.vehicle_class_id && classById[m.vehicle_class_id] ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 font-medium">{classById[m.vehicle_class_id].name}</span>
                        ) : (
                          <span className="text-xs text-amber-600">Unassigned</span>
                        )}
                      </td>
                      <td className="py-2 text-zinc-500">{m.passenger_capacity ?? "—"}</td>
                      <td className="py-2 text-right">
                        <button onClick={() => openEditModel(m)} className="p-1 hover:bg-zinc-100 rounded mr-1"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => deleteModel(m)} className="p-1 hover:bg-zinc-100 rounded text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {showMakeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-black text-zinc-900">{editingMake ? "Edit Make" : "New Make"}</h2>
                <button onClick={() => setShowMakeModal(false)}><X className="h-5 w-5 text-zinc-400" /></button>
              </div>
              <label className="block mb-4">
                <span className="text-xs font-bold text-zinc-600">Name</span>
                <input className={inputClass} value={makeName} onChange={(e) => setMakeName(e.target.value)} placeholder="e.g. Toyota" />
              </label>
              <div className="flex gap-2">
                <button onClick={() => setShowMakeModal(false)} className="flex-1 rounded-xl border px-4 py-2 text-sm font-bold text-zinc-700">Cancel</button>
                <button onClick={saveMake} className="flex-1 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white">Save</button>
              </div>
            </div>
          </div>
        )}

        {showModelModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-black text-zinc-900">{editingModel ? "Edit Model" : "New Model"}</h2>
                <button onClick={() => setShowModelModal(false)}><X className="h-5 w-5 text-zinc-400" /></button>
              </div>
              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs font-bold text-zinc-600">Name</span>
                  <input className={inputClass} value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="e.g. Corolla" />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-zinc-600">Vehicle Class</span>
                  <select className={inputClass} value={modelClassId} onChange={(e) => setModelClassId(e.target.value)}>
                    <option value="">Unassigned (uses legacy fallback)</option>
                    {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-zinc-600">Passenger Capacity</span>
                  <input type="number" className={inputClass} value={modelCapacity} onChange={(e) => setModelCapacity(e.target.value)} />
                </label>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setShowModelModal(false)} className="flex-1 rounded-xl border px-4 py-2 text-sm font-bold text-zinc-700">Cancel</button>
                <button onClick={saveModel} className="flex-1 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white">Save</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
