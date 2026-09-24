"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  Bell,
  Gift,
  Image as ImageIcon,
  RefreshCw,
  Ticket,
  TrendingUp,
  Users,
  Heart,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { formatCurrency, formatNumber } from "@/lib/utils";

type MarketingAnalytics = {
  promo_usage: number;
  referral_signups: number;
  push_opens: number;
  banner_clicks: number;
  customer_retention: number;
  customer_acquisition: number;
  revenue_generated: number;
};

type NotificationAnalytics = {
  sent: number;
  delivered: number;
  opened: number;
  ctr: number;
};

type RetentionRow = {
  month: string;
  new_riders: number;
  retained_riders: number;
  retention_pct: number;
};

type RevenueRow = {
  period_label: string;
  gross: number;
  commission: number;
  driver_earnings: number;
};

type ReferralFunnelRow = {
  stage: string;
  count: number;
};

type Summary = {
  promoCount: number;
  activePromos: number;
  promoUses: number;
  referralCount: number;
  activeBanners: number;
  loyaltyAccounts: number;
};

const quickLinks = [
  {
    href: "/admin/marketing/promos",
    label: "Promo Codes",
    icon: Ticket,
    color: "bg-green-50 text-green-700",
    description: "Create and manage rider promotions.",
  },
  {
    href: "/admin/marketing/referrals",
    label: "Referrals",
    icon: Users,
    color: "bg-green-50 text-green-700",
    description: "Manage rider and driver referral campaigns.",
  },
  {
    href: "/admin/marketing/notifications",
    label: "Push Campaigns",
    icon: Bell,
    color: "bg-zinc-100 text-zinc-800",
    description: "Send targeted rider announcements.",
  },
  {
    href: "/admin/marketing/banners",
    label: "Home Banners",
    icon: ImageIcon,
    color: "bg-zinc-100 text-zinc-800",
    description: "Manage promotions shown on the rider home screen.",
  },
  {
    href: "/admin/marketing/loyalty",
    label: "Loyalty",
    icon: Heart,
    color: "bg-green-50 text-green-700",
    description: "Monitor rider loyalty accounts and points.",
  },
  {
    href: "/admin/marketing/rewards",
    label: "Rewards",
    icon: Gift,
    color: "bg-zinc-100 text-zinc-800",
    description: "Manage the existing rewards module.",
  },
  {
    href: "/admin/marketing/analytics",
    label: "Analytics",
    icon: BarChart3,
    color: "bg-zinc-100 text-zinc-800",
    description: "Open the detailed marketing analytics view.",
  },
];

export default function MarketingDashboardPage() {
  return (
    <PermissionGuard permission="manage_promotions">
      <MarketingDashboardPageInner />
    </PermissionGuard>
  );
}

function MarketingDashboardPageInner() {
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<MarketingAnalytics>({
    promo_usage: 0,
    referral_signups: 0,
    push_opens: 0,
    banner_clicks: 0,
    customer_retention: 0,
    customer_acquisition: 0,
    revenue_generated: 0,
  });

  const [notifications, setNotifications] =
    useState<NotificationAnalytics>({
      sent: 0,
      delivered: 0,
      opened: 0,
      ctr: 0,
    });

  const [retention, setRetention] = useState<RetentionRow[]>([]);
  const [revenue, setRevenue] = useState<RevenueRow[]>([]);
  const [funnel, setFunnel] = useState<ReferralFunnelRow[]>([]);

  const [summary, setSummary] = useState<Summary>({
    promoCount: 0,
    activePromos: 0,
    promoUses: 0,
    referralCount: 0,
    activeBanners: 0,
    loyaltyAccounts: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const [
        marketingResult,
        notificationResult,
        retentionResult,
        revenueResult,
        funnelResult,
        promosResult,
        referralsResult,
        bannersResult,
        loyaltyResult,
      ] = await Promise.all([
        supabase.rpc("get_marketing_analytics", { p_days: 30 }),
        supabase.rpc("get_notification_analytics"),
        supabase.rpc("get_rider_retention"),
        supabase.rpc("get_revenue_timeline", { p_period: "30d" }),
        supabase.rpc("get_referral_funnel"),

        supabase
          .from("promo_codes")
          .select("id,status,current_uses", { count: "exact" })
          .limit(500),

        supabase
          .from("rider_referrals")
          .select("id", { count: "exact", head: true }),

        fetch("/api/admin/marketing-banners?activeOnly=true")
          .then(async (response) => {
            if (!response.ok) return { totalCount: 0 };
            return response.json();
          })
          .catch(() => ({ totalCount: 0 })),

        supabase
          .from("rider_loyalty_accounts")
          .select("id", { count: "exact", head: true }),
      ]);

      if (marketingResult.data) {
        setAnalytics(marketingResult.data as MarketingAnalytics);
      }

      if (!notificationResult.error && notificationResult.data?.[0]) {
        setNotifications(
          notificationResult.data[0] as NotificationAnalytics,
        );
      }

      if (!retentionResult.error) {
        setRetention((retentionResult.data ?? []) as RetentionRow[]);
      }

      if (!revenueResult.error) {
        setRevenue((revenueResult.data ?? []) as RevenueRow[]);
      }

      if (!funnelResult.error) {
        setFunnel((funnelResult.data ?? []) as ReferralFunnelRow[]);
      }

      const promoRows = (promosResult.data ?? []) as Array<{
        id: string;
        status: string;
        current_uses: number | null;
      }>;

      setSummary({
        promoCount: promosResult.count ?? promoRows.length,
        activePromos: promoRows.filter((p) => p.status === "active").length,
        promoUses: promoRows.reduce(
          (sum, p) => sum + Number(p.current_uses ?? 0),
          0,
        ),
        referralCount: referralsResult.count ?? 0,
        activeBanners: Number(bannersResult?.totalCount ?? 0),
        loyaltyAccounts: loyaltyResult.count ?? 0,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const latestRetention = retention[retention.length - 1];

  const totalRevenue = revenue.reduce(
    (sum, row) => sum + Number(row.gross ?? 0),
    0,
  );

  const deliveredRate =
    notifications.sent > 0
      ? (notifications.delivered / notifications.sent) * 100
      : 0;

  const cards = [
    {
      label: "Revenue Generated",
      value: formatCurrency(analytics.revenue_generated),
      sub: "Last 30 days",
      icon: TrendingUp,
      color: "text-green-600",
    },
    {
      label: "Customer Acquisition",
      value: formatNumber(analytics.customer_acquisition),
      sub: "New riders · 30 days",
      icon: Users,
      color: "text-green-600",
    },
    {
      label: "Retention",
      value: `${Number(analytics.customer_retention ?? 0).toFixed(1)}%`,
      sub: "Rider retention",
      icon: Heart,
      color: "text-green-600",
    },
    {
      label: "Promo Usage",
      value: formatNumber(analytics.promo_usage),
      sub: "Redemptions · 30 days",
      icon: Ticket,
      color: "text-green-600",
    },
    {
      label: "Referral Signups",
      value: formatNumber(analytics.referral_signups),
      sub: "Referred customers · 30 days",
      icon: Users,
      color: "text-zinc-900",
    },
    {
      label: "Push Opens",
      value: formatNumber(analytics.push_opens),
      sub: `${notifications.sent.toLocaleString()} sent`,
      icon: Bell,
      color: "text-zinc-900",
    },
    {
      label: "Banner Clicks",
      value: formatNumber(analytics.banner_clicks),
      sub: "Home banner engagement",
      icon: ImageIcon,
      color: "text-zinc-900",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] bg-gradient-to-r from-zinc-950 via-zinc-900 to-green-600 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-green-200">
              Customer Growth
            </p>

            <h1 className="mt-2 text-3xl font-black">
              Marketing Dashboard
            </h1>

            <p className="mt-2 max-w-3xl text-sm text-zinc-300">
              One place to manage promotions, referrals, push campaigns,
              home banners, rewards, loyalty and marketing performance.
            </p>
          </div>

          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white ring-1 ring-white/20 hover:bg-white/20"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-zinc-900">
              Marketing Performance
            </h2>
            <p className="text-sm text-zinc-500">
              Live marketing KPIs from the last 30 days.
            </p>
          </div>

          <Link
            href="/admin/marketing/analytics"
            className="text-sm font-bold text-green-700 hover:text-green-800"
          >
            View full analytics →
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;

            return (
              <div
                key={card.label}
                className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <Icon className={`h-5 w-5 ${card.color}`} />
                  <span className="text-xs font-bold uppercase tracking-wide text-zinc-400">
                    Live
                  </span>
                </div>

                <p className="mt-5 text-xs font-bold uppercase tracking-wide text-zinc-400">
                  {card.label}
                </p>

                <p className="mt-1 text-2xl font-black text-zinc-900">
                  {card.value}
                </p>

                <p className="mt-1 text-xs text-zinc-500">{card.sub}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-black text-zinc-900">
          Marketing Tools
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {quickLinks.map((link) => {
            const Icon = link.icon;

            return (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div
                  className={`mb-4 inline-flex rounded-2xl p-3 ${link.color}`}
                >
                  <Icon className="h-5 w-5" />
                </div>

                <h2 className="font-black text-zinc-900">{link.label}</h2>

                <p className="mt-1 text-sm text-zinc-500">
                  {link.description}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="font-black text-zinc-900">Marketing Inventory</h2>

          <div className="mt-4 space-y-3">
            <MetricRow
              label="Promo codes"
              value={formatNumber(summary.promoCount)}
              detail={`${summary.activePromos} active`}
            />

            <MetricRow
              label="Promo uses"
              value={formatNumber(summary.promoUses)}
              detail="All recorded uses"
            />

            <MetricRow
              label="Referral records"
              value={formatNumber(summary.referralCount)}
              detail="Rider referrals"
            />

            <MetricRow
              label="Active banners"
              value={formatNumber(summary.activeBanners)}
              detail="Customer home"
            />

            <MetricRow
              label="Loyalty accounts"
              value={formatNumber(summary.loyaltyAccounts)}
              detail="Rider accounts"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="font-black text-zinc-900">
            Notification Performance
          </h2>

          <div className="mt-4 space-y-3">
            <MetricRow
              label="Sent"
              value={formatNumber(notifications.sent)}
              detail="Push notifications"
            />

            <MetricRow
              label="Delivered"
              value={formatNumber(notifications.delivered)}
              detail={`${deliveredRate.toFixed(1)}% delivery rate`}
            />

            <MetricRow
              label="Opened"
              value={formatNumber(notifications.opened)}
              detail={`${Number(notifications.ctr ?? 0).toFixed(1)}% CTR`}
            />

            <MetricRow
              label="Marketing opens"
              value={formatNumber(analytics.push_opens)}
              detail="Last 30 days"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="font-black text-zinc-900">Growth Snapshot</h2>

          <div className="mt-4 space-y-3">
            <MetricRow
              label="30-day revenue"
              value={formatCurrency(totalRevenue)}
              detail="Revenue timeline"
            />

            <MetricRow
              label="Latest retention"
              value={`${Number(latestRetention?.retention_pct ?? analytics.customer_retention).toFixed(1)}%`}
              detail={latestRetention?.month ?? "Current"}
            />

            <MetricRow
              label="Referral funnel"
              value={formatNumber(
                funnel.reduce((sum, row) => sum + Number(row.count ?? 0), 0),
              )}
              detail="Tracked funnel records"
            />
          </div>
        </div>
      </section>

      <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-sm text-green-900">
        <span className="font-black">Growth focus:</span>{" "}
        use promotions and referrals to acquire riders, push campaigns and
        banners to activate them, and loyalty/retention data to bring them
        back.
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
      <div>
        <p className="text-sm font-bold text-zinc-800">{label}</p>
        <p className="text-xs text-zinc-400">{detail}</p>
      </div>

      <p className="text-right text-sm font-black text-zinc-900">{value}</p>
    </div>
  );
}
