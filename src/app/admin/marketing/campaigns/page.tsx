"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import {
  fetchCampaigns,
  createCampaign,
  toggleCampaign,
} from "@/lib/api/referrals";
import type { ReferralCampaign } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

const inputClass =
  "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-green-400";

export default function MarketingCampaignsPage() {
  return (
    <PermissionGuard permission="manage_promotions">
      <MarketingCampaignsPageInner />
    </PermissionGuard>
  );
}

function MarketingCampaignsPageInner() {
  const [items, setItems] = useState<ReferralCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [campaignType, setCampaignType] =
    useState<ReferralCampaign["campaign_type"]>("both");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [driverBonus, setDriverBonus] = useState("0");
  const [riderCredit, setRiderCredit] = useState("0");
  const [targetCity, setTargetCity] = useState("");
  const [targetVehicleType, setTargetVehicleType] = useState("");
  const [maxReferrals, setMaxReferrals] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");

    try {
      const result = await fetchCampaigns(1, 100);
      setItems(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load campaigns.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setName("");
    setDescription("");
    setCampaignType("both");
    setStartsAt("");
    setEndsAt("");
    setDriverBonus("0");
    setRiderCredit("0");
    setTargetCity("");
    setTargetVehicleType("");
    setMaxReferrals("");
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Campaign name is required.");
      return;
    }

    if (!startsAt || !endsAt) {
      setError("Start and end dates are required.");
      return;
    }

    if (new Date(endsAt) <= new Date(startsAt)) {
      setError("End date must be after the start date.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await createCampaign({
        name: name.trim(),
        description: description.trim() || null,
        campaign_type: campaignType,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        driver_bonus_amount: Number(driverBonus) || 0,
        driver_bonus_currency: "MWK",
        rider_credit_amount: Number(riderCredit) || 0,
        rider_credit_currency: "MWK",
        conditions: {},
        target_city: targetCity.trim() || null,
        target_vehicle_type: targetVehicleType.trim() || null,
        max_referrals_per_user: maxReferrals
          ? Number(maxReferrals)
          : null,
      });

      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign.");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (campaign: ReferralCampaign) => {
    setError("");

    try {
      await toggleCampaign(campaign.id, !campaign.is_active);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update campaign.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-zinc-900">
            Referral Campaigns
          </h1>
          <p className="text-sm text-zinc-500">
            Create and manage rider and driver referral campaigns.
          </p>
        </div>

        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 font-black">
            <Plus className="h-4 w-4 text-green-600" />
            Create Referral Campaign
          </h2>

          <div className="space-y-3">
            <Field label="Campaign name">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Refer & Earn"
              />
            </Field>

            <Field label="Description">
              <textarea
                rows={3}
                className={inputClass}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Invite friends and earn rewards."
              />
            </Field>

            <Field label="Campaign type">
              <select
                className={inputClass}
                value={campaignType}
                onChange={(e) =>
                  setCampaignType(
                    e.target.value as ReferralCampaign["campaign_type"]
                  )
                }
              >
                <option value="both">Drivers & Riders</option>
                <option value="rider">Riders</option>
                <option value="driver">Drivers</option>
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Driver bonus (MWK)">
                <input
                  type="number"
                  min="0"
                  className={inputClass}
                  value={driverBonus}
                  onChange={(e) => setDriverBonus(e.target.value)}
                />
              </Field>

              <Field label="Rider credit (MWK)">
                <input
                  type="number"
                  min="0"
                  className={inputClass}
                  value={riderCredit}
                  onChange={(e) => setRiderCredit(e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Start">
                <input
                  type="datetime-local"
                  className={inputClass}
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </Field>

              <Field label="End">
                <input
                  type="datetime-local"
                  className={inputClass}
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </Field>
            </div>

            <Field label="Target city">
              <input
                className={inputClass}
                value={targetCity}
                onChange={(e) => setTargetCity(e.target.value)}
                placeholder="Lilongwe"
              />
            </Field>

            <Field label="Target vehicle type">
              <input
                className={inputClass}
                value={targetVehicleType}
                onChange={(e) => setTargetVehicleType(e.target.value)}
                placeholder="Any vehicle"
              />
            </Field>

            <Field label="Maximum referrals per user">
              <input
                type="number"
                min="1"
                className={inputClass}
                value={maxReferrals}
                onChange={(e) => setMaxReferrals(e.target.value)}
                placeholder="Unlimited"
              />
            </Field>

            <button
              onClick={save}
              disabled={saving || !name.trim()}
              className="w-full rounded-xl bg-green-600 py-3 text-sm font-black text-white disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create Campaign"}
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Campaign</th>
                  <th className="px-4 py-3">Audience</th>
                  <th className="px-4 py-3 text-right">Driver Bonus</th>
                  <th className="px-4 py-3 text-right">Rider Credit</th>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="p-8 text-center text-zinc-400"
                    >
                      Loading campaigns...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="p-8 text-center text-zinc-400"
                    >
                      No referral campaigns yet.
                    </td>
                  </tr>
                ) : (
                  items.map((campaign) => (
                    <tr key={campaign.id} className="border-t">
                      <td className="px-4 py-3">
                        <div className="font-bold">{campaign.name}</div>
                        {campaign.description && (
                          <div className="mt-1 max-w-xs text-xs text-zinc-400">
                            {campaign.description}
                          </div>
                        )}
                        {(campaign.target_city ||
                          campaign.target_vehicle_type) && (
                          <div className="mt-1 text-xs text-zinc-400">
                            {[campaign.target_city, campaign.target_vehicle_type]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 capitalize">
                        {campaign.campaign_type === "both"
                          ? "Drivers & Riders"
                          : campaign.campaign_type}
                      </td>

                      <td className="px-4 py-3 text-right">
                        {formatCurrency(campaign.driver_bonus_amount)}
                      </td>

                      <td className="px-4 py-3 text-right">
                        {formatCurrency(campaign.rider_credit_amount)}
                      </td>

                      <td className="px-4 py-3 text-xs text-zinc-500">
                        <div>
                          {new Date(campaign.starts_at).toLocaleDateString()}
                        </div>
                        <div>
                          {new Date(campaign.ends_at).toLocaleDateString()}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-bold ${
                            campaign.is_active
                              ? "bg-green-100 text-green-700"
                              : "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {campaign.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => toggle(campaign)}
                          className="rounded-lg bg-zinc-100 px-3 py-1 text-xs font-bold"
                        >
                          {campaign.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-zinc-600">
        {label}
      </span>
      {children}
    </label>
  );
}
