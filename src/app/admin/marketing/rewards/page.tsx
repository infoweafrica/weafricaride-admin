"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { ErrorBoundary, ApiErrorDisplay, EmptyState } from "@/components/ErrorBoundary";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Gift,
  Star,
  Coins,
  Users,
  TrendingUp,
  Award,
  RefreshCw,
  CheckCircle,
  Clock,
  Zap,
  Ticket,
  Store,
  Percent,
  Car,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const inputClass = "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100";

const REWARD_TYPE_OPTIONS = [
  { value: "voucher", label: "🎟️ Ride Voucher", icon: Ticket },
  { value: "discount", label: "🏷️ Discount %", icon: Percent },
  { value: "free_ride", label: "🚗 Free Ride", icon: Car },
  { value: "bonus_points", label: "⭐ Bonus Points", icon: Star },
  { value: "cashback", label: "💰 Cashback", icon: Coins },
  { value: "gift", label: "🎁 Gift / Partner", icon: Gift },
];

const TIER_OPTIONS = [
  { value: "", label: "All Tiers" },
  { value: "bronze", label: "🥉 Bronze" },
  { value: "silver", label: "🥈 Silver" },
  { value: "gold", label: "🥇 Gold" },
  { value: "platinum", label: "💎 Platinum" },
];

interface RewardDefinition {
  id: string;
  name: string;
  description: string | null;
  reward_type: string;
  value: number;
  points_cost: number;
  min_tier: string | null;
  min_rides: number;
  max_redemptions: number;
  current_redemptions: number;
  is_active: boolean;
  is_featured: boolean;
  is_achievement: boolean;
  achievement_trigger: string | null;
  icon: string | null;
  accent_color: string;
  sort_order: number;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface LoyaltyAccount {
  id: string;
  rider_id: string;
  points: number;
  lifetime_points: number;
  total_rides_completed: number;
  total_spent: number;
  current_tier: string;
  rider_name?: string;
  rider_phone?: string;
  rider_email?: string;
}

interface TierConfig {
  id: string;
  tier_name: string;
  tier_display: string;
  min_points: number;
  min_rides: number;
  points_multiplier: number;
  discount_percent: number;
  priority_support: boolean;
  free_cancellations_per_month: number;
  birthday_bonus: number;
  voucher_amount: number;
  sort_order: number;
  is_active: boolean;
}

const TIER_COLORS: Record<string, string> = {
  bronze: "text-amber-700 bg-amber-50 border-amber-200",
  silver: "text-slate-600 bg-slate-50 border-slate-200",
  gold: "text-yellow-700 bg-yellow-50 border-yellow-200",
  platinum: "text-indigo-700 bg-indigo-50 border-indigo-200",
  standard: "text-zinc-600 bg-zinc-50 border-zinc-200",
};

export default function RewardsPage() {
  const [activeTab, setActiveTab] = useState<"rewards" | "tiers" | "loyalty">("rewards");

  // Rewards state
  const [rewards, setRewards] = useState<RewardDefinition[]>([]);
  const [rewardsLoading, setRewardsLoading] = useState(true);
  const [showRewardModal, setShowRewardModal] = useState(false);
  const [editingReward, setEditingReward] = useState<RewardDefinition | null>(null);

  // Reward form
  const [rewardName, setRewardName] = useState("");
  const [rewardDescription, setRewardDescription] = useState("");
  const [rewardType, setRewardType] = useState("voucher");
  const [rewardValue, setRewardValue] = useState("0");
  const [rewardPointsCost, setRewardPointsCost] = useState("100");
  const [rewardMinTier, setRewardMinTier] = useState("");
  const [rewardMinRides, setRewardMinRides] = useState("0");
  const [rewardMaxRedemptions, setRewardMaxRedemptions] = useState("9999");
  const [rewardFeatured, setRewardFeatured] = useState(false);
  const [rewardAchievement, setRewardAchievement] = useState(false);
  const [rewardAchievementTrigger, setRewardAchievementTrigger] = useState("");
  const [rewardIcon, setRewardIcon] = useState("");
  const [rewardAccentColor, setRewardAccentColor] = useState("#F97316");
  const [rewardSortOrder, setRewardSortOrder] = useState("0");
  const [rewardStartsAt, setRewardStartsAt] = useState("");
  const [rewardExpiresAt, setRewardExpiresAt] = useState("");

  // Loyalty state
  const [loyaltyAccounts, setLoyaltyAccounts] = useState<LoyaltyAccount[]>([]);
  const [loyaltyLoading, setLoyaltyLoading] = useState(true);
  const [loyaltySearch, setLoyaltySearch] = useState("");
  const [loyaltyTierFilter, setLoyaltyTierFilter] = useState("");
  const [loyaltyPage, setLoyaltyPage] = useState(0);
  const [loyaltyTotal, setLoyaltyTotal] = useState(0);

  // Tier config state
  const [tierConfigs, setTierConfigs] = useState<TierConfig[]>([]);
  const [tiersLoading, setTiersLoading] = useState(true);
  const [editingTier, setEditingTier] = useState<TierConfig | null>(null);
  const [showTierModal, setShowTierModal] = useState(false);
  const [tierPointsMultiplier, setTierPointsMultiplier] = useState("1.0");
  const [tierDiscountPercent, setTierDiscountPercent] = useState("0");
  const [tierFreeCancellations, setTierFreeCancellations] = useState("0");
  const [tierBirthdayBonus, setTierBirthdayBonus] = useState("0");
  const [tierVoucherAmount, setTierVoucherAmount] = useState("0");
  const [tierPrioritySupport, setTierPrioritySupport] = useState(false);

  // Wallet adjustment
  const [walletUserId, setWalletUserId] = useState("");
  const [walletAmount, setWalletAmount] = useState("25");
  const [walletBucket, setWalletBucket] = useState("promo_balance");
  const [walletReason, setWalletReason] = useState("Admin loyalty adjustment");

  const loadRewards = useCallback(async () => {
    setRewardsLoading(true);
    const { data } = await supabase
      .from("reward_definitions")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    setRewards((data || []) as RewardDefinition[]);
    setRewardsLoading(false);
  }, []);

  const loadLoyalty = useCallback(async () => {
    setLoyaltyLoading(true);
    try {
      const { data } = await supabase.rpc("admin_list_loyalty_accounts", {
        p_search: loyaltySearch,
        p_tier: loyaltyTierFilter || null,
        p_limit: 25,
        p_offset: loyaltyPage * 25,
      });
      if (data && typeof data === "object" && "data" in data) {
        setLoyaltyAccounts((data.data as LoyaltyAccount[]) || []);
        setLoyaltyTotal((data.total as number) || 0);
      }
    } catch (e) {
      setLoyaltyAccounts([]);
    }
    setLoyaltyLoading(false);
  }, [loyaltySearch, loyaltyTierFilter, loyaltyPage]);

  const loadTierConfigs = useCallback(async () => {
    setTiersLoading(true);
    const { data } = await supabase
      .from("loyalty_tier_config")
      .select("*")
      .order("sort_order");
    setTierConfigs((data || []) as TierConfig[]);
    setTiersLoading(false);
  }, []);

  useEffect(() => {
    loadRewards();
    loadLoyalty();
    loadTierConfigs();
  }, [loadRewards, loadLoyalty, loadTierConfigs]);

  useEffect(() => {
    loadLoyalty();
  }, [loyaltySearch, loyaltyTierFilter, loyaltyPage, loadLoyalty]);

  // Save reward
  const saveReward = async () => {
    const { error } = await supabase.rpc("admin_upsert_reward_definition", {
      p_id: editingReward?.id || null,
      p_name: rewardName,
      p_description: rewardDescription,
      p_reward_type: rewardType,
      p_value: Number(rewardValue) || 0,
      p_points_cost: Number(rewardPointsCost) || 0,
      p_min_tier: rewardMinTier || null,
      p_min_rides: Number(rewardMinRides) || 0,
      p_max_redemptions: Number(rewardMaxRedemptions) || 9999,
      p_is_active: true,
      p_is_featured: rewardFeatured,
      p_is_achievement: rewardAchievement,
      p_achievement_trigger: rewardAchievementTrigger || null,
      p_icon: rewardIcon || null,
      p_accent_color: rewardAccentColor,
      p_sort_order: Number(rewardSortOrder) || 0,
      p_starts_at: rewardStartsAt || null,
      p_expires_at: rewardExpiresAt || null,
    });

    if (error) return alert(error.message);
    setShowRewardModal(false);
    resetRewardForm();
    loadRewards();
  };

  const editReward = (r: RewardDefinition) => {
    setEditingReward(r);
    setRewardName(r.name);
    setRewardDescription(r.description || "");
    setRewardType(r.reward_type);
    setRewardValue(String(r.value));
    setRewardPointsCost(String(r.points_cost));
    setRewardMinTier(r.min_tier || "");
    setRewardMinRides(String(r.min_rides));
    setRewardMaxRedemptions(String(r.max_redemptions));
    setRewardFeatured(r.is_featured);
    setRewardAchievement(r.is_achievement);
    setRewardAchievementTrigger(r.achievement_trigger || "");
    setRewardIcon(r.icon || "");
    setRewardAccentColor(r.accent_color);
    setRewardSortOrder(String(r.sort_order));
    setRewardStartsAt(r.starts_at ? r.starts_at.slice(0, 16) : "");
    setRewardExpiresAt(r.expires_at ? r.expires_at.slice(0, 16) : "");
    setShowRewardModal(true);
  };

  const toggleRewardActive = async (r: RewardDefinition) => {
    await supabase.rpc("admin_upsert_reward_definition", {
      p_id: r.id,
      p_name: r.name,
      p_is_active: !r.is_active,
    });
    loadRewards();
  };

  const deleteReward = async (id: string) => {
    if (!confirm("Delete this reward? This cannot be undone.")) return;
    await supabase.from("reward_definitions").delete().eq("id", id);
    loadRewards();
  };

  const resetRewardForm = () => {
    setEditingReward(null);
    setRewardName("");
    setRewardDescription("");
    setRewardType("voucher");
    setRewardValue("0");
    setRewardPointsCost("100");
    setRewardMinTier("");
    setRewardMinRides("0");
    setRewardMaxRedemptions("9999");
    setRewardFeatured(false);
    setRewardAchievement(false);
    setRewardAchievementTrigger("");
    setRewardIcon("");
    setRewardAccentColor("#F97316");
    setRewardSortOrder("0");
    setRewardStartsAt("");
    setRewardExpiresAt("");
  };

  // Wallet adjustment
  const adjustWallet = async (sign: 1 | -1) => {
    if (!walletUserId.trim() || !Number(walletAmount)) return;
    const { error } = await supabase.rpc("admin_adjust_rewards_wallet", {
      p_user_id: walletUserId.trim(),
      p_amount: sign * Math.abs(Number(walletAmount)),
      p_bucket: walletBucket,
      p_reason: walletReason,
    });
    if (error) return alert(error.message);
    alert("Wallet adjusted successfully");
  };

  // Save tier config
  const saveTierConfig = async (tier: TierConfig) => {
    const { error } = await supabase
      .from("loyalty_tier_config")
      .update({
        points_multiplier: Number(tierPointsMultiplier) || 1.0,
        discount_percent: Number(tierDiscountPercent) || 0,
        free_cancellations_per_month: Number(tierFreeCancellations) || 0,
        birthday_bonus: Number(tierBirthdayBonus) || 0,
        voucher_amount: Number(tierVoucherAmount) || 0,
        priority_support: tierPrioritySupport,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tier.id);
    if (error) return alert(error.message);
    setShowTierModal(false);
    loadTierConfigs();
  };

  const openTierEdit = (tier: TierConfig) => {
    setEditingTier(tier);
    setTierPointsMultiplier(String(tier.points_multiplier));
    setTierDiscountPercent(String(tier.discount_percent));
    setTierFreeCancellations(String(tier.free_cancellations_per_month));
    setTierBirthdayBonus(String(tier.birthday_bonus));
    setTierVoucherAmount(String(tier.voucher_amount));
    setTierPrioritySupport(tier.priority_support);
    setShowTierModal(true);
  };

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-zinc-900">Rewards & Loyalty</h1>
            <p className="text-sm text-zinc-500">
              Manage reward catalog, loyalty tiers, driver rewards, and credit wallets.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { loadRewards(); loadLoyalty(); loadTierConfigs(); }}
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 w-fit">
          <button
            onClick={() => setActiveTab("rewards")}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              activeTab === "rewards"
                ? "bg-white shadow text-orange-600"
                : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            <Gift className="inline h-4 w-4 mr-1" /> Reward Catalog
          </button>
          <button
            onClick={() => setActiveTab("tiers")}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              activeTab === "tiers"
                ? "bg-white shadow text-orange-600"
                : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            <Award className="inline h-4 w-4 mr-1" /> Tier Setup
          </button>
          <button
            onClick={() => setActiveTab("loyalty")}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              activeTab === "loyalty"
                ? "bg-white shadow text-orange-600"
                : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            <Users className="inline h-4 w-4 mr-1" /> Customer Loyalty
          </button>
        </div>

        {/* ─────── TAB: REWARD CATALOG ─────── */}
        {activeTab === "rewards" && (
          <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
            {/* Create / Edit Rewards Panel */}
            <div className="rounded-2xl border bg-white p-5 shadow-sm h-fit">
              <div className="flex items-center justify-between mb-4">
                <h2 className="flex items-center gap-2 font-black">
                  <Gift className="h-4 w-4 text-orange-600" />
                  {editingReward ? "Edit Reward" : "Create Reward"}
                </h2>
                {editingReward && (
                  <button
                    onClick={resetRewardForm}
                    className="text-xs text-zinc-400 hover:text-zinc-600"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                <Field label="Reward Name">
                  <input className={inputClass} value={rewardName} onChange={(e) => setRewardName(e.target.value)} placeholder="e.g. 10% Off Next Ride" />
                </Field>
                <Field label="Description">
                  <textarea className={inputClass} rows={2} value={rewardDescription} onChange={(e) => setRewardDescription(e.target.value)} placeholder="What the rider gets..." />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Type">
                    <select className={inputClass} value={rewardType} onChange={(e) => setRewardType(e.target.value)}>
                      {REWARD_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Value (MK or %)">
                    <input type="number" className={inputClass} value={rewardValue} onChange={(e) => setRewardValue(e.target.value)} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Points Cost">
                    <input type="number" className={inputClass} value={rewardPointsCost} onChange={(e) => setRewardPointsCost(e.target.value)} />
                  </Field>
                  <Field label="Min Tier">
                    <select className={inputClass} value={rewardMinTier} onChange={(e) => setRewardMinTier(e.target.value)}>
                      {TIER_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Min Rides Required">
                    <input type="number" className={inputClass} value={rewardMinRides} onChange={(e) => setRewardMinRides(e.target.value)} />
                  </Field>
                  <Field label="Max Redemptions">
                    <input type="number" className={inputClass} value={rewardMaxRedemptions} onChange={(e) => setRewardMaxRedemptions(e.target.value)} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Icon (emoji)">
                    <input className={inputClass} value={rewardIcon} onChange={(e) => setRewardIcon(e.target.value)} placeholder="🎁" />
                  </Field>
                  <Field label="Color">
                    <input type="color" className="h-10 w-full rounded-xl border cursor-pointer" value={rewardAccentColor} onChange={(e) => setRewardAccentColor(e.target.value)} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Starts At">
                    <input type="datetime-local" className={inputClass} value={rewardStartsAt} onChange={(e) => setRewardStartsAt(e.target.value)} />
                  </Field>
                  <Field label="Expires At">
                    <input type="datetime-local" className={inputClass} value={rewardExpiresAt} onChange={(e) => setRewardExpiresAt(e.target.value)} />
                  </Field>
                </div>
                <Field label="Sort Order">
                  <input type="number" className={inputClass} value={rewardSortOrder} onChange={(e) => setRewardSortOrder(e.target.value)} />
                </Field>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-bold cursor-pointer">
                    <input type="checkbox" checked={rewardFeatured} onChange={(e) => setRewardFeatured(e.target.checked)} />
                    ⭐ Featured reward
                  </label>
                  <label className="flex items-center gap-2 text-sm font-bold cursor-pointer">
                    <input type="checkbox" checked={rewardAchievement} onChange={(e) => { setRewardAchievement(e.target.checked); if (e.target.checked) setRewardPointsCost("0"); }} />
                    🏆 Auto-awarded achievement
                  </label>
                  {rewardAchievement && (
                    <select className={inputClass} value={rewardAchievementTrigger} onChange={(e) => setRewardAchievementTrigger(e.target.value)}>
                      <option value="">Select trigger...</option>
                      <option value="rides_5">5 Rides</option>
                      <option value="rides_10">10 Rides</option>
                      <option value="rides_25">25 Rides</option>
                      <option value="streak_4">4 Week Streak</option>
                      <option value="birthday">Birthday</option>
                      <option value="referral_5">5 Referrals</option>
                      <option value="spent_50000">Spent 50,000 MK</option>
                    </select>
                  )}
                </div>
                <button onClick={saveReward} className="w-full rounded-xl bg-orange-600 py-3 text-sm font-black text-white hover:bg-orange-700 transition">
                  {editingReward ? "Update Reward" : "Create Reward"}
                </button>
              </div>
            </div>

            {/* Rewards List */}
            <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
              <div className="p-4 border-b bg-zinc-50 flex items-center justify-between">
                <h3 className="font-black flex items-center gap-2"><Store className="h-4 w-4 text-orange-500" /> All Rewards ({rewards.length})</h3>
              </div>
              {rewardsLoading ? (
                <div className="p-8 text-center text-zinc-400">Loading...</div>
              ) : rewards.length === 0 ? (
                <div className="p-8 text-center text-zinc-400">No rewards created yet. Create your first reward!</div>
              ) : (
                <div className="divide-y">
                  {rewards.map((r) => (
                    <div key={r.id} className="p-4 hover:bg-zinc-50 transition flex items-center gap-4">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                        style={{ backgroundColor: r.accent_color + "20", color: r.accent_color }}
                      >
                        {r.icon || "🎁"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">{r.name}</span>
                          {r.is_featured && <Star className="h-3 w-3 text-amber-500 fill-amber-500" />}
                          {r.is_achievement && <Award className="h-3 w-3 text-indigo-500" />}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${r.is_active ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-400"}`}>
                            {r.is_active ? "Active" : "Inactive"}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5 truncate">{r.description || r.reward_type}</p>
                        <div className="flex gap-3 mt-1 text-xs text-zinc-500">
                          <span>{r.points_cost > 0 ? `${r.points_cost} pts` : "Free"}</span>
                          <span>MK {r.value}</span>
                          {r.min_tier && <span>Tier: {r.min_tier}</span>}
                          <span>{r.current_redemptions}/{r.max_redemptions} used</span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => editReward(r)} className="p-2 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => toggleRewardActive(r)} className="p-2 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600" title={r.is_active ? "Deactivate" : "Activate"}>
                          {r.is_active ? <CheckCircle className="h-4 w-4 text-green-500" /> : <X className="h-4 w-4" />}
                        </button>
                        <button onClick={() => deleteReward(r.id)} className="p-2 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─────── TAB: TIER SETUP ─────── */}
        {activeTab === "tiers" && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {tiersLoading ? (
                <div className="col-span-4 p-8 text-center text-zinc-400">Loading...</div>
              ) : tierConfigs.map((tier) => (
                <div key={tier.id} className={`rounded-2xl border p-5 shadow-sm bg-white ${tier.is_active ? "" : "opacity-50"}`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold border ${TIER_COLORS[tier.tier_name] || ""}`}>
                      {tier.tier_display}
                    </span>
                    <span className="text-xs text-zinc-400">Tier {tier.sort_order}</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p>Min Points: <b>{tier.min_points.toLocaleString()}</b></p>
                    <p>Min Rides: <b>{tier.min_rides}</b></p>
                    <p>Multiplier: <b>{tier.points_multiplier}x</b></p>
                    <p>Discount: <b>{tier.discount_percent}%</b></p>
                    <p>Voucher: <b>MK {tier.voucher_amount.toLocaleString()}</b></p>
                    <p>Birthday Bonus: <b>{tier.birthday_bonus} pts</b></p>
                    <p>Free Cancellations: <b>{tier.free_cancellations_per_month}/mo</b></p>
                    <p>Priority Support: <b>{tier.priority_support ? "✅" : "❌"}</b></p>
                  </div>
                  <button onClick={() => openTierEdit(tier)} className="mt-4 w-full rounded-xl bg-zinc-100 py-2 text-sm font-bold hover:bg-zinc-200 transition">
                    <Pencil className="inline h-3 w-3 mr-1" /> Configure
                  </button>
                </div>
              ))}
            </div>

            {/* Tier Edit Modal */}
            {showTierModal && editingTier && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-black text-lg">Configure {editingTier.tier_display} Tier</h3>
                    <button onClick={() => setShowTierModal(false)} className="text-zinc-400 hover:text-zinc-600"><X className="h-5 w-5" /></button>
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Points Multiplier">
                        <input type="number" step="0.25" className={inputClass} value={tierPointsMultiplier} onChange={(e) => setTierPointsMultiplier(e.target.value)} />
                      </Field>
                      <Field label="Discount %">
                        <input type="number" className={inputClass} value={tierDiscountPercent} onChange={(e) => setTierDiscountPercent(e.target.value)} />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Voucher (MK)">
                        <input type="number" className={inputClass} value={tierVoucherAmount} onChange={(e) => setTierVoucherAmount(e.target.value)} />
                      </Field>
                      <Field label="Birthday Bonus (pts)">
                        <input type="number" className={inputClass} value={tierBirthdayBonus} onChange={(e) => setTierBirthdayBonus(e.target.value)} />
                      </Field>
                    </div>
                    <Field label="Free Cancellations/mo">
                      <input type="number" className={inputClass} value={tierFreeCancellations} onChange={(e) => setTierFreeCancellations(e.target.value)} />
                    </Field>
                    <label className="flex items-center gap-2 text-sm font-bold cursor-pointer">
                      <input type="checkbox" checked={tierPrioritySupport} onChange={(e) => setTierPrioritySupport(e.target.checked)} />
                      Priority Support
                    </label>
                    <div className="flex gap-2 pt-2">
                      <button onClick={() => setShowTierModal(false)} className="flex-1 rounded-xl border py-2 text-sm font-bold">Cancel</button>
                      <button onClick={() => saveTierConfig(editingTier)} className="flex-1 rounded-xl bg-orange-600 py-2 text-sm font-black text-white">Save</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─────── TAB: CUSTOMER LOYALTY ─────── */}
        {activeTab === "loyalty" && (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            {/* Wallet Adjustment Panel */}
            <div className="order-2 lg:order-2 space-y-6">
              <div className="rounded-2xl border bg-white p-5 shadow-sm">
                <h2 className="mb-4 flex items-center gap-2 font-black">
                  <Coins className="h-4 w-4 text-orange-600" /> Manual Credit Adjustment
                </h2>
                <div className="space-y-3">
                  <Field label="User UUID">
                    <input className={inputClass} value={walletUserId} onChange={(e) => setWalletUserId(e.target.value)} placeholder="users.id" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Amount (MK)">
                      <input type="number" className={inputClass} value={walletAmount} onChange={(e) => setWalletAmount(e.target.value)} />
                    </Field>
                    <Field label="Bucket">
                      <select className={inputClass} value={walletBucket} onChange={(e) => setWalletBucket(e.target.value)}>
                        <option value="ride_credits">Ride Credits</option>
                        <option value="promo_balance">Promo Credits</option>
                        <option value="refund_balance">Compensation</option>
                        <option value="balance">Main Balance</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="Reason">
                    <input className={inputClass} value={walletReason} onChange={(e) => setWalletReason(e.target.value)} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => adjustWallet(1)} className="rounded-xl bg-orange-600 py-3 text-sm font-black text-white hover:bg-orange-700 transition">Add Credit</button>
                    <button onClick={() => adjustWallet(-1)} className="rounded-xl bg-zinc-900 py-3 text-sm font-black text-white hover:bg-zinc-800 transition">Remove</button>
                  </div>
                </div>
              </div>

              {/* Stats Summary */}
              <div className="rounded-2xl border bg-white p-5 shadow-sm">
                <h3 className="font-black mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-orange-500" /> Loyalty Stats</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-orange-50 rounded-xl p-3"><p className="text-xs text-zinc-500">Total Accounts</p><p className="text-xl font-black text-orange-600">{loyaltyTotal}</p></div>
                  <div className="bg-green-50 rounded-xl p-3"><p className="text-xs text-zinc-500">Platinum</p><p className="text-xl font-black text-green-600">{loyaltyAccounts.filter(a => a.current_tier === "platinum").length}</p></div>
                </div>
              </div>
            </div>

            {/* Loyalty Accounts Table */}
            <div className="order-1 lg:order-1 rounded-2xl border bg-white shadow-sm overflow-hidden">
              <div className="p-4 border-b bg-zinc-50 space-y-3">
                <h3 className="font-black flex items-center gap-2"><Users className="h-4 w-4 text-orange-500" /> Rider Loyalty Accounts</h3>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <input className="w-full rounded-xl border bg-white pl-9 pr-3 py-2 text-sm" value={loyaltySearch} onChange={(e) => { setLoyaltySearch(e.target.value); setLoyaltyPage(0); }} placeholder="Search by name or phone..." />
                  </div>
                  <select className="rounded-xl border bg-white px-3 py-2 text-sm" value={loyaltyTierFilter} onChange={(e) => { setLoyaltyTierFilter(e.target.value); setLoyaltyPage(0); }}>
                    <option value="">All Tiers</option>
                    <option value="bronze">Bronze</option>
                    <option value="silver">Silver</option>
                    <option value="gold">Gold</option>
                    <option value="platinum">Platinum</option>
                  </select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-left text-zinc-500">
                    <tr>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Tier</th>
                      <th className="px-4 py-3 text-right">Points</th>
                      <th className="px-4 py-3 text-right">Rides</th>
                      <th className="px-4 py-3 text-right">Spent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loyaltyLoading ? (
                      <tr><td colSpan={5} className="p-8 text-center text-zinc-400">Loading...</td></tr>
                    ) : loyaltyAccounts.length === 0 ? (
                      <tr><td colSpan={5} className="p-8 text-center text-zinc-400">No loyalty accounts found</td></tr>
                    ) : (
                      loyaltyAccounts.map((a) => (
                        <tr key={a.id} className="border-t hover:bg-zinc-50 transition">
                          <td className="px-4 py-3">
                            <div className="font-bold">{a.rider_name || "Unknown"}</div>
                            <div className="text-xs text-zinc-400">{a.rider_phone || a.rider_email || a.rider_id}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full font-bold border ${TIER_COLORS[a.current_tier] || ""}`}>
                              {a.current_tier}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="font-bold text-orange-600">{a.points.toLocaleString()}</div>
                            <div className="text-xs text-zinc-400">{a.lifetime_points.toLocaleString()} lifetime</div>
                          </td>
                          <td className="px-4 py-3 text-right font-bold">{a.total_rides_completed}</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(Number(a.total_spent || 0))}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {loyaltyTotal > 25 && (
                <div className="p-4 border-t flex items-center justify-between">
                  <button
                    onClick={() => setLoyaltyPage((p) => Math.max(0, p - 1))}
                    disabled={loyaltyPage === 0}
                    className="px-3 py-1 rounded-lg border text-sm font-bold disabled:opacity-30"
                  >Previous</button>
                  <span className="text-sm text-zinc-500">Page {loyaltyPage + 1} of {Math.ceil(loyaltyTotal / 25)}</span>
                  <button
                    onClick={() => setLoyaltyPage((p) => p + 1)}
                    disabled={(loyaltyPage + 1) * 25 >= loyaltyTotal}
                    className="px-3 py-1 rounded-lg border text-sm font-bold disabled:opacity-30"
                  >Next</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-zinc-600">{label}</span>
      {children}
    </label>
  );
}