"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { MapPin, Plus, Edit, Ban, CheckCircle, Search, Building2, X, Trash2 } from "lucide-react";

export default function CitiesPage() {
  const [cities, setCities] = useState<Record<string, unknown>[]>([]);
  const [countries, setCountries] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingCity, setEditingCity] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formRegion, setFormRegion] = useState("");
  const [formCountryId, setFormCountryId] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);

  async function loadCities() {
    try {
      const { data } = await supabase.from("cities").select("*, country:countries(name)").order("name");
      setCities((data as Record<string, unknown>[]) || []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function loadCountries() {
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc("admin_list_countries");
      if (!rpcErr && rpcData) { setCountries(rpcData as Record<string, unknown>[]); return; }
      const { data } = await supabase.from("countries").select("id, name, code").order("name");
      setCountries((data as Record<string, unknown>[]) || []);
    } catch { /* ignore */ }
  }

  useEffect(() => { loadCities(); loadCountries(); }, []);

  function openCreate() {
    setEditingCity(null); setFormName(""); setFormRegion("");
    setFormCountryId(countries.length > 0 ? (countries[0].id as string) : "");
    setFormIsActive(true); setError(null); setShowModal(true);
  }

  function openEdit(c: Record<string, unknown>) {
    setEditingCity(c);
    setFormName((c.name as string) || "");
    setFormRegion((c.region as string) || "");
    setFormCountryId((c.country_id as string) || "");
    setFormIsActive((c.is_active as boolean) ?? true);
    setError(null); setShowModal(true);
  }

  async function handleSave() {
    if (!formName.trim()) { setError("City name is required"); return; }
    setSaving(true); setError(null);
    try {
      if (editingCity) {
        // Try RPC first (bypasses RLS)
        const { error: rpcErr } = await supabase.rpc("admin_update_city", {
          p_city_id: editingCity.id,
          p_name: formName.trim() || null,
          p_region: formRegion.trim() || null,
          p_country_id: formCountryId || null,
          p_is_active: formIsActive,
        });
        if (rpcErr) {
          // Fallback: direct update
          const { error: directErr } = await supabase.from("cities").update({
            name: formName.trim(), region: formRegion.trim() || null,
            country_id: formCountryId || null, is_active: formIsActive,
          }).eq("id", editingCity.id as string);
          if (directErr) { setError("Permission denied: " + directErr.message); setSaving(false); return; }
        }
      } else {
        // Try RPC first (bypasses RLS)
        const { error: rpcErr } = await supabase.rpc("admin_create_city", {
          p_name: formName.trim(), p_region: formRegion.trim() || null,
          p_country_id: formCountryId || null, p_is_active: formIsActive,
        });
        if (rpcErr) {
          // Fallback: direct insert
          const { error: directErr } = await supabase.from("cities").insert({
            name: formName.trim(), region: formRegion.trim() || null,
            country_id: formCountryId || null, is_active: formIsActive,
          });
          if (directErr) { setError("Permission denied: " + directErr.message); setSaving(false); return; }
        }
      }
      setShowModal(false); loadCities();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally { setSaving(false); }
  }

  async function toggleActive(c: Record<string, unknown>) {
    const newStatus = !(c.is_active as boolean);
    const { error: rpcErr } = await supabase.rpc("admin_update_city", {
      p_city_id: c.id, p_is_active: newStatus,
    });
    if (rpcErr) {
      await supabase.from("cities").update({ is_active: newStatus }).eq("id", c.id as string);
    }
    loadCities();
  }

  async function handleDelete(c: Record<string, unknown>) {
    if (!confirm(`Delete ${c.name}?`)) return;
    const { error: rpcErr } = await supabase.rpc("admin_delete_city", { p_city_id: c.id });
    if (rpcErr) {
      await supabase.from("cities").delete().eq("id", c.id as string);
    }
    loadCities();
  }

  const q = search.toLowerCase();
  const filtered = cities.filter(c =>
    !search || ((c.name as string||"").toLowerCase().includes(q) || (c.region as string||"").toLowerCase().includes(q))
  );
  const active = cities.filter(c => c.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Cities & Regions</h1><p className="text-gray-500 mt-1">Manage cities where WeAfrica operates</p></div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"><Plus className="h-4 w-4"/> Add City</button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-400">Total</p><p className="text-xl font-bold mt-1">{cities.length}</p></div>
        <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-400">Active</p><p className="text-xl font-bold mt-1 text-green-600">{active}</p></div>
        <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-400">Inactive</p><p className="text-xl font-bold mt-1">{cities.length - active}</p></div>
      </div>
      <div className="bg-white rounded-xl border p-4">
        <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"/>
          <input type="text" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"/>
        </div>
      </div>
      <div className="bg-white rounded-xl border overflow-hidden">
        {loading ? <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"/></div> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 bg-gray-50 border-b"><th className="px-6 py-3 font-medium">City</th><th className="px-6 py-3 font-medium">Country</th><th className="px-6 py-3 font-medium">Region</th><th className="px-6 py-3 font-medium">Status</th><th className="px-6 py-3 font-medium text-right">Actions</th></tr></thead>
            <tbody>
              {filtered.map(c=>(
                <tr key={c.id as string} className="border-b hover:bg-gray-50">
                  <td className="px-6 py-4"><div className="flex items-center gap-3"><div className="p-2 bg-teal-50 rounded-lg"><Building2 className="h-5 w-5 text-teal-600"/></div><span className="font-medium">{c.name as string}</span></div></td>
                  <td className="px-6 py-4 text-xs">{(c.country as Record<string, unknown>)?.name as string || "—"}</td>
                  <td className="px-6 py-4 text-xs text-gray-500">{c.region as string || "—"}</td>
                  <td className="px-6 py-4"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${c.is_active?"bg-green-100 text-green-800":"bg-gray-100 text-gray-600"}`}>{c.is_active?"Active":"Inactive"}</span></td>
                  <td className="px-6 py-4 text-right"><div className="flex items-center justify-end gap-1">
                    <button onClick={()=>openEdit(c)} className="p-1.5 hover:bg-gray-100 rounded text-gray-500"><Edit className="h-4 w-4"/></button>
                    <button onClick={()=>toggleActive(c)} className="p-1.5 hover:bg-gray-100 rounded">{c.is_active ? <Ban className="h-4 w-4 text-amber-500"/> : <CheckCircle className="h-4 w-4 text-green-500"/>}</button>
                    <button onClick={()=>handleDelete(c)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 className="h-4 w-4"/></button>
                  </div></td>
                </tr>
              ))}
              {filtered.length===0 && <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400">No cities found</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md mx-4 p-6 space-y-4">
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{editingCity?"Edit":"Add"} City</h2><button onClick={()=>setShowModal(false)} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5"/></button></div>
            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
            <div className="space-y-3">
              <div><label className="block text-xs font-medium text-gray-600 mb-1">City Name</label><input type="text" value={formName} onChange={e=>setFormName(e.target.value)} placeholder="e.g. Blantyre" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-green-500"/></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Region</label><input type="text" value={formRegion} onChange={e=>setFormRegion(e.target.value)} placeholder="e.g. Southern Region" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-green-500"/></div>
              {countries.length > 0 && (
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Country</label>
                  <select value={formCountryId} onChange={e=>setFormCountryId(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                    <option value="">None</option>
                    {countries.map(c=>(<option key={c.id as string} value={c.id as string}>{c.name as string} ({c.code as string})</option>))}
                  </select>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={formIsActive} onChange={e=>setFormIsActive(e.target.checked)} className="rounded border-gray-300 text-green-600"/> Active</label>
            </div>
            <div className="flex gap-2 pt-2"><button onClick={()=>setShowModal(false)} className="flex-1 px-4 py-2 border rounded-lg text-sm font-medium">Cancel</button><button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">{saving?"Saving...":editingCity?"Save Changes":"Add City"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}