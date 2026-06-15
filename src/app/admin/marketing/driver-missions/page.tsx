"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Plus, RefreshCw, Trophy, Search, Filter, Power, Pencil,
  Trash2, X, Save, Target, MapPin, Coins
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type Mission = {
  id: string;
  title: string;
  description: string | null;
  mission_type: string;
  target_value: number;
  reward_amount: number;
  currency: string | null;
  city: string | null;
  is_active: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  created_at?: string;
};

const emptyForm = {
  title: "",
  description: "",
  mission_type: "trip_count",
  target_value: 10,
  reward_amount: 15000,
  currency: "MWK",
  city: "",
  is_active: true,
  starts_at: "",
  ends_at: "",
};

export default function DriverMissionsPage() {
  const [items, setItems] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [city, setCity] = useState("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Mission | null>(null);
  const [form, setForm] = useState<any>(emptyForm);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("driver_missions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) alert(error.message);
    setItems((data || []) as Mission[]);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(m: Mission) {
    setEditing(m);
    setForm({
      title: m.title || "",
      description: m.description || "",
      mission_type: m.mission_type || "trip_count",
      target_value: m.target_value || 0,
      reward_amount: m.reward_amount || 0,
      currency: m.currency || "MWK",
      city: m.city || "",
      is_active: m.is_active,
      starts_at: m.starts_at ? String(m.starts_at).slice(0, 16) : "",
      ends_at: m.ends_at ? String(m.ends_at).slice(0, 16) : "",
    });
    setModalOpen(true);
  }

  async function saveMission() {
    if (!form.title.trim()) return alert("Mission title is required");
    if (Number(form.target_value) <= 0) return alert("Target must be more than 0");

    setSaving(true);

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      mission_type: form.mission_type,
      target_value: Number(form.target_value),
      reward_amount: Number(form.reward_amount || 0),
      currency: form.currency || "MWK",
      city: form.city.trim() || null,
      is_active: Boolean(form.is_active),
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
    };

    const res = editing
      ? await supabase.from("driver_missions").update(payload).eq("id", editing.id)
      : await supabase.from("driver_missions").insert(payload);

    setSaving(false);

    if (res.error) return alert(res.error.message);

    setModalOpen(false);
    await load();
  }

  async function toggle(id: string, active: boolean) {
    const { error } = await supabase
      .from("driver_missions")
      .update({ is_active: !active })
      .eq("id", id);

    if (error) alert(error.message);
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this driver mission?")) return;

    const { error } = await supabase.from("driver_missions").delete().eq("id", id);
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
    return items.filter((m) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        m.title?.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.mission_type?.toLowerCase().includes(q);

      const matchesStatus =
        status === "all" ||
        (status === "active" && m.is_active) ||
        (status === "inactive" && !m.is_active);

      const missionCity = m.city || "All cities";
      const matchesCity = city === "all" || city === missionCity;

      return matchesSearch && matchesStatus && matchesCity;
    });
  }, [items, search, status, city]);

  const stats = useMemo(
    () => ({
      total: items.length,
      active: items.filter((i) => i.is_active).length,
      inactive: items.filter((i) => !i.is_active).length,
      rewards: items.reduce((s, i) => s + Number(i.reward_amount || 0), 0),
    }),
    [items]
  );

  return (
    <div className="min-h-screen bg-[#f6f7f9] p-6">
      <div className="mb-6 rounded-[28px] bg-gradient-to-r from-black via-zinc-900 to-[#c96b1c] p-6 text-white shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-orange-200">
              WeAfrica Ride
            </p>
            <h1 className="mt-2 text-3xl font-black">Driver Missions</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-300">
              Create and manage real driver missions shown in the Driver App Discover page.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={load}
              className="inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white ring-1 ring-white/20 hover:bg-white/20"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>

            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#f59e0b] px-5 py-3 text-sm font-black text-black hover:bg-[#fbbf24]"
            >
              <Plus className="h-4 w-4" />
              Create Mission
            </button>
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Stat icon={<Trophy className="h-5 w-5" />} label="Total Missions" value={stats.total} />
        <Stat icon={<Power className="h-5 w-5" />} label="Active" value={stats.active} />
        <Stat icon={<Target className="h-5 w-5" />} label="Inactive" value={stats.inactive} />
        <Stat icon={<Coins className="h-5 w-5" />} label="Total Rewards" value={`MWK ${stats.rewards.toLocaleString()}`} />
      </div>

      <div className="mb-6 rounded-[24px] border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px]">
          <div className="relative">
            <Search className="absolute left-4 top-3.5 h-4 w-4 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search mission title, type, description..."
              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 py-3 pl-11 pr-4 text-sm outline-none focus:border-orange-400"
            />
          </div>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none"
          >
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>

          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none"
          >
            {cities.map((c) => (
              <option key={c} value={c}>{c === "all" ? "All Cities" : c}</option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-zinc-300 bg-white p-12 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-orange-50 text-orange-600">
            <Trophy className="h-8 w-8" />
          </div>
          <h2 className="mt-4 text-xl font-black text-zinc-900">No missions found</h2>
          <p className="mt-2 text-sm text-zinc-500">
            Create a real mission to show it inside Driver App Discover.
          </p>
          <button
            onClick={openCreate}
            className="mt-6 rounded-2xl bg-black px-5 py-3 text-sm font-bold text-white hover:bg-zinc-800"
          >
            Create Mission
          </button>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filtered.map((m) => (
            <div key={m.id} className="rounded-[26px] border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-orange-600">
                    <Trophy className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-zinc-900">{m.title}</h3>
                    <p className="mt-1 text-sm text-zinc-500">{m.description || "No description"}</p>
                  </div>
                </div>

                <span className={`rounded-full px-3 py-1 text-xs font-black ${
                  m.is_active ? "bg-orange-100 text-orange-700" : "bg-zinc-100 text-zinc-500"
                }`}>
                  {m.is_active ? "ACTIVE" : "INACTIVE"}
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Mini label="Type" value={m.mission_type} />
                <Mini label="Target" value={m.target_value || 0} />
                <Mini label="Reward" value={`${m.reward_amount || 0} ${m.currency || "MWK"}`} />
                <Mini label="City" value={m.city || "All cities"} />
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button onClick={() => toggle(m.id, m.is_active)} className="rounded-2xl border border-zinc-200 px-4 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-50">
                  {m.is_active ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => openEdit(m)} className="inline-flex items-center gap-2 rounded-2xl bg-black px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800">
                  <Pencil className="h-4 w-4" />
                  Edit
                </button>
                <button onClick={() => remove(m.id)} className="inline-flex items-center gap-2 rounded-2xl border border-red-200 px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" />
                  Delete
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
                <h2 className="text-2xl font-black text-zinc-900">
                  {editing ? "Edit Mission" : "Create Mission"}
                </h2>
                <p className="text-sm text-zinc-500">This will appear in Driver App Discover.</p>
              </div>
              <button onClick={() => setModalOpen(false)} className="rounded-2xl bg-zinc-100 p-3 hover:bg-zinc-200">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Mission Title">
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input" placeholder="Complete 10 trips" />
              </Field>

              <Field label="Mission Type">
                <select value={form.mission_type} onChange={(e) => setForm({ ...form, mission_type: e.target.value })} className="input">
                  <option value="trip_count">Trip Count</option>
                  <option value="earnings">Earnings</option>
                  <option value="online_hours">Online Hours</option>
                  <option value="acceptance_rate">Acceptance Rate</option>
                  <option value="peak_hours">Peak Hours</option>
                </select>
              </Field>

              <Field label="Target Value">
                <input type="number" value={form.target_value} onChange={(e) => setForm({ ...form, target_value: Number(e.target.value) })} className="input" />
              </Field>

              <Field label="Reward Amount">
                <input type="number" value={form.reward_amount} onChange={(e) => setForm({ ...form, reward_amount: Number(e.target.value) })} className="input" />
              </Field>

              <Field label="Currency">
                <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="input" placeholder="MWK" />
              </Field>

              <Field label="City">
                <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="input" placeholder="Leave empty for all cities" />
              </Field>

              <Field label="Start Date">
                <input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} className="input" />
              </Field>

              <Field label="End Date">
                <input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} className="input" />
              </Field>

              <div className="md:col-span-2">
                <Field label="Description">
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input min-h-[100px]" placeholder="Explain what the driver must do..." />
                </Field>
              </div>

              <label className="flex items-center gap-3 rounded-2xl bg-zinc-50 p-4 text-sm font-bold text-zinc-700 md:col-span-2">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Mission is active
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setModalOpen(false)} className="rounded-2xl border border-zinc-200 px-5 py-3 text-sm font-bold">
                Cancel
              </button>
              <button onClick={saveMission} disabled={saving} className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-black hover:bg-orange-400 disabled:opacity-60">
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save Mission"}
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
