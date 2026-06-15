"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  BarChart3, TrendingUp, Users, DollarSign, Download, Clock,
  Car, Activity, UserCheck, AlertTriangle, RefreshCw, MapPin,
  CreditCard, Gift, Bell, Shield, Calendar, Filter,
  CheckCircle, XCircle,
} from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";

const COLORS = ["#22c55e", "#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

export default function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [revenuePeriod, setRevenuePeriod] = useState<"daily" | "weekly" | "monthly">("daily");

  // Platform stats (16 KPIs)
  const [stats, setStats] = useState<Record<string, number>>({});

  // Chart data
  const [revenueData, setRevenueData] = useState<{period_label: string; gross: number; driver_earnings: number; commission: number}[]>([]);
  const [tripsByHour, setTripsByHour] = useState<{hour: number; count: number}[]>([]);
  const [tripsByCity, setTripsByCity] = useState<{city: string; count: number; revenue: number}[]>([]);
  const [rideTypes, setRideTypes] = useState<{ride_type: string; total: number; cancelled_pct: number; avg_fare: number}[]>([]);
  const [topDrivers, setTopDrivers] = useState<{name: string; trips: number; acceptance_pct: number; cancellation_pct: number; rating: number; revenue: number; city: string}[]>([]);
  const [topRiders, setTopRiders] = useState<{name: string; trips: number; total_spent: number; city: string}[]>([]);
  const [liveOps, setLiveOps] = useState<{online_drivers: number; active_trips: number; searching_riders: number; queue_waiting: number}>({online_drivers:0,active_trips:0,searching_riders:0,queue_waiting:0});
  const [referralFunnel, setReferralFunnel] = useState<{stage: string; count: number}[]>([]);
  const [notifAnalytics, setNotifAnalytics] = useState<{sent: number; delivered: number; opened: number; ctr: number} | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, revenueRes, hourRes, cityRes, typesRes, driversRes, ridersRes, liveRes, funnelRes, notifRes] = await Promise.all([
        supabase.rpc("get_platform_stats"),
        supabase.rpc("get_revenue_timeline", { p_period: revenuePeriod }),
        supabase.rpc("get_trips_by_hour"),
        supabase.rpc("get_trips_by_city"),
        supabase.rpc("get_ride_type_breakdown"),
        supabase.rpc("get_top_driver_performance", { p_limit: 10 }),
        supabase.rpc("get_top_riders", { p_limit: 10 }),
        supabase.rpc("get_live_operations"),
        supabase.rpc("get_referral_funnel"),
        supabase.rpc("get_notification_analytics"),
      ]);

      if (statsRes.data) setStats(statsRes.data as Record<string, number>);
      if (revenueRes.data) setRevenueData(revenueRes.data as typeof revenueData);
      if (hourRes.data) setTripsByHour(hourRes.data as typeof tripsByHour);
      if (cityRes.data) setTripsByCity(cityRes.data as typeof tripsByCity);
      if (typesRes.data) setRideTypes(typesRes.data as typeof rideTypes);
      if (driversRes.data) setTopDrivers(driversRes.data as typeof topDrivers);
      if (ridersRes.data) setTopRiders(ridersRes.data as typeof topRiders);
      if (liveRes.data) setLiveOps(liveRes.data as typeof liveOps);
      if (funnelRes.data) setReferralFunnel(funnelRes.data as typeof referralFunnel);
      if (notifRes.data && Array.isArray(notifRes.data) && notifRes.data.length > 0) {
        setNotifAnalytics(notifRes.data[0] as typeof notifAnalytics);
      }
    } catch (err) { console.error("Analytics fetch error:", err); }
    finally { setLoading(false); }
  }, [revenuePeriod]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Live ops auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      const { data } = await supabase.rpc("get_live_operations");
      if (data) setLiveOps(data as typeof liveOps);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const kpiCards = [
    { label: "Total Rides", value: stats.total_rides, icon: BarChart3, color: "text-blue-600 bg-blue-50" },
    { label: "Total Drivers", value: stats.total_drivers, icon: Car, color: "text-purple-600 bg-purple-50" },
    { label: "Total Riders", value: stats.total_riders, icon: Users, color: "text-indigo-600 bg-indigo-50" },
    { label: "Gross Revenue", value: stats.gross_revenue, icon: DollarSign, color: "text-green-600 bg-green-50", isCurrency: true },
    { label: "Online Drivers", value: stats.online_drivers, icon: Activity, color: "text-emerald-600 bg-emerald-50" },
    { label: "Active Riders Today", value: stats.active_riders_today, icon: UserCheck, color: "text-cyan-600 bg-cyan-50" },
    { label: "Completed Today", value: stats.completed_today, icon: CheckCircle, color: "text-teal-600 bg-teal-50" },
    { label: "Cancelled", value: stats.cancelled_today, icon: XCircle, color: "text-red-600 bg-red-50" },
    { label: "Pending Trips", value: stats.pending_trips, icon: Clock, color: "text-amber-600 bg-amber-50" },
    { label: "Avg Ride Time", value: stats.avg_ride_time_min, icon: Clock, color: "text-orange-600 bg-orange-50", suffix: " min" },
    { label: "Avg Distance", value: stats.avg_distance_km, icon: MapPin, color: "text-rose-600 bg-rose-50", suffix: " km" },
    { label: "Driver Earnings Today", value: stats.driver_earnings_today, icon: DollarSign, color: "text-lime-600 bg-lime-50", isCurrency: true },
    { label: "Company Profit", value: stats.company_profit, icon: TrendingUp, color: "text-violet-600 bg-violet-50", isCurrency: true },
    { label: "Refunds", value: stats.refunds_total, icon: CreditCard, color: "text-pink-600 bg-pink-50", isCurrency: true },
    { label: "New Signups Today", value: stats.new_signups_today, icon: Users, color: "text-sky-600 bg-sky-50" },
    { label: "Safety Incidents", value: stats.safety_incidents, icon: Shield, color: "text-red-600 bg-red-50" },
  ];

  return (
    <div className="space-y-6">
      {/* ─── HEADER + FILTER BAR ─── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics & Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Complete business intelligence across rides, drivers, riders, revenue, referrals & safety</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={revenuePeriod} onChange={e => setRevenuePeriod(e.target.value as typeof revenuePeriod)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-xs font-medium">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <button onClick={fetchAll} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50">
            <RefreshCw className="h-3.5 w-3.5"/> Refresh
          </button>
          <button className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700">
            <Download className="h-3.5 w-3.5"/> Export CSV
          </button>
        </div>
      </div>

      {/* ─── KPI CARDS (16 cards, 4 per row) ─── */}
      {loading && Object.keys(stats).length === 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({length:8}).map((_,i)=>(
            <div key={i} className="bg-white rounded-2xl border border-gray-200 p-5 animate-pulse h-[120px]">
              <div className="h-3 bg-gray-200 rounded w-16 mb-3"/><div className="h-6 bg-gray-200 rounded w-24"/>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          {kpiCards.map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-200 p-4 lg:col-span-2" style={{minHeight:120}}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg ${s.color}`}>
                  {s.label.includes("Revenue") || s.label.includes("Earnings") || s.label.includes("Profit") || s.label.includes("Refunds")
                    ? <DollarSign className="h-4 w-4"/>
                    : s.label.includes("Rides") ? <BarChart3 className="h-4 w-4"/>
                    : s.label.includes("Drivers") ? <Car className="h-4 w-4"/>
                    : s.label.includes("Riders") || s.label.includes("Signups") ? <Users className="h-4 w-4"/>
                    : s.label.includes("Online") ? <Activity className="h-4 w-4"/>
                    : s.label.includes("Cancelled") ? <XCircle className="h-4 w-4"/>
                    : s.label.includes("Completed") ? <CheckCircle className="h-4 w-4"/>
                    : s.label.includes("Pending") ? <Clock className="h-4 w-4"/>
                    : s.label.includes("Time") ? <Clock className="h-4 w-4"/>
                    : s.label.includes("Distance") ? <MapPin className="h-4 w-4"/>
                    : s.label.includes("Safety") ? <Shield className="h-4 w-4"/>
                    : <BarChart3 className="h-4 w-4"/>
                  }
                </div>
                <span className="text-[11px] text-gray-400 font-medium leading-tight">{s.label}</span>
              </div>
              <p className="text-xl font-bold text-gray-900">
                {s.isCurrency ? formatCurrency(s.value || 0) : formatNumber(s.value || 0)}{s.suffix || ""}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ─── LIVE OPERATIONS BAR ─── */}
      <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"/><span className="text-xs font-medium text-green-800">Live</span></div>
        <div className="flex items-center gap-1"><Car className="h-4 w-4 text-green-600"/><span className="text-xs text-green-700"><strong>{liveOps.online_drivers}</strong> online drivers</span></div>
        <div className="flex items-center gap-1"><Activity className="h-4 w-4 text-blue-600"/><span className="text-xs text-blue-700"><strong>{liveOps.active_trips}</strong> active trips</span></div>
        <div className="flex items-center gap-1"><Users className="h-4 w-4 text-amber-600"/><span className="text-xs text-amber-700"><strong>{liveOps.searching_riders}</strong> searching</span></div>
        <div className="flex items-center gap-1"><Clock className="h-4 w-4 text-purple-600"/><span className="text-xs text-purple-700"><strong>{liveOps.queue_waiting}</strong> in queue</span></div>
        <span className="text-[10px] text-gray-400 ml-auto">Auto-refreshes every 30s</span>
      </div>

      {/* ─── CHARTS ROW 1: Revenue + Trips by Hour ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Timeline */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Revenue Timeline ({revenuePeriod})</h3>
          {revenueData.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-gray-400 text-xs">No revenue data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="period_label" stroke="#9ca3af" fontSize={10}/>
                <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => v>=1000?`${(v/1000).toFixed(0)}k`:String(v)}/>
                <Tooltip formatter={(v)=>[formatCurrency(Number(v)||0)]}/>
                <Line type="monotone" dataKey="gross" stroke="#22c55e" strokeWidth={2} name="Gross" dot={false}/>
                <Line type="monotone" dataKey="driver_earnings" stroke="#3b82f6" strokeWidth={2} name="Driver" dot={false}/>
                <Line type="monotone" dataKey="commission" stroke="#f59e0b" strokeWidth={2} name="Commission" dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Trips by Hour */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Trips by Hour (7 days)</h3>
          {tripsByHour.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-gray-400 text-xs">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={tripsByHour}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="hour" stroke="#9ca3af" fontSize={10} tickFormatter={h=>`${h}h`}/>
                <YAxis stroke="#9ca3af" fontSize={10}/>
                <Tooltip/>
                <Bar dataKey="count" fill="#22c55e" radius={[4,4,0,0]} name="Trips"/>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ─── CHARTS ROW 2: City + Ride Types ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trips by City */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Trips by City</h3>
          {tripsByCity.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-gray-400 text-xs">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={tripsByCity} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis type="number" stroke="#9ca3af" fontSize={10}/>
                <YAxis type="category" dataKey="city" stroke="#9ca3af" fontSize={10} width={80}/>
                <Tooltip formatter={(v)=>[formatNumber(Number(v)||0)]}/>
                <Bar dataKey="count" fill="#8b5cf6" radius={[0,4,4,0]} name="Trips"/>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Ride Type Breakdown */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Ride Type Breakdown</h3>
          {rideTypes.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-gray-400 text-xs">No data yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-500 border-b"><th className="pb-2 font-medium">Type</th><th className="pb-2 font-medium text-right">Trips</th><th className="pb-2 font-medium text-right">Cancel %</th><th className="pb-2 font-medium text-right">Avg Fare</th></tr></thead>
                <tbody>{rideTypes.map((r,i) => (
                  <tr key={r.ride_type} className="border-b border-gray-50">
                    <td className="py-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{backgroundColor:COLORS[i%COLORS.length]}}/>
                      <span className="capitalize">{r.ride_type}</span>
                    </td>
                    <td className="py-2 text-right font-medium">{formatNumber(r.total)}</td>
                    <td className="py-2 text-right text-red-500">{r.cancelled_pct}%</td>
                    <td className="py-2 text-right">{formatCurrency(r.avg_fare)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ─── TABLES ROW: Top Drivers + Top Riders ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Drivers */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Top Drivers</h3>
          {topDrivers.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-xs">No data yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-500 border-b"><th className="pb-2">#</th><th className="pb-2">Driver</th><th className="pb-2 text-right">Trips</th><th className="pb-2 text-right">Rating</th><th className="pb-2 text-right">Revenue</th><th className="pb-2">City</th></tr></thead>
                <tbody>{topDrivers.map((d,i)=>(
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-400 font-bold">{i+1}</td>
                    <td className="py-2 font-medium">{d.name}</td>
                    <td className="py-2 text-right">{d.trips}</td>
                    <td className="py-2 text-right">⭐{d.rating}</td>
                    <td className="py-2 text-right text-green-600">{formatCurrency(d.revenue)}</td>
                    <td className="py-2 text-gray-400">{d.city}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>

        {/* Top Riders */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Top Riders</h3>
          {topRiders.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-xs">No data yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-500 border-b"><th className="pb-2">#</th><th className="pb-2">Rider</th><th className="pb-2 text-right">Trips</th><th className="pb-2 text-right">Spent</th><th className="pb-2">City</th></tr></thead>
                <tbody>{topRiders.map((r,i)=>(
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-400 font-bold">{i+1}</td>
                    <td className="py-2 font-medium">{r.name}</td>
                    <td className="py-2 text-right">{r.trips}</td>
                    <td className="py-2 text-right text-blue-600">{formatCurrency(r.total_spent)}</td>
                    <td className="py-2 text-gray-400">{r.city}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ─── REFERRAL FUNNEL + NOTIFICATIONS ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Referral Funnel */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Referral Funnel</h3>
          {referralFunnel.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-xs">No referrals yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={referralFunnel}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="stage" stroke="#9ca3af" fontSize={10} tickFormatter={s=>s.replace(/_/g,' ')}/>
                <YAxis stroke="#9ca3af" fontSize={10}/>
                <Tooltip/>
                <Bar dataKey="count" fill="#f59e0b" radius={[4,4,0,0]}>
                  {referralFunnel.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Notification Analytics */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Push Notifications</h3>
          {!notifAnalytics ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-xs">No notifications sent yet</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 rounded-xl p-4 text-center">
                  <p className="text-xs text-blue-600 font-medium">Sent</p>
                  <p className="text-xl font-bold text-blue-800">{formatNumber(notifAnalytics.sent)}</p>
                </div>
                <div className="bg-green-50 rounded-xl p-4 text-center">
                  <p className="text-xs text-green-600 font-medium">Delivered</p>
                  <p className="text-xl font-bold text-green-800">{formatNumber(notifAnalytics.delivered)}</p>
                </div>
                <div className="bg-purple-50 rounded-xl p-4 text-center">
                  <p className="text-xs text-purple-600 font-medium">Opened</p>
                  <p className="text-xl font-bold text-purple-800">{formatNumber(notifAnalytics.opened)}</p>
                </div>
                <div className="bg-amber-50 rounded-xl p-4 text-center">
                  <p className="text-xs text-amber-600 font-medium">CTR</p>
                  <p className="text-xl font-bold text-amber-800">{notifAnalytics.ctr}%</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}