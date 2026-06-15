"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Globe, Plus, Edit, Ban, CheckCircle, Search, X, Trash2 } from "lucide-react";

export default function CountriesPage() {
  const [countries, setCountries] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingCountry, setEditingCountry] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formCurrency, setFormCurrency] = useState("");
  const [formPhoneCode, setFormPhoneCode] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);

  async function loadCountries() {
    try {
      // Use RPC to bypass RLS for admin
      const { data, error: rpcErr } = await supabase.rpc("admin_list_countries");
      if (!rpcErr && data) {
        setCountries(data as Record<string, unknown>[]);
        setLoading(false);
        return;
      }
      // Fallback: direct query
      const { data: fallback } = await supabase.from("countries").select("*").order("name");
      setCountries((fallback as Record<string, unknown>[]) || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCountries(); }, []);

  function openCreate() {
    setEditingCountry(null);
    setFormName(""); setFormCode(""); setFormCurrency("MWK"); setFormPhoneCode("+265");
    setFormIsActive(true); setError(null); setShowModal(true);
  }

  function openEdit(c: Record<string, unknown>) {
    setEditingCountry(c);
    setFormName((c.name as string) || "");
    setFormCode((c.code as string) || "");
    setFormCurrency((c.currency as string) || "MWK");
    setFormPhoneCode((c.phone_code as string) || "");
    setFormIsActive((c.is_active as boolean) ?? true);
    setError(null); setShowModal(true);
  }

  async function handleSave() {
    if (!formName.trim() || !formCode.trim()) { setError("Name and code are required"); return; }
    setSaving(true); setError(null);
    try {
      if (editingCountry) {
        await supabase.from("countries").update({
          name: formName.trim(), code: formCode.trim().toUpperCase(),
          currency: formCurrency.trim().toUpperCase(), phone_code: formPhoneCode.trim(),
          is_active: formIsActive,
        }).eq("id", editingCountry.id as string);
      } else {
        await supabase.from("countries").insert({
          name: formName.trim(), code: formCode.trim().toUpperCase(),
          currency: formCurrency.trim().toUpperCase(), phone_code: formPhoneCode.trim(),
          is_active: formIsActive,
        });
      }
      setShowModal(false); loadCountries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally { setSaving(false); }
  }

  async function toggleActive(c: Record<string, unknown>) {
    await supabase.from("countries").update({ is_active: !(c.is_active as boolean) }).eq("id", c.id as string);
    loadCountries();
  }

  async function handleDelete(c: Record<string, unknown>) {
    if (!confirm(`Delete ${c.name}?`)) return;
    await supabase.from("countries").delete().eq("id", c.id as string);
    loadCountries();
  }

  const q = search.toLowerCase();
  const filtered = countries.filter(c =>
    !search || ((c.name as string||"").toLowerCase().includes(q) || (c.code as string||"").toLowerCase().includes(q))
  );
  const active = countries.filter(c => c.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Countries</h1><p className="text-gray-500 mt-1">Manage supported countries</p></div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"><Plus className="h-4 w-4"/> Add Country</button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-400">Total</p><p className="text-xl font-bold mt-1">{countries.length}</p></div>
        <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-400">Active</p><p className="text-xl font-bold mt-1 text-green-600">{active}</p></div>
        <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-400">Inactive</p><p className="text-xl font-bold mt-1">{countries.length - active}</p></div>
      </div>
      <div className="bg-white rounded-xl border p-4">
        <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"/>
          <input type="text" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"/>
        </div>
      </div>
      <div className="bg-white rounded-xl border overflow-hidden">
        {loading ? <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"/></div> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 bg-gray-50 border-b"><th className="px-6 py-3 font-medium">Country</th><th className="px-6 py-3 font-medium">Code</th><th className="px-6 py-3 font-medium">Currency</th><th className="px-6 py-3 font-medium">Phone</th><th className="px-6 py-3 font-medium">Status</th><th className="px-6 py-3 font-medium text-right">Actions</th></tr></thead>
            <tbody>
              {filtered.map(c=>(
                <tr key={c.id as string} className="border-b hover:bg-gray-50">
                  <td className="px-6 py-4"><div className="flex items-center gap-3"><div className="p-2 bg-blue-50 rounded-lg"><Globe className="h-5 w-5 text-blue-600"/></div><span className="font-medium">{c.name as string}</span></div></td>
                  <td className="px-6 py-4 font-mono text-xs">{c.code as string}</td>
                  <td className="px-6 py-4 text-xs">{c.currency as string||"MWK"}</td>
                  <td className="px-6 py-4 text-xs">{c.phone_code as string}</td>
                  <td className="px-6 py-4"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${c.is_active?"bg-green-100 text-green-800":"bg-gray-100 text-gray-600"}`}>{c.is_active?"Active":"Inactive"}</span></td>
                  <td className="px-6 py-4 text-right"><div className="flex items-center justify-end gap-1">
                    <button onClick={()=>openEdit(c)} className="p-1.5 hover:bg-gray-100 rounded text-gray-500"><Edit className="h-4 w-4"/></button>
                    <button onClick={()=>toggleActive(c)} className="p-1.5 hover:bg-gray-100 rounded">{c.is_active ? <Ban className="h-4 w-4 text-amber-500"/> : <CheckCircle className="h-4 w-4 text-green-500"/>}</button>
                    <button onClick={()=>handleDelete(c)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 className="h-4 w-4"/></button>
                  </div></td>
                </tr>
              ))}
              {filtered.length===0 && <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-400">No countries found</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md mx-4 p-6 space-y-4">
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{editingCountry?"Edit":"Add"} Country</h2><button onClick={()=>setShowModal(false)} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5"/></button></div>
            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
            <div className="space-y-3">
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Name *</label><input type="text" value={formName} onChange={e=>setFormName(e.target.value)} placeholder="e.g. Malawi" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-green-500"/></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Code *</label><input type="text" value={formCode} onChange={e=>setFormCode(e.target.value)} placeholder="e.g. MW" maxLength={3} className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:ring-2 focus:ring-green-500"/></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Currency</label><input type="text" value={formCurrency} onChange={e=>setFormCurrency(e.target.value)} placeholder="e.g. MWK" maxLength={3} className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:ring-2 focus:ring-green-500"/></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Phone Code</label><input type="text" value={formPhoneCode} onChange={e=>setFormPhoneCode(e.target.value)} placeholder="e.g. +265" className="w-full px-3 py-2 border rounded-lg text-sm"/></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={formIsActive} onChange={e=>setFormIsActive(e.target.checked)} className="rounded border-gray-300 text-green-600"/> Active</label>
            </div>
            <div className="flex gap-2 pt-2"><button onClick={()=>setShowModal(false)} className="flex-1 px-4 py-2 border rounded-lg text-sm font-medium">Cancel</button><button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">{saving?"Saving...":editingCountry?"Save Changes":"Add Country"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}