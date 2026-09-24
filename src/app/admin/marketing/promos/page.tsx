"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import {
  RefreshCw,
  Plus,
  X,
  Ban,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import type { PromoCode } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  scheduled: "bg-blue-100 text-blue-700",
  expired: "bg-gray-100 text-gray-500",
  disabled: "bg-red-100 text-red-700",
};

const DISCOUNT_TYPES = ["percentage", "fixed", "free_ride"] as const;

interface FormState {
  code: string;
  discount_type: (typeof DISCOUNT_TYPES)[number];
  discount_value: string;
  status: "active" | "scheduled" | "expired" | "disabled";
  visible: boolean;
  starts_at: string;
  expires_at: string;
}

const EMPTY_FORM: FormState = {
  code: "",
  discount_type: "percentage",
  discount_value: "",
  status: "active",
  visible: true,
  starts_at: "",
  expires_at: "",
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
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchPromos = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/promo-codes", {
        cache: "no-store",
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error || "Failed to load promo codes");
        setPromos([]);
        return;
      }

      setPromos((json.data as PromoCode[]) ?? []);
    } catch {
      setError("Failed to load promo codes");
      setPromos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPromos();
  }, [fetchPromos]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.code.trim()) {
      setError("Code is required");
      return;
    }

    if (!form.discount_value) {
      setError("Discount value is required");
      return;
    }

    const value = Number(form.discount_value);

    if (!Number.isFinite(value) || value <= 0) {
      setError("Discount value must be greater than zero");
      return;
    }

    if (form.discount_type === "percentage" && value > 100) {
      setError("Percentage discount cannot exceed 100%");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/admin/promo-codes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: form.code,
          discount_type: form.discount_type,
          discount_value: value,
          status: form.status,
          visible: form.visible,
          starts_at: form.starts_at
            ? new Date(form.starts_at).toISOString()
            : null,
          expires_at: form.expires_at
            ? new Date(form.expires_at).toISOString()
            : null,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error || "Failed to create promo code");
        return;
      }

      setShowForm(false);
      setForm(EMPTY_FORM);
      await fetchPromos();
    } catch {
      setError("Failed to create promo code");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus(promo: PromoCode) {
    setBusyId(promo.id);
    setError(null);

    try {
      const nextStatus =
        promo.status === "disabled" ? "active" : "disabled";

      const res = await fetch(`/api/admin/promo-codes/${promo.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: nextStatus,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error || "Failed to update promo code");
        return;
      }

      await fetchPromos();
    } catch {
      setError("Failed to update promo code");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleVisibility(promo: PromoCode) {
    setBusyId(promo.id);
    setError(null);

    try {
      const res = await fetch(`/api/admin/promo-codes/${promo.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          visible: !promo.visible,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error || "Failed to update visibility");
        return;
      }

      await fetchPromos();
    } catch {
      setError("Failed to update visibility");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(promo: PromoCode) {
    if (
      !confirm(
        `Delete promo code "${promo.code}"? This cannot be undone.`
      )
    ) {
      return;
    }

    setBusyId(promo.id);
    setError(null);

    try {
      const res = await fetch(`/api/admin/promo-codes/${promo.id}`, {
        method: "DELETE",
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error || "Failed to delete promo code");
        return;
      }

      await fetchPromos();
    } catch {
      setError("Failed to delete promo code");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Promo Codes
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Create and manage promotional campaigns
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={fetchPromos}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>

          <button
            onClick={() => {
              setShowForm((v) => !v);
              setError(null);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            {showForm ? (
              <X className="h-4 w-4" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {showForm ? "Cancel" : "Create Promo"}
          </button>
        </div>
      </div>

      {error && !showForm && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white rounded-xl border border-gray-200 p-4 space-y-4"
        >
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Promo Code">
              <input
                value={form.code}
                onChange={(e) =>
                  setForm({
                    ...form,
                    code: e.target.value.toUpperCase(),
                  })
                }
                placeholder="WELCOME50"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono"
              />
            </Field>

            <Field label="Discount Type">
              <select
                value={form.discount_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    discount_type:
                      e.target.value as FormState["discount_type"],
                  })
                }
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              >
                {DISCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type === "free_ride"
                      ? "Free Ride"
                      : type === "percentage"
                        ? "Percentage"
                        : "Fixed Amount"}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label={
                form.discount_type === "percentage"
                  ? "Discount (%)"
                  : form.discount_type === "free_ride"
                    ? "Discount Value"
                    : "Discount (MWK)"
              }
            >
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.discount_value}
                onChange={(e) =>
                  setForm({
                    ...form,
                    discount_value: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </Field>

            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value as FormState["status"],
                  })
                }
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              >
                <option value="active">Active</option>
                <option value="scheduled">Scheduled</option>
                <option value="disabled">Disabled</option>
                <option value="expired">Expired</option>
              </select>
            </Field>

            <Field label="Starts">
              <input
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) =>
                  setForm({
                    ...form,
                    starts_at: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </Field>

            <Field label="Expires">
              <input
                type="datetime-local"
                value={form.expires_at}
                onChange={(e) =>
                  setForm({
                    ...form,
                    expires_at: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </Field>

            <Field label="Visibility">
              <label className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={form.visible}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      visible: e.target.checked,
                    })
                  }
                />
                Visible to riders
              </label>
            </Field>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create Promo Code"}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total" value={promos.length} />

        <StatCard
          label="Active"
          value={promos.filter((p) => p.status === "active").length}
          color="text-green-600"
        />

        <StatCard
          label="Scheduled"
          value={promos.filter((p) => p.status === "scheduled").length}
          color="text-blue-600"
        />

        <StatCard
          label="Disabled"
          value={promos.filter((p) => p.status === "disabled").length}
          color="text-red-600"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-700">
                  Code
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">
                  Type
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">
                  Discount
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">
                  Starts
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">
                  Expires
                </th>
                <th className="text-center px-4 py-3 font-medium text-gray-700">
                  Visible
                </th>
                <th className="text-center px-4 py-3 font-medium text-gray-700">
                  Status
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="p-6 text-center text-gray-400"
                  >
                    Loading...
                  </td>
                </tr>
              ) : promos.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="p-6 text-center text-gray-400"
                  >
                    No promo codes found
                  </td>
                </tr>
              ) : (
                promos.map((promo) => (
                  <tr
                    key={promo.id}
                    className="hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 font-mono font-medium">
                      {promo.code}
                    </td>

                    <td className="px-4 py-3 text-gray-500 capitalize">
                      {(
                        promo.discount_type ??
                        (promo as PromoCode & { type?: string }).type ??
                        "unknown"
                      ).replace(/_/g, " ")}
                    </td>

                    <td className="px-4 py-3 text-right font-medium">
                      {(() => {
                        const type =
                          promo.discount_type ??
                          (promo as PromoCode & { type?: string }).type ??
                          "unknown";

                        const value =
                          promo.discount_value ??
                          (promo as PromoCode & { value?: number }).value ??
                          0;

                        return type === "percentage"
                          ? `${value}%`
                          : type === "free_ride"
                            ? "Free Ride"
                            : `MWK ${Number(value).toLocaleString()}`;
                      })()}
                    </td>

                    <td className="px-4 py-3 text-gray-500">
                      {promo.starts_at
                        ? new Date(
                            promo.starts_at
                          ).toLocaleDateString()
                        : "Immediately"}
                    </td>

                    <td className="px-4 py-3 text-gray-500">
                      {promo.expires_at
                        ? new Date(
                            promo.expires_at
                          ).toLocaleDateString()
                        : "Never"}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <button
                        disabled={busyId === promo.id}
                        onClick={() => toggleVisibility(promo)}
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          promo.visible
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {promo.visible ? "Yes" : "Hidden"}
                      </button>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_COLORS[promo.status] ??
                          "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {promo.status}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          disabled={busyId === promo.id}
                          onClick={() => toggleStatus(promo)}
                          title={
                            promo.status === "disabled"
                              ? "Re-activate"
                              : "Disable"
                          }
                          className="p-1.5 hover:bg-gray-100 rounded text-gray-500 disabled:opacity-50"
                        >
                          {promo.status === "disabled" ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <Ban className="h-4 w-4" />
                          )}
                        </button>

                        <button
                          disabled={busyId === promo.id}
                          onClick={() => handleDelete(promo)}
                          title="Delete"
                          className="p-1.5 hover:bg-red-50 rounded text-red-600 disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
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
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  color = "text-gray-700",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
