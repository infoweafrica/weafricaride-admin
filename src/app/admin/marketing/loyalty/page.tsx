"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, RefreshCw, Search, Users, Star, Car, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import PermissionGuard from "@/components/guards/PermissionGuard";

type LoyaltyAccount = {
  id: string;
  rider_id: string | null;
  user_id: string | null;
  points: number;
  lifetime_points: number;
  total_rides_completed: number;
  total_spent: number;
  current_tier: string | null;
  tier_achieved_at: string | null;
  streak_weeks: number;
  last_ride_at: string | null;
  birthday_bonus_claimed: boolean;
  referral_bonus_claimed: number;
  created_at: string;
  updated_at: string;
};

const PAGE_SIZE = 50;

function money(value: number) {
  return `MWK ${Number(value || 0).toLocaleString()}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("en-MW", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function tierLabel(value: string | null) {
  if (!value) return "Bronze";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function tierClass(value: string | null) {
  switch ((value || "").toLowerCase()) {
    case "platinum":
      return "bg-purple-100 text-purple-700";
    case "gold":
      return "bg-yellow-100 text-yellow-700";
    case "silver":
      return "bg-zinc-200 text-zinc-700";
    default:
      return "bg-orange-100 text-orange-700";
  }
}

export default function LoyaltyPage() {
  return (
    <PermissionGuard permission="manage_promotions">
      <LoyaltyPageInner />
    </PermissionGuard>
  );
}

function LoyaltyPageInner() {
  const [accounts, setAccounts] = useState<LoyaltyAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("rider_loyalty_accounts")
      .select("*", { count: "exact" })
      .order("lifetime_points", { ascending: false })
      .range(from, to);

    if (tier) {
      query = query.eq("current_tier", tier);
    }

    const { data, count, error: queryError } = await query;

    if (queryError) {
      setError(queryError.message);
      setAccounts([]);
      setTotal(0);
    } else {
      setAccounts((data || []) as LoyaltyAccount[]);
      setTotal(count || 0);
    }

    setLoading(false);
  }, [page, tier]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredAccounts = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return accounts;

    return accounts.filter((account) =>
      [
        account.rider_id,
        account.user_id,
        account.current_tier,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [accounts, search]);

  const stats = useMemo(() => {
    return {
      accounts: total,
      points: accounts.reduce(
        (sum, account) => sum + Number(account.points || 0),
        0
      ),
      rides: accounts.reduce(
        (sum, account) => sum + Number(account.total_rides_completed || 0),
        0
      ),
      spent: accounts.reduce(
        (sum, account) => sum + Number(account.total_spent || 0),
        0
      ),
    };
  }, [accounts, total]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-zinc-900">
            Loyalty Program
          </h1>
          <p className="text-sm text-zinc-500">
            Monitor rider loyalty points, tiers, rides and spending.
          </p>
        </div>

        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold hover:bg-zinc-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={<Users className="h-5 w-5" />}
          label="Loyalty Accounts"
          value={stats.accounts.toLocaleString()}
        />
        <Stat
          icon={<Star className="h-5 w-5" />}
          label="Current Page Points"
          value={stats.points.toLocaleString()}
        />
        <Stat
          icon={<Car className="h-5 w-5" />}
          label="Completed Rides"
          value={stats.rides.toLocaleString()}
        />
        <Stat
          icon={<Wallet className="h-5 w-5" />}
          label="Current Page Spend"
          value={money(stats.spent)}
        />
      </div>

      <div className="rounded-2xl border bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-green-400"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Search rider or user ID..."
            />
          </div>

          <select
            className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold outline-none"
            value={tier}
            onChange={(event) => {
              setTier(event.target.value);
              setPage(0);
            }}
          >
            <option value="">All tiers</option>
            <option value="bronze">Bronze</option>
            <option value="silver">Silver</option>
            <option value="gold">Gold</option>
            <option value="platinum">Platinum</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="font-black text-zinc-900">
              Rider Loyalty Accounts
            </h2>
            <p className="text-xs text-zinc-500">
              {total.toLocaleString()} account{total === 1 ? "" : "s"}
            </p>
          </div>
          <Award className="h-5 w-5 text-green-600" />
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-zinc-400">
            Loading loyalty accounts...
          </div>
        ) : filteredAccounts.length === 0 ? (
          <div className="p-12 text-center">
            <Award className="mx-auto h-10 w-10 text-zinc-300" />
            <p className="mt-3 text-sm font-bold text-zinc-600">
              No loyalty accounts found
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Accounts will appear here once riders have loyalty records.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px]">
              <thead>
                <tr className="border-b bg-zinc-50 text-left text-xs font-black uppercase tracking-wide text-zinc-500">
                  <th className="px-5 py-3">Rider</th>
                  <th className="px-5 py-3">Tier</th>
                  <th className="px-5 py-3 text-right">Points</th>
                  <th className="px-5 py-3 text-right">Lifetime</th>
                  <th className="px-5 py-3 text-right">Rides</th>
                  <th className="px-5 py-3 text-right">Spent</th>
                  <th className="px-5 py-3 text-right">Streak</th>
                  <th className="px-5 py-3">Last Ride</th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {filteredAccounts.map((account) => (
                  <tr key={account.id} className="hover:bg-zinc-50">
                    <td className="px-5 py-4">
                      <p className="max-w-[260px] truncate text-sm font-bold text-zinc-900">
                        {account.rider_id || "Unknown rider"}
                      </p>
                      <p className="mt-1 max-w-[260px] truncate text-xs text-zinc-400">
                        {account.user_id || "No user ID"}
                      </p>
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-black ${tierClass(
                          account.current_tier
                        )}`}
                      >
                        {tierLabel(account.current_tier)}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-right text-sm font-black">
                      {Number(account.points || 0).toLocaleString()}
                    </td>

                    <td className="px-5 py-4 text-right text-sm font-semibold">
                      {Number(account.lifetime_points || 0).toLocaleString()}
                    </td>

                    <td className="px-5 py-4 text-right text-sm font-semibold">
                      {Number(account.total_rides_completed || 0).toLocaleString()}
                    </td>

                    <td className="px-5 py-4 text-right text-sm font-semibold">
                      {money(account.total_spent)}
                    </td>

                    <td className="px-5 py-4 text-right text-sm font-semibold">
                      {Number(account.streak_weeks || 0)} wk
                    </td>

                    <td className="px-5 py-4 text-sm text-zinc-500">
                      {formatDate(account.last_ride_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t px-5 py-4">
          <p className="text-xs text-zinc-500">
            Page {Math.min(page + 1, totalPages)} of {totalPages}
          </p>

          <div className="flex gap-2">
            <button
              disabled={page === 0 || loading}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>

            <button
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage((current) => current + 1)}
              className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-green-50 p-2 text-green-600">
          {icon}
        </div>
        <div>
          <p className="text-xs font-semibold text-zinc-500">{label}</p>
          <p className="text-xl font-black text-zinc-900">{value}</p>
        </div>
      </div>
    </div>
  );
}
