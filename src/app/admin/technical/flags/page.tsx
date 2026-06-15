"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  RefreshCw, ToggleLeft, ToggleRight, Search, Filter, Zap,
  Activity, Power, PowerOff, FlaskConical, Edit3, CheckCircle,
  Smartphone, Car, ShieldCheck, CreditCard, Megaphone, Settings,
  FileText, Bug, MoreHorizontal,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface PlatformFlag {
  id: string; feature_key: string; feature_name: string; description: string;
  category: string; is_enabled: boolean;
  enabled_for_riders: boolean; enabled_for_drivers: boolean; enabled_for_admin: boolean;
  rollout_percentage: number; environment: string;
  updated_at: string;
}

const CATEGORIES = [
  { key: "all", label: "All Features", icon: Zap },
  { key: "rider_app", label: "Rider App", icon: Smartphone },
  { key: "driver_app", label: "Driver App", icon: Car },
  { key: "admin", label: "Admin Dashboard", icon: Settings },
  { key: "payments", label: "Payments", icon: CreditCard },
  { key: "safety", label: "Safety", icon: ShieldCheck },
  { key: "marketing", label: "Marketing", icon: Megaphone },
  { key: "experimental", label: "Experimental", icon: FlaskConical },
];

const ENV_COLORS: Record<string, string> = {
  production: "bg-green-100 text-green-700",
  staging: "bg-amber-100 text-amber-700",
  development: "bg-purple-100 text-purple-700",
};

export default function FeatureFlagsPage() {
  const [loading, setLoading] = useState(true);
  const [flags, setFlags] = useState<PlatformFlag[]>([]);
  const [filteredFlags, setFilteredFlags] = useState<PlatformFlag[]>([]);
  const [activeCategory, setActiveCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState({ total: 0, enabled: 0, disabled: 0, beta: 0 });

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("platform_feature_flags")
        .select("*")
        .order("category")
        .order("feature_name");

      const all = (data || []) as PlatformFlag[];
      setFlags(all);
      setStats({
        total: all.length,
        enabled: all.filter(f => f.is_enabled).length,
        disabled: all.filter(f => !f.is_enabled).length,
        beta: all.filter(f => f.environment !== "production").length,
      });
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchFlags(); }, [fetchFlags]);

  // Filter
  useEffect(() => {
    let result = [...flags];
    if (activeCategory !== "all") {
      result = result.filter(f => f.category === activeCategory);
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(f =>
        f.feature_name.toLowerCase().includes(s) ||
        f.feature_key.toLowerCase().includes(s) ||
        (f.description || "").toLowerCase().includes(s)
      );
    }
    setFilteredFlags(result);
  }, [flags, activeCategory, search]);

  const toggleFlag = async (flag: PlatformFlag) => {
    const newVal = !flag.is_enabled;
    await supabase.from("platform_feature_flags")
      .update({ is_enabled: newVal, updated_at: new Date().toISOString() })
      .eq("id", flag.id);
    setFlags(prev => prev.map(f => f.id === flag.id ? { ...f, is_enabled: newVal } : f));
  };

  const updateRollout = async (flag: PlatformFlag, pct: number) => {
    await supabase.from("platform_feature_flags")
      .update({ rollout_percentage: pct, updated_at: new Date().toISOString() })
      .eq("id", flag.id);
    setFlags(prev => prev.map(f => f.id === flag.id ? { ...f, rollout_percentage: pct } : f));
  };

  const updateEnvironment = async (flag: PlatformFlag, env: string) => {
    await supabase.from("platform_feature_flags")
      .update({ environment: env, updated_at: new Date().toISOString() })
      .eq("id", flag.id);
    setFlags(prev => prev.map(f => f.id === flag.id ? { ...f, environment: env } : f));
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-gray-200 rounded w-64 animate-pulse"/>
        <div className="grid grid-cols-4 gap-4">
          {Array.from({length:4}).map((_,i)=><div key={i} className="h-[120px] bg-gray-100 rounded-2xl animate-pulse"/>)}
        </div>
        <div className="h-96 bg-gray-100 rounded-2xl animate-pulse"/>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── HEADER ─── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Platform Control Center</h1>
          <p className="text-sm text-gray-500 mt-1">Toggle features on/off across rider app, driver app, and admin dashboard. Changes take effect immediately.</p>
        </div>
        <button onClick={fetchFlags} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
          <RefreshCw className="h-4 w-4"/> Refresh
        </button>
      </div>

      {/* ─── STATS CARDS ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Features", value: stats.total, icon: Zap, color: "bg-blue-50 text-blue-600" },
          { label: "Enabled", value: stats.enabled, icon: Power, color: "bg-green-50 text-green-600" },
          { label: "Disabled", value: stats.disabled, icon: PowerOff, color: "bg-gray-100 text-gray-500" },
          { label: "Beta / Staging", value: stats.beta, icon: FlaskConical, color: "bg-purple-50 text-purple-600" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-4" style={{minHeight: 110}}>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${s.color}`}><s.icon className="h-6 w-6"/></div>
            <div><p className="text-2xl font-bold text-gray-900">{formatNumber(s.value)}</p><p className="text-xs text-gray-400">{s.label}</p></div>
          </div>
        ))}
      </div>

      {/* ─── CATEGORY TABS ─── */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto pb-1">
        {CATEGORIES.map(c => (
          <button key={c.key} onClick={() => setActiveCategory(c.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeCategory === c.key ? "border-green-600 text-green-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            <c.icon className="h-3.5 w-3.5"/>{c.label}
          </button>
        ))}
      </div>

      {/* ─── SEARCH ─── */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"/>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search features..." className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-xs"/>
      </div>

      {/* ─── FEATURE TABLE ─── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-xs font-medium">Feature</th>
                <th className="px-4 py-3 text-xs font-medium">Category</th>
                <th className="px-4 py-3 text-xs font-medium">Status</th>
                <th className="px-4 py-3 text-xs font-medium">Apps</th>
                <th className="px-4 py-3 text-xs font-medium">Rollout</th>
                <th className="px-4 py-3 text-xs font-medium">Env</th>
                <th className="px-4 py-3 text-xs font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredFlags.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-30"/>
                  <p className="text-sm">No features found</p>
                </td></tr>
              ) : filteredFlags.map(flag => {
                const apps: string[] = [];
                if (flag.enabled_for_riders) apps.push("Rider");
                if (flag.enabled_for_drivers) apps.push("Driver");
                if (flag.enabled_for_admin) apps.push("Admin");
                const cat = CATEGORIES.find(c => c.key === flag.category);

                return (
                  <tr key={flag.id} className="border-b border-gray-50 hover:bg-gray-50">
                    {/* Feature name + description */}
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-gray-900">{flag.feature_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{flag.description}</p>
                    </td>

                    {/* Category */}
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[10px] font-medium">
                        {cat ? <cat.icon className="h-3 w-3"/> : null}
                        {cat?.label || flag.category}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        flag.is_enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}>
                        {flag.is_enabled ? <CheckCircle className="h-3 w-3"/> : <PowerOff className="h-3 w-3"/>}
                        {flag.is_enabled ? "Enabled" : "Disabled"}
                      </span>
                    </td>

                    {/* Affected Apps */}
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {apps.length > 0 ? apps.map(a => (
                          <span key={a} className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium">{a}</span>
                        )) : <span className="text-[10px] text-gray-400">—</span>}
                      </div>
                    </td>

                    {/* Rollout */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 rounded-full transition-all" style={{width:`${flag.rollout_percentage}%`}}/>
                        </div>
                        <select value={flag.rollout_percentage} onChange={e => updateRollout(flag, Number(e.target.value))}
                          className="text-[10px] border rounded px-1 py-0.5 bg-white">
                          {[0,25,50,75,100].map(p => <option key={p} value={p}>{p}%</option>)}
                        </select>
                      </div>
                    </td>

                    {/* Environment */}
                    <td className="px-4 py-3">
                      <select value={flag.environment} onChange={e => updateEnvironment(flag, e.target.value)}
                        className={`text-[10px] border rounded px-2 py-0.5 font-medium ${ENV_COLORS[flag.environment] || ""}`}>
                        <option value="production">Production</option>
                        <option value="staging">Staging</option>
                        <option value="development">Dev</option>
                      </select>
                    </td>

                    {/* Toggle + Action buttons */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => toggleFlag(flag)}
                          className={`${flag.is_enabled ? "text-green-600" : "text-gray-300"} hover:scale-110 transition-transform`}
                          title={flag.is_enabled ? "Disable" : "Enable"}>
                          {flag.is_enabled ? <ToggleRight className="h-7 w-7"/> : <ToggleLeft className="h-7 w-7"/>}
                        </button>

                        <button className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors" title="Edit details (name, description, apps, city/country scope)">
                          <Edit3 className="h-3.5 w-3.5 text-blue-500"/>
                        </button>

                        <button className="p-1.5 hover:bg-purple-50 rounded-lg transition-colors" title="View usage logs">
                          <FileText className="h-3.5 w-3.5 text-purple-500"/>
                        </button>

                        <button className="p-1.5 hover:bg-red-50 rounded-lg transition-colors" title="View error logs">
                          <Bug className="h-3.5 w-3.5 text-red-400"/>
                        </button>

                        <button className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors" title="More options">
                          <MoreHorizontal className="h-3.5 w-3.5 text-gray-400"/>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}