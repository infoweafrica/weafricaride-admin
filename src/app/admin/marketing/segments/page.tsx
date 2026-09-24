"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Filter,
  RefreshCw,
  Users,
  UserPlus,
  TrendingUp,
  Clock3,
  Wallet,
} from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import PermissionGuard from "@/components/guards/PermissionGuard";

type Segment = {
  id: string;
  name: string;
  description: string;
  rule: string;
  count: number;
  type: string;
};

type Totals = {
  customers: number;
  completedRides: number;
  active30d: number;
  inactive60d: number;
};

const inputClass =
  "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-green-400";

export default function SegmentsPage() {
  return (
    <PermissionGuard permission="manage_promotions">
      <SegmentsPageInner />
    </PermissionGuard>
  );
}

function SegmentsPageInner() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [totals, setTotals] = useState<Totals>({
    customers: 0,
    completedRides: 0,
    active30d: 0,
    inactive60d: 0,
  });
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("Custom Customer Segment");
  const [city, setCity] = useState("");
  const [rides, setRides] = useState("");
  const [inactive, setInactive] = useState("");
  const [spend, setSpend] = useState("");
  const [customCount, setCustomCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);

    try {
      const res = await fetch("/api/admin/customer-segments", {
        cache: "no-store",
      });

      const body = await res.json();

      if (res.ok) {
        setSegments(body.data || []);
        setTotals(body.totals || {
          customers: 0,
          completedRides: 0,
          active30d: 0,
          inactive60d: 0,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const previewCustomSegment = async () => {
    setSaving(true);

    try {
      const res = await fetch("/api/admin/customer-segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          city: city || null,
          min_total_rides: rides ? Number(rides) : null,
          inactive_days: inactive ? Number(inactive) : null,
          min_spend: spend ? Number(spend) : null,
        }),
      });

      const body = await res.json();

      if (!res.ok) {
        alert(body.error || "Failed to calculate segment");
        return;
      }

      setCustomCount(body.segment?.estimated_count ?? 0);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-zinc-900">
            Customer Segments
          </h1>
          <p className="text-sm text-zinc-500">
            Understand and target real WeAfrica Ride customers.
          </p>
        </div>

        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Customers"
          value={totals.customers}
        />
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          label="Completed Rides"
          value={totals.completedRides}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Active · 30 Days"
          value={totals.active30d}
        />
        <StatCard
          icon={<Clock3 className="h-5 w-5" />}
          label="Inactive · 60+ Days"
          value={totals.inactive60d}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="rounded-2xl border bg-white p-5">
          <h2 className="mb-1 flex items-center gap-2 font-black">
            <Filter className="h-4 w-4 text-green-600" />
            Build Segment
          </h2>

          <p className="mb-4 text-xs text-zinc-500">
            Preview a customer group using actual Ride activity.
          </p>

          <div className="space-y-3">
            <Field label="Segment name">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field label="City">
              <input
                className={inputClass}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Lilongwe"
              />
            </Field>

            <Field label="Minimum completed rides">
              <input
                type="number"
                min="0"
                className={inputClass}
                value={rides}
                onChange={(e) => setRides(e.target.value)}
                placeholder="10"
              />
            </Field>

            <Field label="Inactive for days">
              <input
                type="number"
                min="1"
                className={inputClass}
                value={inactive}
                onChange={(e) => setInactive(e.target.value)}
                placeholder="60"
              />
            </Field>

            <Field label="Minimum spend · MWK">
              <input
                type="number"
                min="0"
                className={inputClass}
                value={spend}
                onChange={(e) => setSpend(e.target.value)}
                placeholder="50000"
              />
            </Field>

            <button
              onClick={previewCustomSegment}
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-sm font-black text-white disabled:opacity-50"
            >
              <Filter className="h-4 w-4" />
              {saving ? "Calculating..." : "Calculate Segment"}
            </button>

            {customCount !== null && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                <div className="text-xs font-bold text-green-700">
                  Estimated Customers
                </div>
                <div className="mt-1 text-2xl font-black text-green-900">
                  {formatNumber(customCount)}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-white">
          <div className="border-b px-5 py-4">
            <h2 className="font-black text-zinc-900">
              Available Segments
            </h2>
            <p className="text-xs text-zinc-500">
              These counts are calculated from live rider and completed-ride
              data.
            </p>
          </div>

          <div className="divide-y">
            {loading ? (
              <div className="p-10 text-center text-sm text-zinc-400">
                Loading customer segments...
              </div>
            ) : (
              segments.map((segment) => (
                <div
                  key={segment.id}
                  className="flex items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-bold text-zinc-900">
                        {segment.name}
                      </div>

                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                        Live
                      </span>
                    </div>

                    <div className="mt-1 text-xs text-zinc-500">
                      {segment.description}
                    </div>

                    <div className="mt-1 text-[11px] font-semibold text-zinc-400">
                      {segment.rule}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-xl font-black text-zinc-900">
                      {formatNumber(segment.count)}
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                      customers
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-green-50 text-green-600">
        {icon}
      </div>
      <div className="text-2xl font-black text-zinc-900">
        {formatNumber(value)}
      </div>
      <div className="text-xs font-bold text-zinc-500">{label}</div>
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
      <span className="mb-1 block text-xs font-bold text-zinc-600">
        {label}
      </span>
      {children}
    </label>
  );
}
