"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Gift, Search, Power, Pencil, Trash2, X, Save, Coins, Target } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Bonus = {
  id: string;
  country_code?: string | null;
  city?: string | null;
  incentive_type: string;
  incentive_label: string;
  description?: string | null;
  required_trips?: number | null;
  time_window_hours?: number | null;
  reward_amount?: number | null;
  reward_type?: string | null;
  is_active: boolean;
  created_at?: string;
};

const emptyForm = {
  country_code: "MW",
  city: "",
  incentive_type: "trip_bonus",
  incentive_label: "",
  description: "",
  required_trips: 10,
  time_window_hours: 24,
  reward_amount: 5000,
  reward_type: "bonus",
  is_active: true,
};

export default function DriverIncentivesPage() {
  const [items, setItems] = useState<Bonus[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [city, setCity] = useState("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Bonus | null>(null);
  const [form, setForm] = useState<any>(emptyForm);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("pricing_driver_incentives")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) alert(error.message);
    setItems((data || []) as Bonus[]);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(item: Bonus) {
    setEditing(item);
    setForm({
      country_code: item.country_code || "MW",
      city: item.city || "",
      incentive_type: item.incentive_type || "trip_bonus",
      incentive_label: item.incentive_label || "",
      description: item.description || "",
      required_trips: item.required_trips || 0,
      time_window_hours: item.time_window_hours || 24,
      reward_amount: item.reward_amount || 0,
      reward_type: item.reward_type || "bonus",
      is_active: item.is_active,
    });
    setModalOpen(true);
  }

  async function saveBonus() {
    if (!form.incentive_label.trim()) return alert("Bonus title is required");

    setSaving(true);

    const payload = {
      country_code: form.country_code || "MW",
      city: form.city.trim() || null,
      incentive_type: form.incentive_type,
      incentive_label: form.incentive_label.trim(),
      description: form.description.trim() || null,
      required_trips: Number(form.required_trips || 0),
      time_window_hours: Number(form.time_window_hours || 0),
      reward_amount: Number(form.reward_amount || 0),
      reward_type: form.reward_type || "bonus",
      is_active: Boolean(form.is_active),
    };

    const res = editing
      ? await supabase.from("pricing_driver_incentives").update(payload).eq("id", editing.id)
      : await supabase.from("pricing_driver_incentives").insert(payload);

    setSaving(false);

    if (res.error) return alert(res.error.message);

    setModalOpen(false);
    await load();
  }

  async function toggle(id: string, active: boolean) {
    const { error } = await supabase
      .from("pricing_driver_incentives")
      .update({ is_active: !active })
      .eq("id", id);

    if (error) alert(error.message);
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this driver bonus?")) return;

    const { error } = await supabase
      .from("pricing_driver_incentives")
      .delete()
      .eq("id", id);

    if (error) alert(error.message);
    await load();
  }

  useEffect(() => {
    load();
  }, []);

  const cities = useMemo(() => {
    const list = items.map((i) => i.city || "All cities");
    return ["all", ...Array.from(new Set(list))];
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        item.incentive_label?.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.incentive_type?.toLowerCase().includes(q);

      const matchesStatus =
        status === "all" ||
        (status === "active" && item.is_active) ||
        (status === "inactive" && !item.is_active);

      const itemCity = item.city || "All cities";
      const matchesCity = city === "all" || city === itemCity;

      return matchesSearch && matchesStatus && matchesCity;
    });
  }, [items, search, status, city]);

  const stats = useMemo(() => ({
    total: items.length,
    active: items.filter((i) => i.is_active).length,
    inactive: items.filter((i) => !i.is_active).length,
    rewards: items.reduce((s, i) => s + Number(i.reward_amount || 0), 0),
  }), [items]);

  return (
    <div className="min-h-screen bg-[#f6f7f9] p-6">
      <div className="mb-6 rounded-[28px] bg-gradient-to-r from-black via-zinc-900 to-[#c96b1c] p-6 text-white shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-orange-200">WeAfrica Ride</p>
            <h1 className="mt-2 text-3xl font-black">Driver Bonuses</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-300">
              Create and manage real bonuses shown in the Driver App Discover page.
            </p>
          </div>

          <div className="flex gap-3">
            <button onClick={load} className="inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white ring-1 ring-white/20 hover:bg-white/20">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-2xl bg-[#f59e0b] px-5 py-3 text-sm font-black text-black hover:bg-[#fbbf24]">
              <Plus className="h-4 w-4" /> Create Bonus
            </button>
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Stat icon={<Gift className="h-5 w-5" />} label="Total Bonuses" value={stats.total} />
        <Stat icon={<Power className="h-5 w-5" />} label="Active" value={stats.active} />
        <Stat icon={<Target className="h-5 w-5" />} label="Inactive" value={stats.inactive} />
        <Stat icon={<Coins className="h-5 w-5" />} label="Total Rewards" value={`MWK ${stats.rewards.toLocaleString()}`} />
      </div>

      <div className="mb-6 rounded-[24px] border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px]">
          <div className="relative">
            <Search className="absolute left-4 top-3.5 h-4 w-4 text-zinc-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search bonus title, type, description..." className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 py-3 pl-11 pr-4 text-sm outline-none focus:border-orange-400" />
          </div>

          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none">
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>

          <select value={city} onChange={(e) => setCity(e.target.value)} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none">
            {cities.map((c) => <option key={c} value={c}>{c === "all" ? "All Cities" : c}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-zinc-300 bg-white p-12 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-orange-50 text-orange-600">
            <Gift className="h-8 w-8" />
          </div>
          <h2 className="mt-4 text-xl font-black text-zinc-900">No bonuses found</h2>
          <p className="mt-2 text-sm text-zinc-500">Create a real driver bonus to show it inside Driver App Discover.</p>
          <button onClick={openCreate} className="mt-6 rounded-2xl bg-black px-5 py-3 text-sm font-bold text-white hover:bg-zinc-800">
            Create Bonus
          </button>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filtered.map((item) => (
            <div key={item.id} className="rounded-[26px] border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-orange-600">
                    <Gift className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-zinc-900">{item.incentive_label}</h3>
                    <p className="mt-1 text-sm text-zinc-500">{item.description || "No description"}</p>
                  </div>
                </div>

                <span className={`rounded-full px-3 py-1 text-xs font-black ${item.is_active ? "bg-orange-100 text-orange-700" : "bg-zinc-100 text-zinc-500"}`}>
                  {item.is_active ? "ACTIVE" : "INACTIVE"}
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Mini label="Type" value={item.incentive_type} />
                <Mini label="Trips" value={item.required_trips || 0} />
                <Mini label="Reward" value={`${item.reward_amount || 0} MWK`} />
                <Mini label="City" value={item.city || "All cities"} />
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button onClick={() => toggle(item.id, item.is_active)} className="rounded-2xl border border-zinc-200 px-4 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-50">
                  {item.is_active ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => openEdit(item)} className="inline-flex items-center gap-2 rounded-2xl bg-black px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800">
                  <Pencil className="h-4 w-4" /> Edit
                </button>
                <button onClick={() => remove(item.id)} className="inline-flex items-center gap-2 rounded-2xl border border-red-200 px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-[28px] bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black text-zinc-900">{editing ? "Edit Bonus" : "Create Bonus"}</h2>
                <p className="text-sm text-zinc-500">This will appear in Driver App Discover.</p>
              </div>
              <button onClick={() => setModalOpen(false)} className="rounded-2xl bg-zinc-100 p-3 hover:bg-zinc-200">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Bonus Title">
                <input value={form.incentive_label} onChange={(e) => setForm({ ...form, incentive_label: e.target.value })} className="input" placeholder="10 Trip Bonus" />
              </Field>

              <Field label="Bonus Type">
                <select value={form.incentive_type} onChange={(e) => setForm({ ...form, incentive_type: e.target.value })} className="input">
                  <option value="trip_bonus">Trip Bonus</option>
                  <option value="streak_bonus">Streak Bonus</option>
                  <option value="peak_bonus">Peak Bonus</option>
                  <option value="referral_bonus">Referral Bonus</option>
                  <option value="guarantee">Guarantee</option>
                </select>
              </Field>

              <Field label="Required Trips">
                <input type="number" value={form.required_trips} onChange={(e) => setForm({ ...form, required_trips: Number(e.target.value) })} className="input" />
              </Field>

              <Field label="Time Window Hours">
                <input type="number" value={form.time_window_hours} onChange={(e) => setForm({ ...form, time_window_hours: Number(e.target.value) })} className="input" />
              </Field>

              <Field label="Reward Amount">
                <input type="number" value={form.reward_amount} onChange={(e) => setForm({ ...form, reward_amount: Number(e.target.value) })} className="input" />
              </Field>

              <Field label="Reward Type">
                <select value={form.reward_type} onChange={(e) => setForm({ ...form, reward_type: e.target.value })} className="input">
                  <option value="bonus">Cash Bonus</option>
                  <option value="commission_discount">Commission Discount</option>
                  <option value="priority">Priority Access</option>
                </select>
              </Field>

              <Field label="Country Code">
                <input value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value })} className="input" placeholder="MW" />
              </Field>

              <Field label="City">
                <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="input" placeholder="Leave empty for all cities" />
              </Field>

              <div className="md:col-span-2">
                <Field label="Description">
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input min-h-[100px]" placeholder="Explain what the driver must do..." />
                </Field>
              </div>

              <label className="flex items-center gap-3 rounded-2xl bg-zinc-50 p-4 text-sm font-bold text-zinc-700 md:col-span-2">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Bonus is active
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setModalOpen(false)} className="rounded-2xl border border-zinc-200 px-5 py-3 text-sm font-bold">Cancel</button>
              <button onClick={saveBonus} disabled={saving} className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-black hover:bg-orange-400 disabled:opacity-60">
                <Save className="h-4 w-4" /> {saving ? "Saving..." : "Save Bonus"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 16px;
          border: 1px solid #e4e4e7;
          background: #fafafa;
          padding: 12px 14px;
          font-size: 14px;
          outline: none;
        }
        .input:focus {
          border-color: #f59e0b;
          background: white;
        }
      `}</style>
    </div>
  );
}

function Stat({ icon, label, value }: any) {
  return (
    <div className="rounded-[24px] border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="rounded-2xl bg-zinc-100 p-3 text-zinc-700">{icon}</div>
        <p className="text-2xl font-black text-zinc-900">{value}</p>
      </div>
      <p className="mt-3 text-sm font-bold text-zinc-500">{label}</p>
    </div>
  );
}

function Mini({ label, value }: any) {
  return (
    <div className="rounded-2xl bg-zinc-50 p-3">
      <p className="text-[11px] font-bold uppercase text-zinc-400">{label}</p>
      <p className="mt-1 truncate text-sm font-black text-zinc-900">{value}</p>
    </div>
  );
}

function Field({ label, children }: any) {
  return (
    <label className="block">
      <p className="mb-1.5 text-xs font-black uppercase tracking-wide text-zinc-500">{label}</p>
      {children}
    </label>
  );
}
