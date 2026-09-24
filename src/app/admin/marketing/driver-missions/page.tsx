"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  RefreshCw,
  Trophy,
  Search,
  Power,
  Pencil,
  Trash2,
  X,
  Save,
  Target,
  Coins,
  CalendarDays,
  MapPin,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import PermissionGuard from "@/components/guards/PermissionGuard";

type Mission = {
  id: string;
  title: string;
  description: string | null;
  mission_type: string | null;
  target_value: number | null;
  reward_amount: number | null;
  currency: string | null;
  city: string | null;
  is_active: boolean | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string | null;
};

type MissionForm = {
  title: string;
  description: string;
  mission_type: string;
  target_value: number;
  reward_amount: number;
  currency: string;
  city: string;
  is_active: boolean;
  starts_at: string;
  ends_at: string;
};

const emptyForm: MissionForm = {
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

const missionTypeLabels: Record<string, string> = {
  trip_count: "Trip Count",
  earnings: "Earnings",
  online_hours: "Online Hours",
  acceptance_rate: "Acceptance Rate",
  peak_hours: "Peak Hours",
};

export default function DriverMissionsPage() {
  return (
    <PermissionGuard permission="manage_promotions">
      <DriverMissionsPageInner />
    </PermissionGuard>
  );
}

function DriverMissionsPageInner() {
  const [items, setItems] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [city, setCity] = useState("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Mission | null>(null);
  const [form, setForm] = useState<MissionForm>(emptyForm);

  async function load() {
    setLoading(true);

    const { data, error } = await supabase
      .from("driver_missions")
      .select(
        "id,title,description,mission_type,target_value,reward_amount,currency,city,is_active,starts_at,ends_at,created_at"
      )
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      setItems([]);
    } else {
      setItems((data || []) as Mission[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm });
    setModalOpen(true);
  }

  function openEdit(mission: Mission) {
    setEditing(mission);

    setForm({
      title: mission.title || "",
      description: mission.description || "",
      mission_type: mission.mission_type || "trip_count",
      target_value: Number(mission.target_value || 0),
      reward_amount: Number(mission.reward_amount || 0),
      currency: mission.currency || "MWK",
      city: mission.city || "",
      is_active: Boolean(mission.is_active),
      starts_at: toDateTimeLocal(mission.starts_at),
      ends_at: toDateTimeLocal(mission.ends_at),
    });

    setModalOpen(true);
  }

  async function saveMission() {
    const title = form.title.trim();
    const target = Number(form.target_value);
    const reward = Number(form.reward_amount);

    if (!title) {
      alert("Mission title is required.");
      return;
    }

    if (!Number.isFinite(target) || target <= 0) {
      alert("Target must be greater than 0.");
      return;
    }

    if (!Number.isFinite(reward) || reward < 0) {
      alert("Reward amount cannot be negative.");
      return;
    }

    if (
      form.starts_at &&
      form.ends_at &&
      new Date(form.ends_at).getTime() <= new Date(form.starts_at).getTime()
    ) {
      alert("End date must be after the start date.");
      return;
    }

    setSaving(true);

    const payload = {
      title,
      description: form.description.trim() || null,
      mission_type: form.mission_type,
      target_value: target,
      reward_amount: reward,
      currency: form.currency.trim() || "MWK",
      city: form.city.trim() || null,
      is_active: Boolean(form.is_active),
      starts_at: form.starts_at
        ? new Date(form.starts_at).toISOString()
        : null,
      ends_at: form.ends_at
        ? new Date(form.ends_at).toISOString()
        : null,
    };

    const result = editing
      ? await supabase
          .from("driver_missions")
          .update(payload)
          .eq("id", editing.id)
      : await supabase.from("driver_missions").insert(payload);

    setSaving(false);

    if (result.error) {
      alert(result.error.message);
      return;
    }

    setModalOpen(false);
    setEditing(null);
    await load();
  }

  async function toggleMission(mission: Mission) {
    const { error } = await supabase
      .from("driver_missions")
      .update({ is_active: !mission.is_active })
      .eq("id", mission.id);

    if (error) {
      alert(error.message);
      return;
    }

    await load();
  }

  async function removeMission(mission: Mission) {
    if (
      !confirm(
        `Delete "${mission.title}"?\n\nThis permanently removes the mission.`
      )
    ) {
      return;
    }

    const { error } = await supabase
      .from("driver_missions")
      .delete()
      .eq("id", mission.id);

    if (error) {
      alert(error.message);
      return;
    }

    await load();
  }

  const cities = useMemo(() => {
    const unique = Array.from(
      new Set(items.map((item) => item.city).filter(Boolean) as string[])
    );

    return ["all", ...unique.sort()];
  }, [items]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const query = search.trim().toLowerCase();

    return items.filter((mission) => {
      const matchesSearch =
        !query ||
        mission.title.toLowerCase().includes(query) ||
        mission.description?.toLowerCase().includes(query) ||
        mission.mission_type?.toLowerCase().includes(query);

      const start = mission.starts_at
        ? new Date(mission.starts_at).getTime()
        : null;

      const end = mission.ends_at
        ? new Date(mission.ends_at).getTime()
        : null;

      const isExpired =
        Boolean(end && end < now) || mission.is_active === false;

      const isScheduled =
        Boolean(start && start > now) && mission.is_active !== false;

      const isCurrentlyActive =
        mission.is_active !== false &&
        (!start || start <= now) &&
        (!end || end >= now);

      const matchesStatus =
        status === "all" ||
        (status === "active" && isCurrentlyActive) ||
        (status === "scheduled" && isScheduled) ||
        (status === "expired" && isExpired);

      const matchesCity =
        city === "all" || (mission.city || "") === city;

      return matchesSearch && matchesStatus && matchesCity;
    });
  }, [items, search, status, city]);

  const stats = useMemo(() => {
    const now = Date.now();

    const active = items.filter((mission) => {
      const start = mission.starts_at
        ? new Date(mission.starts_at).getTime()
        : null;
      const end = mission.ends_at
        ? new Date(mission.ends_at).getTime()
        : null;

      return (
        mission.is_active !== false &&
        (!start || start <= now) &&
        (!end || end >= now)
      );
    }).length;

    const scheduled = items.filter((mission) => {
      const start = mission.starts_at
        ? new Date(mission.starts_at).getTime()
        : null;

      return Boolean(start && start > now) && mission.is_active !== false;
    }).length;

    const expired = items.filter((mission) => {
      const end = mission.ends_at
        ? new Date(mission.ends_at).getTime()
        : null;

      return Boolean(end && end < now) || mission.is_active === false;
    }).length;

    const rewards = items.reduce(
      (sum, mission) => sum + Number(mission.reward_amount || 0),
      0
    );

    return {
      total: items.length,
      active,
      scheduled,
      expired,
      rewards,
    };
  }, [items]);

  return (
    <div className="min-h-screen bg-[#f6f7f9] p-6">
      <div className="mb-6 overflow-hidden rounded-[28px] bg-black p-6 text-white shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-green-400">
              WeAfrica Ride
            </p>

            <h1 className="mt-2 text-3xl font-black">Driver Missions</h1>

            <p className="mt-2 max-w-2xl text-sm text-zinc-300">
              Create and manage driver missions shown in the Driver App.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white ring-1 ring-white/20 transition hover:bg-white/20 disabled:opacity-60"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </button>

            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-2xl bg-green-500 px-5 py-3 text-sm font-black text-black transition hover:bg-green-400"
            >
              <Plus className="h-4 w-4" />
              Create Mission
            </button>
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          icon={<Trophy className="h-5 w-5" />}
          label="Total Missions"
          value={stats.total}
        />

        <Stat
          icon={<Power className="h-5 w-5" />}
          label="Active Now"
          value={stats.active}
        />

        <Stat
          icon={<CalendarDays className="h-5 w-5" />}
          label="Scheduled"
          value={stats.scheduled}
        />

        <Stat
          icon={<Target className="h-5 w-5" />}
          label="Expired / Off"
          value={stats.expired}
        />

        <Stat
          icon={<Coins className="h-5 w-5" />}
          label="Configured Rewards"
          value={`MWK ${stats.rewards.toLocaleString()}`}
        />
      </div>

      <div className="mb-6 rounded-[24px] border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px]">
          <div className="relative">
            <Search className="absolute left-4 top-3.5 h-4 w-4 text-zinc-400" />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search missions..."
              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-green-500 focus:bg-white"
            />
          </div>

          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:border-green-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active Now</option>
            <option value="scheduled">Scheduled</option>
            <option value="expired">Expired / Off</option>
          </select>

          <select
            value={city}
            onChange={(event) => setCity(event.target.value)}
            className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:border-green-500"
          >
            {cities.map((item) => (
              <option key={item} value={item}>
                {item === "all" ? "All Cities" : item}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="rounded-[28px] border border-zinc-200 bg-white p-12 text-center shadow-sm">
          <RefreshCw className="mx-auto h-8 w-8 animate-spin text-green-500" />
          <p className="mt-4 text-sm font-bold text-zinc-500">
            Loading missions...
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-zinc-300 bg-white p-12 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-green-50 text-green-600">
            <Trophy className="h-8 w-8" />
          </div>

          <h2 className="mt-4 text-xl font-black text-zinc-900">
            No missions found
          </h2>

          <p className="mt-2 text-sm text-zinc-500">
            Create a mission or adjust your filters.
          </p>

          <button
            onClick={openCreate}
            className="mt-6 rounded-2xl bg-black px-5 py-3 text-sm font-bold text-white transition hover:bg-zinc-800"
          >
            Create Mission
          </button>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filtered.map((mission) => (
            <MissionCard
              key={mission.id}
              mission={mission}
              onToggle={() => toggleMission(mission)}
              onEdit={() => openEdit(mission)}
              onDelete={() => removeMission(mission)}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black text-zinc-900">
                  {editing ? "Edit Mission" : "Create Mission"}
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  Configure the mission drivers will see.
                </p>
              </div>

              <button
                onClick={() => setModalOpen(false)}
                className="rounded-2xl bg-zinc-100 p-3 transition hover:bg-zinc-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Mission Title">
                <input
                  value={form.title}
                  onChange={(event) =>
                    setForm({ ...form, title: event.target.value })
                  }
                  className="input"
                  placeholder="Complete 10 trips"
                />
              </Field>

              <Field label="Mission Type">
                <select
                  value={form.mission_type}
                  onChange={(event) =>
                    setForm({ ...form, mission_type: event.target.value })
                  }
                  className="input"
                >
                  {Object.entries(missionTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Target Value">
                <input
                  type="number"
                  min="1"
                  value={form.target_value}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      target_value: Number(event.target.value),
                    })
                  }
                  className="input"
                />
              </Field>

              <Field label="Reward Amount">
                <input
                  type="number"
                  min="0"
                  value={form.reward_amount}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      reward_amount: Number(event.target.value),
                    })
                  }
                  className="input"
                />
              </Field>

              <Field label="Currency">
                <input
                  value={form.currency}
                  onChange={(event) =>
                    setForm({ ...form, currency: event.target.value })
                  }
                  className="input"
                  placeholder="MWK"
                />
              </Field>

              <Field label="City">
                <input
                  value={form.city}
                  onChange={(event) =>
                    setForm({ ...form, city: event.target.value })
                  }
                  className="input"
                  placeholder="Leave empty for all cities"
                />
              </Field>

              <Field label="Start Date">
                <input
                  type="datetime-local"
                  value={form.starts_at}
                  onChange={(event) =>
                    setForm({ ...form, starts_at: event.target.value })
                  }
                  className="input"
                />
              </Field>

              <Field label="End Date">
                <input
                  type="datetime-local"
                  value={form.ends_at}
                  onChange={(event) =>
                    setForm({ ...form, ends_at: event.target.value })
                  }
                  className="input"
                />
              </Field>

              <div className="md:col-span-2">
                <Field label="Description">
                  <textarea
                    value={form.description}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        description: event.target.value,
                      })
                    }
                    className="input min-h-[110px] resize-y"
                    placeholder="Explain what the driver must do..."
                  />
                </Field>
              </div>

              <label className="flex cursor-pointer items-center gap-3 rounded-2xl bg-zinc-50 p-4 text-sm font-bold text-zinc-700 md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      is_active: event.target.checked,
                    })
                  }
                  className="h-4 w-4 accent-green-500"
                />
                Mission is active
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-2xl border border-zinc-200 px-5 py-3 text-sm font-bold transition hover:bg-zinc-50"
              >
                Cancel
              </button>

              <button
                onClick={saveMission}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-2xl bg-green-500 px-5 py-3 text-sm font-black text-black transition hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save Mission"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MissionCard({
  mission,
  onToggle,
  onEdit,
  onDelete,
}: {
  mission: Mission;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const now = Date.now();

  const start = mission.starts_at
    ? new Date(mission.starts_at).getTime()
    : null;

  const end = mission.ends_at
    ? new Date(mission.ends_at).getTime()
    : null;

  const isScheduled =
    Boolean(start && start > now) && mission.is_active !== false;

  const isExpired =
    Boolean(end && end < now) || mission.is_active === false;

  const statusLabel = isExpired
    ? "EXPIRED / OFF"
    : isScheduled
      ? "SCHEDULED"
      : "ACTIVE";

  const statusClass = isExpired
    ? "bg-zinc-100 text-zinc-500"
    : isScheduled
      ? "bg-blue-100 text-blue-700"
      : "bg-green-100 text-green-700";

  return (
    <div className="rounded-[26px] border border-zinc-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-green-50 text-green-600">
            <Trophy className="h-6 w-6" />
          </div>

          <div className="min-w-0">
            <h3 className="truncate text-lg font-black text-zinc-900">
              {mission.title}
            </h3>

            <p className="mt-1 line-clamp-2 text-sm text-zinc-500">
              {mission.description || "No description provided."}
            </p>
          </div>
        </div>

        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${statusClass}`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Mini
          label="Type"
          value={
            missionTypeLabels[mission.mission_type || ""] ||
            mission.mission_type ||
            "—"
          }
        />

        <Mini
          label="Target"
          value={Number(mission.target_value || 0).toLocaleString()}
        />

        <Mini
          label="Reward"
          value={`${Number(mission.reward_amount || 0).toLocaleString()} ${
            mission.currency || "MWK"
          }`}
        />

        <Mini
          label="City"
          value={mission.city || "All cities"}
        />
      </div>

      {(mission.starts_at || mission.ends_at) && (
        <div className="mt-4 flex flex-wrap gap-4 text-xs font-semibold text-zinc-500">
          {mission.starts_at && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              Starts {formatDate(mission.starts_at)}
            </span>
          )}

          {mission.ends_at && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              Ends {formatDate(mission.ends_at)}
            </span>
          )}
        </div>
      )}

      {mission.city && (
        <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-zinc-500">
          <MapPin className="h-3.5 w-3.5" />
          {mission.city}
        </div>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-zinc-100 pt-4">
        <button
          onClick={onToggle}
          className="rounded-2xl border border-zinc-200 px-4 py-2 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
        >
          {mission.is_active ? "Deactivate" : "Activate"}
        </button>

        <button
          onClick={onEdit}
          className="inline-flex items-center gap-2 rounded-2xl bg-black px-4 py-2 text-sm font-bold text-white transition hover:bg-zinc-800"
        >
          <Pencil className="h-4 w-4" />
          Edit
        </button>

        <button
          onClick={onDelete}
          className="inline-flex items-center gap-2 rounded-2xl border border-red-200 px-4 py-2 text-sm font-bold text-red-600 transition hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>
    </div>
  );
}

function toDateTimeLocal(value: string | null) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);

  return local.toISOString().slice(0, 16);
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-[24px] border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="rounded-2xl bg-zinc-100 p-3 text-zinc-700">
          {icon}
        </div>

        <p className="text-right text-xl font-black text-zinc-900">
          {value}
        </p>
      </div>

      <p className="mt-3 text-sm font-bold text-zinc-500">{label}</p>
    </div>
  );
}

function Mini({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl bg-zinc-50 p-3">
      <p className="text-[11px] font-bold uppercase text-zinc-400">
        {label}
      </p>

      <p className="mt-1 truncate text-sm font-black text-zinc-900">
        {value}
      </p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <p className="mb-1.5 text-xs font-black uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      {children}
    </label>
  );
}
