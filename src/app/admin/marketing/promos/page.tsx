"use client";
import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import { RefreshCw, Plus, X } from "lucide-react";
import type { PromoCode, PromoStatus } from "@/lib/types";

const STATUS_COLORS: Record<PromoStatus, string> = {
  active: "bg-orange-100 text-orange-700",
  scheduled: "bg-zinc-100 text-zinc-700",
  expired: "bg-gray-100 text-gray-500",
  disabled: "bg-zinc-200 text-zinc-800",
};

export default function PromosPage() {
  return (
    <PermissionGuard permission="manage_promotions">
      <PromosContent />
    </PermissionGuard>
  );
}

function PromosContent() {
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingPromo, setEditingPromo] = useState<PromoCode | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formCode, setFormCode] = useState("");
  const [formType, setFormType] = useState<"percentage" | "fixed" | "free_ride">("percentage");
  const [formValue, setFormValue] = useState("10");
  const [formMinOrder, setFormMinOrder] = useState("0");
  const [formMaxUses, setFormMaxUses] = useState("");
  const [formRecipient, setFormRecipient] = useState<"all" | "new_users" | "drivers" | "specific_users">("all");
  const [formStatus, setFormStatus] = useState<PromoStatus>("active");
  const [formExpires, setFormExpires] = useState("");
  const [formCities, setFormCities] = useState("");
  const [formVehicleTypes, setFormVehicleTypes] = useState("");
  const [formFirstRideOnly, setFormFirstRideOnly] = useState(false);

  const fetchPromos = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("promo_codes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        console.error("Fetch promos error:", error);
        alert(error.message);
        return;
      }

      setPromos((data as PromoCode[]) || []);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Failed to load promos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPromos(); }, [fetchPromos]);

  const openCreate = () => {
    setEditingPromo(null);
    setFormCode("");
    setFormType("percentage");
    setFormValue("10");
    setFormMinOrder("0");
    setFormMaxUses("");
    setFormRecipient("all");
    setFormStatus("active");
    setFormExpires("");
    setFormCities("");
    setFormVehicleTypes("");
    setFormFirstRideOnly(false);
    setShowForm(true);
  };

  const openEdit = (promo: PromoCode) => {
    setEditingPromo(promo);
    setFormCode(promo.code);
    setFormType(promo.type as "percentage" | "fixed");
    setFormValue(String(promo.value));
    setFormMinOrder(String(promo.min_order || 0));
    setFormMaxUses(promo.max_uses ? String(promo.max_uses) : "");
    setFormRecipient(promo.recipient_type as "all" | "new_users" | "drivers" | "specific_users");
    setFormStatus(promo.status);
    setFormExpires(promo.expires_at ? new Date(promo.expires_at).toISOString().split("T")[0] : "");
    setFormCities((promo.applicable_cities || []).join(", "));
    setFormVehicleTypes((promo.applicable_vehicle_types || []).join(", "));
    setFormFirstRideOnly(Boolean(promo.first_ride_only));
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formCode.trim()) return;
    setSaving(true);
    try {
      const payload = {
        code: formCode.trim().toUpperCase(),
        type: formType,
        value: parseFloat(formValue) || 0,
        min_order: parseFloat(formMinOrder) || 0,
        max_uses: formMaxUses ? parseInt(formMaxUses) : null,
        recipient_type: formRecipient,
        status: formStatus,
        expires_at: formExpires ? new Date(formExpires).toISOString() : null,
        applicable_cities: formCities.split(",").map((v) => v.trim()).filter(Boolean),
        applicable_vehicle_types: formVehicleTypes.split(",").map((v) => v.trim()).filter(Boolean),
        first_ride_only: formFirstRideOnly,
        updated_at: new Date().toISOString(),
      };

      const result = editingPromo
        ? await supabase.from("promo_codes").update(payload).eq("id", editingPromo.id)
        : await supabase
            .from("promo_codes")
            .insert({ ...payload, current_uses: 0, created_at: new Date().toISOString() });

      if (result.error) {
        console.error("Promo save error:", JSON.stringify(result.error, null, 2));
        alert(
          result.error.message ||
          result.error.details ||
          result.error.hint ||
          result.error.code ||
          JSON.stringify(result.error)
        );
        return;
      }

      setShowForm(false);
      fetchPromos();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (promo: PromoCode) => {
    const newStatus: PromoStatus = promo.status === "active" ? "disabled" : "active";
    try {
      await supabase.from("promo_codes").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", promo.id);
      fetchPromos();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Toggle failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Promo Codes</h1>
          <p className="text-sm text-gray-500 mt-1">Create and manage promotional campaigns</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchPromos} className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-zinc-950 text-white rounded-lg hover:bg-black text-sm">
            <Plus className="h-4 w-4" /> Create Promo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total" value={promos.length} />
        <StatCard label="Active" value={promos.filter((p) => p.status === "active").length} color="text-orange-600" />
        <StatCard label="Scheduled" value={promos.filter((p) => p.status === "scheduled").length} color="text-zinc-900" />
        <StatCard label="Expired" value={promos.filter((p) => p.status === "expired").length} color="text-gray-500" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Code</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Type</th>
              <th className="text-right px-4 py-3 font-medium text-gray-700">Value</th>
              <th className="text-center px-4 py-3 font-medium text-gray-700">Uses</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Targeting</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Expires</th>
              <th className="text-center px-4 py-3 font-medium text-gray-700">Status</th>
              <th className="text-center px-4 py-3 font-medium text-gray-700 w-24">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? <tr><td colSpan={8} className="p-6 text-center text-gray-400">Loading...</td></tr>
            : promos.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-gray-400">No promo codes found. Click Create Promo to add one.</td></tr>
            : promos.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono font-medium">{p.code}</td>
                <td className="px-4 py-3 text-gray-500 capitalize">{p.type.replace(/_/g, " ")}</td>
                <td className="px-4 py-3 text-right">{p.type === "percentage" ? `${p.value}%` : `MK ${p.value}`}</td>
                <td className="px-4 py-3 text-center">{p.current_uses}{p.max_uses ? ` / ${p.max_uses}` : ""}</td>
                <td className="px-4 py-3 text-gray-500"><div className="capitalize">{p.recipient_type.replace(/_/g, " ")}</div><div className="text-[11px] text-gray-400">{p.applicable_cities?.length ? p.applicable_cities.join(", ") : "All cities"} · {p.applicable_vehicle_types?.length ? p.applicable_vehicle_types.join(", ") : "All vehicles"}</div></td>
                <td className="px-4 py-3 text-gray-500">{p.expires_at ? new Date(p.expires_at).toLocaleDateString() : "Never"}</td>
                <td className="px-4 py-3 text-center"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status]}`}>{p.status}</span></td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => handleToggle(p)} className={`px-2 py-1 rounded text-xs font-medium ${p.status === "active" ? "bg-zinc-100 text-zinc-800 hover:bg-zinc-200" : "bg-orange-50 text-orange-600 hover:bg-orange-100"}`}>
                      {p.status === "active" ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => openEdit(p)} className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-600 hover:bg-gray-200">Edit</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── CREATE / EDIT MODAL ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-bold text-gray-900">{editingPromo ? "Edit Promo" : "Create Promo Code"}</h2>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5 text-gray-500" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Code *</label>
                <input value={formCode} onChange={(e) => setFormCode(e.target.value.toUpperCase())} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="e.g. WELCOME50" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                  <select value={formType} onChange={(e) => setFormType(e.target.value as "percentage" | "fixed")} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Fixed Amount (MK)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Value</label>
                  <input type="number" value={formValue} onChange={(e) => setFormValue(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={formType === "percentage" ? "10" : "500"} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Min Order (MK)</label>
                  <input type="number" value={formMinOrder} onChange={(e) => setFormMinOrder(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="0" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Max Uses (empty = unlimited)</label>
                  <input type="number" value={formMaxUses} onChange={(e) => setFormMaxUses(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Unlimited" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Target Audience</label>
                  <select value={formRecipient} onChange={(e) => setFormRecipient(e.target.value as "all")} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                    <option value="all">All Users</option>
                    <option value="new_users">New Users</option>
                    <option value="drivers">Drivers</option>
                    <option value="specific_users">Specific Users</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                  <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as PromoStatus)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                    <option value="active">Active</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="disabled">Disabled</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Expiry Date</label>
                <input type="date" value={formExpires} onChange={(e) => setFormExpires(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Applicable Cities</label>
                  <input value={formCities} onChange={(e) => setFormCities(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Cape Town, Lilongwe" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Vehicle Types</label>
                  <input value={formVehicleTypes} onChange={(e) => setFormVehicleTypes(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="WeAfrica Black, Standard" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                <input type="checkbox" checked={formFirstRideOnly} onChange={(e) => setFormFirstRideOnly(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
                First ride only
              </label>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowForm(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button onClick={handleSave} disabled={saving || !formCode.trim()} className="flex-1 py-2 bg-zinc-950 text-white rounded-lg text-sm hover:bg-black disabled:opacity-50">
                  {saving ? "Saving..." : editingPromo ? "Update Promo" : "Create Promo"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color = "text-gray-700" }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

