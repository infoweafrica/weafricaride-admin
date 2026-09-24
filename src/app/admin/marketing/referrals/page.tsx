"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Gift,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";

import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import {
  approveDriverReferralBonus,
  approveRiderReferralCredit,
  issueRiderReferralCredit,
  createCampaign,
  fetchCampaigns,
  fetchDriverReferrals,
  fetchFraudChecks,
  fetchReferralRewards,
  fetchRiderReferrals,
  flagReferralFraud,
  markRewardPaid,
  payReferralBonus,
  rejectReferral,
  suspendReferral,
  toggleCampaign,
  updateCampaign,
} from "@/lib/api/referrals";

type Tab =
  | "overview"
  | "programs"
  | "drivers"
  | "riders"
  | "payouts"
  | "fraud"
  | "settings";

type CampaignForm = {
  name: string;
  description: string;
  campaign_type: string;
  starts_at: string;
  ends_at: string;
  driver_bonus_amount: string;
  rider_credit_amount: string;
  target_city: string;
  target_vehicle_type: string;
  max_referrals_per_user: string;
};

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "programs", label: "Programs" },
  { id: "drivers", label: "Driver Referrals" },
  { id: "riders", label: "Rider Referrals" },
  { id: "payouts", label: "Payouts" },
  { id: "fraud", label: "Fraud" },
  { id: "settings", label: "Settings" },
];

const emptyCampaign: CampaignForm = {
  name: "",
  description: "",
  campaign_type: "both",
  starts_at: "",
  ends_at: "",
  driver_bonus_amount: "5000",
  rider_credit_amount: "2500",
  target_city: "",
  target_vehicle_type: "",
  max_referrals_per_user: "10",
};

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return `MWK ${amount.toLocaleString()}`;
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function statusClass(status: string | null | undefined) {
  switch (status) {
    case "bonus_paid":
    case "credit_approved":
    case "completed":
    case "paid":
      return "bg-green-50 text-green-700 border-green-200";
    case "bonus_approved":
    case "pending":
    case "signed_up":
    case "qualified":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "rejected":
    case "suspended":
    case "fraud_review":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-zinc-100 text-zinc-700 border-zinc-200";
  }
}

function formatStatus(status: string | null | undefined) {
  return (status ?? "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function StatCard({
  label,
  value,
  icon: Icon,
  detail,
}: {
  label: string;
  value: string | number;
  icon: typeof Users;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-500">{label}</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-zinc-950">
            {value}
          </p>
          {detail && (
            <p className="mt-1 text-xs text-zinc-500">{detail}</p>
          )}
        </div>
        <div className="rounded-xl bg-green-50 p-3 text-green-600">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-10 text-center text-sm text-zinc-500">
      {text}
    </div>
  );
}

export default function ReferralsPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [drivers, setDrivers] = useState<any[]>([]);
  const [riders, setRiders] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [rewards, setRewards] = useState<any[]>([]);
  const [fraudChecks, setFraudChecks] = useState<any[]>([]);

  const [analytics, setAnalytics] = useState<any[]>([]);
  const [funnel, setFunnel] = useState<any[]>([]);
  const [topReferrers, setTopReferrers] = useState<any[]>([]);
  const [driverStats, setDriverStats] = useState<any>(null);
  const [referralSettings, setReferralSettings] = useState<any>({});

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [campaignModal, setCampaignModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<any | null>(null);
  const [campaignForm, setCampaignForm] =
    useState<CampaignForm>(emptyCampaign);

  const [settings, setSettings] = useState({
    defaults: {
      driver_bonus: 5000,
      rider_credit: 2500,
    },
    rules: {
      min_trips: 1,
      max_referrals: 10,
      expiry_days: 30,
      verified_docs: true,
    },
    fraud: {
      max_daily: 20,
      same_phone: true,
      self_referral: true,
    },
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [
        driverResult,
        riderResult,
        campaignResult,
        rewardResult,
        fraudResult,
        settingsResult,
        analyticsResult,
        funnelResult,
        topResult,
        statsResult,
      ] = await Promise.all([
        fetchDriverReferrals(1, 100),
        fetchRiderReferrals(1, 100),
        fetchCampaigns(1, 100),
        fetchReferralRewards(1, 100),
        fetchFraudChecks(1, 100),
        supabase.rpc("get_referral_settings"),
        supabase
          .rpc("get_referral_analytics", { p_days: 30 })
          .then((result) => ({ ...result, optionalError: result.error })),
        supabase.rpc("get_referral_funnel"),
        supabase
          .rpc("get_top_referrers", {
            p_referral_type: "driver",
            p_limit: 10,
          })
          .then((result) => ({ ...result, optionalError: result.error })),
        supabase.rpc("get_driver_referral_stats"),
      ]);

      setDrivers(driverResult?.data ?? []);
      setRiders(riderResult?.data ?? []);
      setCampaigns(campaignResult?.data ?? []);
      setRewards(rewardResult?.data ?? []);
      setFraudChecks(fraudResult?.data ?? []);

      if (!settingsResult.error && settingsResult.data) {
        setReferralSettings(settingsResult.data);

        const raw = settingsResult.data as any;
        setSettings((current) => ({
          ...current,
          ...(raw.defaults ? { defaults: { ...current.defaults, ...raw.defaults } } : {}),
          ...(raw.rules ? { rules: { ...current.rules, ...raw.rules } } : {}),
          ...(raw.fraud ? { fraud: { ...current.fraud, ...raw.fraud } } : {}),
        }));
      }

      if (!analyticsResult.optionalError) {
        setAnalytics((analyticsResult.data as any[]) ?? []);
      }

      if (!funnelResult.error) {
        setFunnel((funnelResult.data as any[]) ?? []);
      }

      if (!topResult.optionalError) {
        setTopReferrers((topResult.data as any[]) ?? []);
      }

      if (!statsResult.error) {
        setDriverStats(statsResult.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load referrals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (
    key: string,
    action: () => Promise<unknown>,
    successMessage?: string,
  ) => {
    setActionLoading(key);
    setError("");

    try {
      await action();
      if (successMessage) {
        // Keep feedback lightweight; reload reflects the actual database state.
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const filteredDrivers = useMemo(() => {
    const q = search.trim().toLowerCase();

    return drivers.filter((item) => {
      const statusOk =
        statusFilter === "all" || item.status === statusFilter;

      if (!statusOk) return false;
      if (!q) return true;

      const haystack = JSON.stringify(item).toLowerCase();
      return haystack.includes(q);
    });
  }, [drivers, search, statusFilter]);

  const filteredRiders = useMemo(() => {
    const q = search.trim().toLowerCase();

    return riders.filter((item) => {
      const statusOk =
        statusFilter === "all" || item.status === statusFilter;

      if (!statusOk) return false;
      if (!q) return true;

      return JSON.stringify(item).toLowerCase().includes(q);
    });
  }, [riders, search, statusFilter]);

  const totals = useMemo(() => {
    const all = [...drivers, ...riders];

    return {
      total: all.length,
      pending: all.filter((x) =>
        ["pending", "signed_up", "qualified"].includes(x.status),
      ).length,
      approved: all.filter((x) =>
        ["bonus_approved", "credit_approved"].includes(x.status),
      ).length,
      paid: all.filter((x) =>
        ["bonus_paid", "paid"].includes(x.status),
      ).length,
      fraud: all.filter((x) =>
        ["fraud_review", "suspended"].includes(x.status),
      ).length,
      rewardsPending: rewards.filter((x) =>
        ["pending", "approved"].includes(x.status),
      ).length,
    };
  }, [drivers, riders, rewards]);

  const openNewCampaign = () => {
    setEditingCampaign(null);
    setCampaignForm(emptyCampaign);
    setCampaignModal(true);
  };

  const openEditCampaign = (campaign: any) => {
    setEditingCampaign(campaign);

    setCampaignForm({
      name: campaign.name ?? "",
      description: campaign.description ?? "",
      campaign_type: campaign.campaign_type ?? "both",
      starts_at: campaign.starts_at
        ? new Date(campaign.starts_at).toISOString().slice(0, 16)
        : "",
      ends_at: campaign.ends_at
        ? new Date(campaign.ends_at).toISOString().slice(0, 16)
        : "",
      driver_bonus_amount: String(campaign.driver_bonus_amount ?? 0),
      rider_credit_amount: String(campaign.rider_credit_amount ?? 0),
      target_city: campaign.target_city ?? "",
      target_vehicle_type: campaign.target_vehicle_type ?? "",
      max_referrals_per_user: String(
        campaign.max_referrals_per_user ?? 10,
      ),
    });

    setCampaignModal(true);
  };

  const saveCampaign = async () => {
    if (!campaignForm.name.trim()) {
      setError("Campaign name is required.");
      return;
    }

    if (!campaignForm.starts_at || !campaignForm.ends_at) {
      setError("Campaign start and end dates are required.");
      return;
    }

    const starts = new Date(campaignForm.starts_at);
    const ends = new Date(campaignForm.ends_at);

    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
      setError("Campaign dates are invalid.");
      return;
    }

    if (ends <= starts) {
      setError("Campaign end must be after campaign start.");
      return;
    }

    const campaignType: "driver" | "rider" | "both" =
      campaignForm.campaign_type === "driver" ||
      campaignForm.campaign_type === "rider"
        ? campaignForm.campaign_type
        : "both";

    const payload = {
      name: campaignForm.name.trim(),
      description: campaignForm.description.trim() || null,
      campaign_type: campaignType,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      driver_bonus_amount: Number(campaignForm.driver_bonus_amount) || 0,
      driver_bonus_currency: "MWK",
      rider_credit_amount: Number(campaignForm.rider_credit_amount) || 0,
      rider_credit_currency: "MWK",
      target_city: campaignForm.target_city.trim() || null,
      target_vehicle_type:
        campaignForm.target_vehicle_type.trim() || null,
      max_referrals_per_user:
        Number(campaignForm.max_referrals_per_user) || null,
    };

    setActionLoading("campaign-save");
    setError("");

    try {
      if (editingCampaign) {
        await updateCampaign(editingCampaign.id, payload);
      } else {
        await createCampaign(payload);
      }

      setCampaignModal(false);
      setEditingCampaign(null);
      setCampaignForm(emptyCampaign);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save campaign");
    } finally {
      setActionLoading(null);
    }
  };

  const saveSettings = async () => {
    setActionLoading("settings");
    setError("");

    try {
      const writes = [
        supabase.rpc("set_referral_setting", {
          p_key: "defaults",
          p_value: settings.defaults,
        }),
        supabase.rpc("set_referral_setting", {
          p_key: "rules",
          p_value: settings.rules,
        }),
        supabase.rpc("set_referral_setting", {
          p_key: "fraud",
          p_value: settings.fraud,
        }),
      ];

      const results = await Promise.all(writes);
      const failed = results.find((result) => result.error);

      if (failed?.error) {
        throw failed.error;
      }

      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <PermissionGuard permission="manage_promotions">
      <div className="min-h-screen bg-zinc-50">
        <div className="border-b border-zinc-200 bg-white">
          <div className="mx-auto max-w-[1600px] px-6 py-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-green-600">
                  Marketing
                </p>
                <h1 className="mt-1 text-3xl font-black tracking-tight text-zinc-950">
                  Referrals
                </h1>
                <p className="mt-1 text-sm text-zinc-500">
                  Manage driver and rider referral growth, rewards and fraud.
                </p>
              </div>

              <button
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>

            <div className="mt-6 flex gap-1 overflow-x-auto">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    tab === item.id
                      ? "bg-zinc-950 text-white"
                      : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <main className="mx-auto max-w-[1600px] px-6 py-6">
          {error && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="flex-1">{error}</div>
              <button
                onClick={() => setError("")}
                className="font-bold"
              >
                ×
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex min-h-[400px] items-center justify-center">
              <div className="flex items-center gap-3 text-sm font-medium text-zinc-500">
                <Loader2 className="h-5 w-5 animate-spin text-green-600" />
                Loading referral data…
              </div>
            </div>
          ) : (
            <>
              {tab === "overview" && (
                <div className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                    <StatCard
                      label="Total Referrals"
                      value={totals.total}
                      icon={Users}
                    />
                    <StatCard
                      label="Pending"
                      value={totals.pending}
                      icon={Clock3}
                    />
                    <StatCard
                      label="Approved"
                      value={totals.approved}
                      icon={CheckCircle2}
                    />
                    <StatCard
                      label="Paid"
                      value={totals.paid}
                      icon={Wallet}
                    />
                    <StatCard
                      label="Fraud Review"
                      value={totals.fraud}
                      icon={ShieldAlert}
                    />
                  </div>

                  <div className="grid gap-6 xl:grid-cols-2">
                    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
                      <div className="border-b border-zinc-100 p-5">
                        <h2 className="font-bold text-zinc-950">
                          Referral Funnel
                        </h2>
                        <p className="mt-1 text-xs text-zinc-500">
                          Current referral progression from the live system.
                        </p>
                      </div>

                      <div className="p-5">
                        {funnel.length === 0 ? (
                          <EmptyState text="No funnel data available." />
                        ) : (
                          <div className="space-y-3">
                            {funnel.map((item, index) => (
                              <div
                                key={`${item.stage}-${index}`}
                                className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-3"
                              >
                                <span className="text-sm font-semibold text-zinc-700">
                                  {formatStatus(item.stage)}
                                </span>
                                <span className="text-lg font-black text-zinc-950">
                                  {Number(item.count ?? 0).toLocaleString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
                      <div className="border-b border-zinc-100 p-5">
                        <h2 className="font-bold text-zinc-950">
                          Top Referrers
                        </h2>
                        <p className="mt-1 text-xs text-zinc-500">
                          Highest-performing driver referrers.
                        </p>
                      </div>

                      <div className="p-5">
                        {topReferrers.length === 0 ? (
                          <EmptyState text="No top-referrer data available." />
                        ) : (
                          <div className="space-y-3">
                            {topReferrers.map((item, index) => (
                              <div
                                key={`${item.referrer_id}-${index}`}
                                className="flex items-center justify-between rounded-xl border border-zinc-100 p-4"
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-50 text-sm font-black text-green-700">
                                    {index + 1}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold text-zinc-900">
                                      {item.referrer_name || "Unknown"}
                                    </p>
                                    <p className="text-xs text-zinc-500">
                                      {item.successful_referrals ?? 0} successful
                                      referrals
                                    </p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="font-bold text-zinc-900">
                                    {money(item.total_bonus)}
                                  </p>
                                  <p className="text-xs text-zinc-500">
                                    {Number(item.conversion_rate ?? 0).toFixed(1)}%
                                    conversion
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>
                  </div>

                  <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-zinc-100 p-5">
                      <div>
                        <h2 className="font-bold text-zinc-950">
                          30-Day Referral Activity
                        </h2>
                        <p className="mt-1 text-xs text-zinc-500">
                          Live referral analytics from the existing RPC.
                        </p>
                      </div>
                      {driverStats && (
                        <div className="text-right">
                          <p className="text-xs text-zinc-500">
                            Driver statistics
                          </p>
                          <p className="font-bold text-zinc-950">
                            {typeof driverStats === "object"
                              ? JSON.stringify(driverStats).slice(0, 80)
                              : String(driverStats)}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      {analytics.length === 0 ? (
                        <div className="p-6">
                          <EmptyState text="No referral analytics available for the selected period." />
                        </div>
                      ) : (
                        <table className="w-full min-w-[760px] text-left text-sm">
                          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                            <tr>
                              <th className="px-5 py-3">Day</th>
                              <th className="px-5 py-3">Driver Referrals</th>
                              <th className="px-5 py-3">Rider Referrals</th>
                              <th className="px-5 py-3">Driver Approved</th>
                              <th className="px-5 py-3">Rider Approved</th>
                              <th className="px-5 py-3 text-right">Bonus</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100">
                            {analytics.map((item, index) => (
                              <tr key={`${item.day}-${index}`}>
                                <td className="px-5 py-3 font-medium text-zinc-900">
                                  {item.day}
                                </td>
                                <td className="px-5 py-3">
                                  {item.driver_referrals ?? 0}
                                </td>
                                <td className="px-5 py-3">
                                  {item.rider_referrals ?? 0}
                                </td>
                                <td className="px-5 py-3">
                                  {item.driver_bonuses_approved ?? 0}
                                </td>
                                <td className="px-5 py-3">
                                  {item.rider_credits_approved ?? 0}
                                </td>
                                <td className="px-5 py-3 text-right font-semibold">
                                  {money(item.total_bonus_amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </section>
                </div>
              )}

              {tab === "programs" && (
                <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-4 border-b border-zinc-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="font-bold text-zinc-950">
                        Referral Programs
                      </h2>
                      <p className="mt-1 text-xs text-zinc-500">
                        Manage the existing referral campaign system.
                      </p>
                    </div>

                    <button
                      onClick={openNewCampaign}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-800"
                    >
                      <Plus className="h-4 w-4" />
                      New Program
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    {campaigns.length === 0 ? (
                      <div className="p-6">
                        <EmptyState text="No referral programs configured." />
                      </div>
                    ) : (
                      <table className="w-full min-w-[1000px] text-left text-sm">
                        <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                          <tr>
                            <th className="px-5 py-3">Program</th>
                            <th className="px-5 py-3">Audience</th>
                            <th className="px-5 py-3">Driver Bonus</th>
                            <th className="px-5 py-3">Rider Credit</th>
                            <th className="px-5 py-3">Period</th>
                            <th className="px-5 py-3">Status</th>
                            <th className="px-5 py-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {campaigns.map((campaign) => (
                            <tr key={campaign.id} className="hover:bg-zinc-50">
                              <td className="px-5 py-4">
                                <p className="font-bold text-zinc-950">
                                  {campaign.name}
                                </p>
                                <p className="mt-1 max-w-xs truncate text-xs text-zinc-500">
                                  {campaign.description || "No description"}
                                </p>
                              </td>
                              <td className="px-5 py-4 capitalize">
                                {campaign.campaign_type || "both"}
                              </td>
                              <td className="px-5 py-4 font-semibold">
                                {money(campaign.driver_bonus_amount)}
                              </td>
                              <td className="px-5 py-4 font-semibold">
                                {money(campaign.rider_credit_amount)}
                              </td>
                              <td className="px-5 py-4 text-xs text-zinc-500">
                                <div>{dateTime(campaign.starts_at)}</div>
                                <div>{dateTime(campaign.ends_at)}</div>
                              </td>
                              <td className="px-5 py-4">
                                <span
                                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${
                                    campaign.is_active
                                      ? "border-green-200 bg-green-50 text-green-700"
                                      : "border-zinc-200 bg-zinc-100 text-zinc-500"
                                  }`}
                                >
                                  {campaign.is_active ? "Active" : "Inactive"}
                                </span>
                              </td>
                              <td className="px-5 py-4">
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => openEditCampaign(campaign)}
                                    className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-100"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    disabled={actionLoading === `campaign-${campaign.id}`}
                                    onClick={() =>
                                      void runAction(
                                        `campaign-${campaign.id}`,
                                        () =>
                                          toggleCampaign(
                                            campaign.id,
                                            !campaign.is_active,
                                          ),
                                      )
                                    }
                                    className="rounded-lg bg-zinc-950 px-3 py-2 text-xs font-bold text-white hover:bg-zinc-800 disabled:opacity-50"
                                  >
                                    {campaign.is_active ? "Disable" : "Activate"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>
              )}

              {(tab === "drivers" || tab === "riders") && (
                <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-4 border-b border-zinc-100 p-5 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h2 className="font-bold text-zinc-950">
                        {tab === "drivers"
                          ? "Driver Referrals"
                          : "Rider Referrals"}
                      </h2>
                      <p className="mt-1 text-xs text-zinc-500">
                        Review referral status and take action.
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                        <input
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Search referrals"
                          className="w-full rounded-xl border border-zinc-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-green-500 sm:w-64"
                        />
                      </div>

                      <div className="relative">
                        <select
                          value={statusFilter}
                          onChange={(event) =>
                            setStatusFilter(event.target.value)
                          }
                          className="appearance-none rounded-xl border border-zinc-200 bg-white py-2.5 pl-3 pr-9 text-sm outline-none focus:border-green-500"
                        >
                          <option value="all">All statuses</option>
                          <option value="pending">Pending</option>
                          <option value="signed_up">Signed up</option>
                          <option value="qualified">Qualified</option>
                          <option value="bonus_approved">Bonus approved</option>
                          <option value="credit_approved">Credit approved</option>
                          <option value="bonus_paid">Bonus paid</option>
                          <option value="rejected">Rejected</option>
                          <option value="fraud_review">Fraud review</option>
                          <option value="suspended">Suspended</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    {(
                      tab === "drivers"
                        ? filteredDrivers
                        : filteredRiders
                    ).length === 0 ? (
                      <div className="p-6">
                        <EmptyState text="No referrals match the current filters." />
                      </div>
                    ) : (
                      <table className="w-full min-w-[1100px] text-left text-sm">
                        <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                          <tr>
                            <th className="px-5 py-3">Referral</th>
                            <th className="px-5 py-3">Referrer</th>
                            <th className="px-5 py-3">Referred User</th>
                            <th className="px-5 py-3">Status</th>
                            <th className="px-5 py-3">Created</th>
                            <th className="px-5 py-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {(tab === "drivers"
                            ? filteredDrivers
                            : filteredRiders
                          ).map((item) => {
                            const isDriver = tab === "drivers";
                            const referrer =
                              item.referrer?.full_name ||
                              item.referrer?.user?.full_name ||
                              item.referrer_id ||
                              "Unknown";

                            const referred =
                              item.referred_driver?.full_name ||
                              item.referred_driver?.user?.full_name ||
                              item.referred_rider?.full_name ||
                              item.referred_rider?.user?.full_name ||
                              item.referred_driver_id ||
                              item.referred_rider_id ||
                              "Unknown";

                            return (
                              <tr
                                key={item.id}
                                className="hover:bg-zinc-50"
                              >
                                <td className="px-5 py-4">
                                  <p className="font-bold text-zinc-950">
                                    {item.referral_code}
                                  </p>
                                  <p className="text-xs text-zinc-500">
                                    {item.campaign?.name || "Default referral"}
                                  </p>
                                </td>

                                <td className="px-5 py-4">
                                  <p className="font-semibold text-zinc-800">
                                    {referrer}
                                  </p>
                                  <p className="text-xs text-zinc-500">
                                    {item.referrer?.phone ||
                                      item.referrer?.user?.phone ||
                                      "—"}
                                  </p>
                                </td>

                                <td className="px-5 py-4">
                                  <p className="font-semibold text-zinc-800">
                                    {referred}
                                  </p>
                                </td>

                                <td className="px-5 py-4">
                                  <span
                                    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass(
                                      item.status,
                                    )}`}
                                  >
                                    {formatStatus(item.status)}
                                  </span>
                                </td>

                                <td className="px-5 py-4 text-xs text-zinc-500">
                                  {dateTime(item.created_at)}
                                </td>

                                <td className="px-5 py-4">
                                  <div className="flex justify-end gap-2">
                                    {isDriver &&
                                      item.status !== "bonus_approved" &&
                                      item.status !== "bonus_paid" && (
                                        <button
                                          disabled={
                                            actionLoading === `approve-${item.id}`
                                          }
                                          onClick={() =>
                                            void runAction(
                                              `approve-${item.id}`,
                                              () =>
                                                approveDriverReferralBonus(
                                                  item.id,
                                                  Number(
                                                    item.bonus_amount ?? 5000,
                                                  ),
                                                ),
                                            )
                                          }
                                          className="rounded-lg bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
                                        >
                                          Approve
                                        </button>
                                      )}

                                    {!isDriver &&
                                      item.status !== "credit_approved" && (
                                        <button
                                          disabled={
                                            actionLoading === `approve-${item.id}`
                                          }
                                          onClick={() =>
                                            void runAction(
                                              `approve-${item.id}`,
                                              () =>
                                                approveRiderReferralCredit(
                                                  item.id,
                                                  Number(
                                                    item.credit_amount ?? 2500,
                                                  ),
                                                ),
                                            )
                                          }
                                          className="rounded-lg bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
                                        >
                                          Approve
                                        </button>
                                      )}

                                    {!isDriver &&
                                      item.status === "credit_approved" && (
                                        <button
                                          disabled={
                                            actionLoading === `issue-${item.id}`
                                          }
                                          onClick={() =>
                                            void runAction(
                                              `issue-${item.id}`,
                                              () =>
                                                issueRiderReferralCredit(item.id),
                                            )
                                          }
                                          className="rounded-lg bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
                                        >
                                          Issue Credit
                                        </button>
                                      )}

                                    {!["bonus_paid", "credit_issued", "rejected", "suspended"].includes(
                                      item.status,
                                    ) && (
                                      <>
                                        <button
                                          disabled={
                                            actionLoading === `reject-${item.id}`
                                          }
                                          onClick={() => {
                                            const reason = window.prompt(
                                              "Reason for rejecting this referral:",
                                            );
                                            if (reason === null) return;

                                            void runAction(
                                              `reject-${item.id}`,
                                              () =>
                                                rejectReferral(
                                                  item.id,
                                                  isDriver ? "driver" : "rider",
                                                  reason,
                                                ),
                                            );
                                          }}
                                          className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-100"
                                        >
                                          Reject
                                        </button>

                                        <button
                                          disabled={
                                            actionLoading === `fraud-${item.id}`
                                          }
                                          onClick={() =>
                                            void runAction(
                                              `fraud-${item.id}`,
                                              () =>
                                                flagReferralFraud(
                                                  item.id,
                                                  isDriver ? "driver" : "rider",
                                                ),
                                            )
                                          }
                                          className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50"
                                        >
                                          Fraud
                                        </button>
                                      </>
                                    )}

                                    {item.status !== "suspended" &&
                                      item.status !== "rejected" && (
                                        <button
                                          disabled={
                                            actionLoading === `suspend-${item.id}`
                                          }
                                          onClick={() =>
                                            void runAction(
                                              `suspend-${item.id}`,
                                              () =>
                                                suspendReferral(
                                                  item.id,
                                                  isDriver ? "driver" : "rider",
                                                ),
                                            )
                                          }
                                          className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-100"
                                        >
                                          Suspend
                                        </button>
                                      )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>
              )}

              {tab === "payouts" && (
                <section className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <StatCard
                      label="Pending Rewards"
                      value={totals.rewardsPending}
                      icon={Clock3}
                    />
                    <StatCard
                      label="Rewards Records"
                      value={rewards.length}
                      icon={Gift}
                    />
                    <StatCard
                      label="Paid Rewards"
                      value={rewards.filter((x) => x.status === "paid").length}
                      icon={CheckCircle2}
                    />
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
                    {rewards.length === 0 ? (
                      <div className="p-6">
                        <EmptyState text="No referral rewards found." />
                      </div>
                    ) : (
                      <table className="w-full min-w-[1000px] text-left text-sm">
                        <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                          <tr>
                            <th className="px-5 py-3">Referral</th>
                            <th className="px-5 py-3">Recipient</th>
                            <th className="px-5 py-3">Type</th>
                            <th className="px-5 py-3">Amount</th>
                            <th className="px-5 py-3">Status</th>
                            <th className="px-5 py-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {rewards.map((reward) => (
                            <tr key={reward.id}>
                              <td className="px-5 py-4 font-mono text-xs">
                                {reward.referral_id}
                              </td>
                              <td className="px-5 py-4">
                                <p className="font-semibold text-zinc-800">
                                  {reward.recipient_id}
                                </p>
                                <p className="text-xs capitalize text-zinc-500">
                                  {reward.recipient_type}
                                </p>
                              </td>
                              <td className="px-5 py-4 capitalize">
                                {reward.reward_type || "bonus"}
                              </td>
                              <td className="px-5 py-4 font-bold">
                                {money(reward.amount)}
                              </td>
                              <td className="px-5 py-4">
                                <span
                                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass(
                                    reward.status,
                                  )}`}
                                >
                                  {formatStatus(reward.status)}
                                </span>
                              </td>
                              <td className="px-5 py-4">
                                <div className="flex justify-end gap-2">
                                  {reward.status !== "paid" && (
                                    <button
                                      disabled={
                                        actionLoading === `pay-${reward.id}`
                                      }
                                      onClick={() => {
                                        const reference = window.prompt(
                                          "Transaction reference:",
                                          `manual-${Date.now()}`,
                                        );
                                        if (!reference) return;

                                        void runAction(
                                          `pay-${reward.id}`,
                                          () =>
                                            markRewardPaid(
                                              reward.id,
                                              reference,
                                            ),
                                        );
                                      }}
                                      className="rounded-lg bg-zinc-950 px-3 py-2 text-xs font-bold text-white hover:bg-zinc-800 disabled:opacity-50"
                                    >
                                      Pay
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>
              )}

              {tab === "fraud" && (
                <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
                  <div className="border-b border-zinc-100 p-5">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-red-50 p-3 text-red-600">
                        <ShieldAlert className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="font-bold text-zinc-950">
                          Referral Fraud Center
                        </h2>
                        <p className="mt-1 text-xs text-zinc-500">
                          Review referral fraud checks and flagged activity.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    {fraudChecks.length === 0 ? (
                      <div className="p-6">
                        <EmptyState text="No fraud checks found." />
                      </div>
                    ) : (
                      <table className="w-full min-w-[900px] text-left text-sm">
                        <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                          <tr>
                            <th className="px-5 py-3">Referral</th>
                            <th className="px-5 py-3">Type</th>
                            <th className="px-5 py-3">Verdict</th>
                            <th className="px-5 py-3">Checked</th>
                            <th className="px-5 py-3">Details</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {fraudChecks.map((item) => (
                            <tr key={item.id}>
                              <td className="px-5 py-4 font-mono text-xs">
                                {item.referral_id}
                              </td>
                              <td className="px-5 py-4 capitalize">
                                {item.referral_type || "—"}
                              </td>
                              <td className="px-5 py-4">
                                <span
                                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${
                                    item.verdict === "clear"
                                      ? "border-green-200 bg-green-50 text-green-700"
                                      : "border-red-200 bg-red-50 text-red-700"
                                  }`}
                                >
                                  {formatStatus(item.verdict)}
                                </span>
                              </td>
                              <td className="px-5 py-4 text-xs text-zinc-500">
                                {dateTime(item.created_at)}
                              </td>
                              <td className="max-w-md px-5 py-4 text-xs text-zinc-500">
                                {item.reason ||
                                  item.details ||
                                  item.notes ||
                                  "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>
              )}

              {tab === "settings" && (
                <section className="mx-auto max-w-4xl space-y-6">
                  <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                    <div className="mb-6 flex items-center gap-3">
                      <div className="rounded-xl bg-green-50 p-3 text-green-600">
                        <Settings className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="font-bold text-zinc-950">
                          Referral Defaults
                        </h2>
                        <p className="text-xs text-zinc-500">
                          Stored in the existing referral settings system.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-sm font-semibold text-zinc-700">
                          Driver bonus (MWK)
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={settings.defaults.driver_bonus}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              defaults: {
                                ...current.defaults,
                                driver_bonus: Number(event.target.value),
                              },
                            }))
                          }
                          className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 outline-none focus:border-green-500"
                        />
                      </label>

                      <label className="block">
                        <span className="text-sm font-semibold text-zinc-700">
                          Rider credit (MWK)
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={settings.defaults.rider_credit}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              defaults: {
                                ...current.defaults,
                                rider_credit: Number(event.target.value),
                              },
                            }))
                          }
                          className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 outline-none focus:border-green-500"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                    <h2 className="font-bold text-zinc-950">Referral Rules</h2>

                    <div className="mt-5 grid gap-5 sm:grid-cols-2">
                      <label>
                        <span className="text-sm font-semibold text-zinc-700">
                          Minimum trips
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={settings.rules.min_trips}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              rules: {
                                ...current.rules,
                                min_trips: Number(event.target.value),
                              },
                            }))
                          }
                          className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 outline-none focus:border-green-500"
                        />
                      </label>

                      <label>
                        <span className="text-sm font-semibold text-zinc-700">
                          Maximum referrals per user
                        </span>
                        <input
                          type="number"
                          min="1"
                          value={settings.rules.max_referrals}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              rules: {
                                ...current.rules,
                                max_referrals: Number(event.target.value),
                              },
                            }))
                          }
                          className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 outline-none focus:border-green-500"
                        />
                      </label>

                      <label>
                        <span className="text-sm font-semibold text-zinc-700">
                          Expiry days
                        </span>
                        <input
                          type="number"
                          min="1"
                          value={settings.rules.expiry_days}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              rules: {
                                ...current.rules,
                                expiry_days: Number(event.target.value),
                              },
                            }))
                          }
                          className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 outline-none focus:border-green-500"
                        />
                      </label>

                      <label className="flex items-center gap-3 rounded-xl border border-zinc-200 p-4">
                        <input
                          type="checkbox"
                          checked={settings.rules.verified_docs}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              rules: {
                                ...current.rules,
                                verified_docs: event.target.checked,
                              },
                            }))
                          }
                          className="h-4 w-4 accent-green-600"
                        />
                        <span className="text-sm font-semibold text-zinc-700">
                          Require verified documents
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                    <h2 className="font-bold text-zinc-950">
                      Fraud Protection
                    </h2>

                    <div className="mt-5 space-y-4">
                      <label className="block max-w-sm">
                        <span className="text-sm font-semibold text-zinc-700">
                          Maximum daily referrals
                        </span>
                        <input
                          type="number"
                          min="1"
                          value={settings.fraud.max_daily}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              fraud: {
                                ...current.fraud,
                                max_daily: Number(event.target.value),
                              },
                            }))
                          }
                          className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 outline-none focus:border-green-500"
                        />
                      </label>

                      <label className="flex items-center gap-3 rounded-xl border border-zinc-200 p-4">
                        <input
                          type="checkbox"
                          checked={settings.fraud.same_phone}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              fraud: {
                                ...current.fraud,
                                same_phone: event.target.checked,
                              },
                            }))
                          }
                          className="h-4 w-4 accent-green-600"
                        />
                        <span className="text-sm font-semibold text-zinc-700">
                          Flag matching phone numbers
                        </span>
                      </label>

                      <label className="flex items-center gap-3 rounded-xl border border-zinc-200 p-4">
                        <input
                          type="checkbox"
                          checked={settings.fraud.self_referral}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              fraud: {
                                ...current.fraud,
                                self_referral: event.target.checked,
                              },
                            }))
                          }
                          className="h-4 w-4 accent-green-600"
                        />
                        <span className="text-sm font-semibold text-zinc-700">
                          Block self-referrals
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      disabled={actionLoading === "settings"}
                      onClick={() => void saveSettings()}
                      className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {actionLoading === "settings" && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      Save Settings
                    </button>
                  </div>

                  {Object.keys(referralSettings ?? {}).length === 0 && (
                    <p className="text-center text-xs text-zinc-400">
                      Using local defaults until referral settings are returned
                      by the live RPC.
                    </p>
                  )}
                </section>
              )}
            </>
          )}
        </main>

        {campaignModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-100 p-5">
                <div>
                  <h2 className="text-xl font-black text-zinc-950">
                    {editingCampaign ? "Edit Program" : "New Referral Program"}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    Configure an existing referral campaign.
                  </p>
                </div>
                <button
                  onClick={() => setCampaignModal(false)}
                  className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>

              <div className="grid gap-5 p-5 sm:grid-cols-2">
                <label className="sm:col-span-2">
                  <span className="text-sm font-semibold text-zinc-700">
                    Program name
                  </span>
                  <input
                    value={campaignForm.name}
                    onChange={(event) =>
                      setCampaignForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 outline-none focus:border-green-500"
                    placeholder="Refer a Friend"
                  />
                </label>

                <label className="sm:col-span-2">
                  <span className="text-sm font-semibold text-zinc-700">
                    Description
                  </span>
                  <textarea
                    value={campaignForm.description}
                    onChange={(event) =>
                      setCampaignForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 outline-none focus:border-green-500"
                  />
                </label>

                <label>
                  <span className="text-sm font-semibold text-zinc-700">
                    Audience
                  </span>
                  <select
                    value={campaignForm.campaign_type}
                    onChange={(event) =>
                      setCampaignForm((current) => ({
                        ...current,
                        campaign_type: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 outline-none focus:border-green-500"
                  >
                    <option value="both">Both</option>
                    <option value="driver">Drivers</option>
                    <option value="rider">Riders</option>
                  </select>
                </label>

                <label>
                  <span className="text-sm font-semibold text-zinc-700">
                    Max referrals / user
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={campaignForm.max_referrals_per_user}
                    onChange={(event) =>
                      setCampaignForm((current) => ({
                        ...current,
                        max_referrals_per_user: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 outline-none focus:border-green-500"
                  />
                </label>

                <label>
                  <span className="text-sm font-semibold text-zinc-700">
                    Driver bonus (MWK)
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={campaignForm.driver_bonus_amount}
                    onChange={(event) =>
                      setCampaignForm((current) => ({
                        ...current,
                        driver_bonus_amount: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 outline-none focus:border-green-500"
                  />
                </label>

                <label>
                  <span className="text-sm font-semibold text-zinc-700">
                    Rider credit (MWK)
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={campaignForm.rider_credit_amount}
                    onChange={(event) =>
                      setCampaignForm((current) => ({
                        ...current,
                        rider_credit_amount: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 outline-none focus:border-green-500"
                  />
                </label>

                <label>
                  <span className="text-sm font-semibold text-zinc-700">
                    Starts
                  </span>
                  <input
                    type="datetime-local"
                    value={campaignForm.starts_at}
                    onChange={(event) =>
                      setCampaignForm((current) => ({
                        ...current,
                        starts_at: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 outline-none focus:border-green-500"
                  />
                </label>

                <label>
                  <span className="text-sm font-semibold text-zinc-700">
                    Ends
                  </span>
                  <input
                    type="datetime-local"
                    value={campaignForm.ends_at}
                    onChange={(event) =>
                      setCampaignForm((current) => ({
                        ...current,
                        ends_at: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 outline-none focus:border-green-500"
                  />
                </label>

                <label>
                  <span className="text-sm font-semibold text-zinc-700">
                    Target city
                  </span>
                  <input
                    value={campaignForm.target_city}
                    onChange={(event) =>
                      setCampaignForm((current) => ({
                        ...current,
                        target_city: event.target.value,
                      }))
                    }
                    placeholder="Optional"
                    className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 outline-none focus:border-green-500"
                  />
                </label>

                <label>
                  <span className="text-sm font-semibold text-zinc-700">
                    Target vehicle type
                  </span>
                  <input
                    value={campaignForm.target_vehicle_type}
                    onChange={(event) =>
                      setCampaignForm((current) => ({
                        ...current,
                        target_vehicle_type: event.target.value,
                      }))
                    }
                    placeholder="Optional"
                    className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 outline-none focus:border-green-500"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-3 border-t border-zinc-100 p-5">
                <button
                  onClick={() => setCampaignModal(false)}
                  className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50"
                >
                  Cancel
                </button>

                <button
                  disabled={actionLoading === "campaign-save"}
                  onClick={() => void saveCampaign()}
                  className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {actionLoading === "campaign-save" && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {editingCampaign ? "Save Changes" : "Create Program"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PermissionGuard>
  );
}
