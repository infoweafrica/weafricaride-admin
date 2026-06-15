"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  Settings, Clock, Percent, Landmark, Shield, Save, RefreshCw,
  CheckCircle, XCircle, Edit3, DollarSign, Wallet, AlertTriangle,
  Building2, TrendingUp, ArrowDownUp,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

// ─── TYPES ──────────────────────────────────────────────────

interface PayoutSetting { setting_key: string; setting_value: string; description?: string; }
interface CommissionConfig { vehicle_class: string; commission_percent: number; driver_percent: number; min_commission: number; max_commission: number; is_active: boolean; notes: string; }
interface TaxConfig { tax_name: string; tax_percent: number; fixed_amount: number; tax_type: string; applies_to: string; is_active: boolean; description: string; }
interface FraudRule { rule_name: string; rule_type: string; threshold_value: number; threshold_count: number; action: string; is_active: boolean; description: string; }

const VEHICLE_LABELS: Record<string, string> = {
  economy: "WeAfrica X", comfort: "WeAfrica XL", women: "WeAfrica Women",
  premium: "WeAfrica Black", boda: "Boda", delivery: "Delivery",
  van: "Van", shuttle: "Shuttle",
};

// ─── SECTION TABS ──────────────────────────────────────────

type Section = "schedule" | "commission" | "tax" | "fraud";
const SECTIONS: { key: Section; label: string; icon: React.ReactNode }[] = [
  { key: "schedule", label: "Payout Schedule", icon: <Clock className="h-4 w-4" /> },
  { key: "commission", label: "Commission Rates", icon: <Percent className="h-4 w-4" /> },
  { key: "tax", label: "Tax Settings", icon: <Landmark className="h-4 w-4" /> },
  { key: "fraud", label: "Fraud Protection", icon: <Shield className="h-4 w-4" /> },
];

// ─── PAGE ───────────────────────────────────────────────────

export default function PayoutSettingsPage() {
  const [activeSection, setActiveSection] = useState<Section>("schedule");
  const [loading, setLoading] = useState(true);

  // Schedule
  const [scheduleSettings, setScheduleSettings] = useState<PayoutSetting[]>([]);
  const [editingScheduleKey, setEditingScheduleKey] = useState<string | null>(null);
  const [scheduleEditValue, setScheduleEditValue] = useState("");

  // Commission
  const [commissions, setCommissions] = useState<CommissionConfig[]>([]);
  const [editingCommission, setEditingCommission] = useState<string | null>(null);
  const [editCommissionPct, setEditCommissionPct] = useState<number>(20);

  // Tax
  const [taxConfigs, setTaxConfigs] = useState<TaxConfig[]>([]);
  const [editingTax, setEditingTax] = useState<string | null>(null);
  const [editTaxPct, setEditTaxPct] = useState<number>(0);
  const [editTaxAppliesTo, setEditTaxAppliesTo] = useState("both");
  const [editTaxActive, setEditTaxActive] = useState(true);

  // Fraud
  const [fraudRules, setFraudRules] = useState<FraudRule[]>([]);
  const [editingFraud, setEditingFraud] = useState<string | null>(null);
  const [editFraudValue, setEditFraudValue] = useState<number>(0);
  const [editFraudCount, setEditFraudCount] = useState<number>(0);

  // ── Fetch ──
  const fetchSchedule = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_get_payout_settings");
      if (data) {
        setScheduleSettings(Object.entries(data as Record<string, string>).map(([k, v]) => ({
          setting_key: k, setting_value: v,
        })));
      }
    } catch { /* */ }
  }, []);

  const fetchCommissions = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_list_commission_configs");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = ((data as any)?.data || []) as CommissionConfig[];
      setCommissions(raw);
    } catch { /* */ }
  }, []);

  const fetchTaxConfigs = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_list_tax_configs");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = ((data as any)?.data || []) as TaxConfig[];
      setTaxConfigs(raw);
    } catch { /* */ }
  }, []);

  const fetchFraudRules = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_list_fraud_rules");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = ((data as any)?.data || []) as FraudRule[];
      setFraudRules(raw);
    } catch { /* */ }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchSchedule(), fetchCommissions(), fetchTaxConfigs(), fetchFraudRules()]);
    setLoading(false);
  }, [fetchSchedule, fetchCommissions, fetchTaxConfigs, fetchFraudRules]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Save Actions ──
  const saveScheduleSetting = async (key: string) => {
    await supabase.rpc("admin_update_payout_setting", { p_key: key, p_value: scheduleEditValue });
    setEditingScheduleKey(null);
    fetchSchedule();
  };

  const saveCommission = async (vehicleClass: string) => {
    await supabase.rpc("admin_update_commission_config", {
      p_vehicle_class: vehicleClass,
      p_commission_percent: editCommissionPct,
    });
    setEditingCommission(null);
    fetchCommissions();
  };

  const saveTaxConfig = async (taxName: string) => {
    await supabase.rpc("admin_update_tax_config", {
      p_tax_name: taxName,
      p_tax_percent: editTaxPct,
      p_is_active: editTaxActive,
      p_applies_to: editTaxAppliesTo,
    });
    setEditingTax(null);
    fetchTaxConfigs();
  };

  const saveFraudRule = async (ruleName: string) => {
    await supabase.rpc("admin_update_fraud_rule", {
      p_rule_name: ruleName,
      p_threshold_value: editFraudValue,
      p_threshold_count: editFraudCount,
    });
    setEditingFraud(null);
    fetchFraudRules();
  };

  const toggleFraudRule = async (ruleName: string, currentActive: boolean) => {
    await supabase.rpc("admin_update_fraud_rule", {
      p_rule_name: ruleName,
      p_is_active: !currentActive,
    });
    fetchFraudRules();
  };

  if (loading) return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" /></div>;

  // ─── RENDER ───────────────────────────────────────────────

  return (
    <div className="space-y-6" style={{ padding: 32 }}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800 }} className="text-gray-900">Payout Settings</h1>
          <p style={{ fontSize: 15 }} className="text-gray-500 mt-1">Configure payout schedule, commission rates, tax settings, and fraud protection for driver payouts</p>
        </div>
        <button onClick={fetchAll} className="flex items-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50" style={{ height: 44 }}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Section Tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {SECTIONS.map(s => (
          <button key={s.key} onClick={() => setActiveSection(s.key)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeSection === s.key ? "border-green-600 text-green-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
            style={{ height: 48, fontSize: 15 }}
          >{s.icon}{s.label}</button>
        ))}
      </div>

      {/* ═══════ 1. PAYOUT SCHEDULE ═══════ */}
      {activeSection === "schedule" && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center"><Clock className="h-5 w-5 text-amber-600" /></div>
            <div><h3 className="text-lg font-semibold text-gray-900">Payout Schedule</h3><p className="text-sm text-gray-500">Controls when and how drivers receive money</p></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {scheduleSettings.map(s => (
              <div key={s.setting_key} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                <div className="flex-1">
                  <p className="text-xs text-gray-400 uppercase tracking-wide">{s.setting_key.replace(/_/g, " ")}</p>
                  {editingScheduleKey === s.setting_key ? (
                    <input type="text" value={scheduleEditValue} onChange={e => setScheduleEditValue(e.target.value)}
                      className="mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm w-full focus:ring-2 focus:ring-green-500 focus:outline-none" autoFocus />
                  ) : (
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">{s.setting_value}</p>
                  )}
                </div>
                <div className="flex gap-1.5 ml-4">
                  {editingScheduleKey === s.setting_key ? (
                    <>
                      <button onClick={() => saveScheduleSetting(s.setting_key)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium"><Save className="h-3 w-3 inline mr-1" />Save</button>
                      <button onClick={() => setEditingScheduleKey(null)} className="px-3 py-1.5 border rounded-lg text-xs text-gray-500">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => { setEditingScheduleKey(s.setting_key); setScheduleEditValue(s.setting_value); }}
                      className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-500 hover:bg-gray-100"><Edit3 className="h-3 w-3" /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════ 2. COMMISSION RATES ═══════ */}
      {activeSection === "commission" && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center"><Percent className="h-5 w-5 text-purple-600" /></div>
            <div><h3 className="text-lg font-semibold text-gray-900">Commission Rates</h3><p className="text-sm text-gray-500">Per-vehicle-class company commission. Driver earns the remainder.</p></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200" style={{ height: 48 }}>
                  <th className="px-4 py-3 text-xs font-medium">Vehicle Class</th>
                  <th className="px-4 py-3 text-xs font-medium">Commission %</th>
                  <th className="px-4 py-3 text-xs font-medium">Driver %</th>
                  <th className="px-4 py-3 text-xs font-medium">Min Commission</th>
                  <th className="px-4 py-3 text-xs font-medium">Max Commission</th>
                  <th className="px-4 py-3 text-xs font-medium">Status</th>
                  <th className="px-4 py-3 text-xs font-medium text-right">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {commissions.map(c => (
                  <tr key={c.vehicle_class} className="hover:bg-gray-50" style={{ height: 56 }}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{VEHICLE_LABELS[c.vehicle_class] || c.vehicle_class}</td>
                    <td className="px-4 py-3">
                      {editingCommission === c.vehicle_class ? (
                        <input type="number" value={editCommissionPct} onChange={e => setEditCommissionPct(parseFloat(e.target.value) || 0)}
                          className="w-20 px-2 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                      ) : (
                        <span className="font-semibold text-purple-600">{c.commission_percent}%</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{c.driver_percent}%</td>
                    <td className="px-4 py-3 text-gray-500">{c.min_commission > 0 ? formatCurrency(c.min_commission) : "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{c.max_commission > 0 ? formatCurrency(c.max_commission) : "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${c.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>
                        {c.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingCommission === c.vehicle_class ? (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => saveCommission(c.vehicle_class)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs"><Save className="h-3 w-3 inline mr-1" />Save</button>
                          <button onClick={() => setEditingCommission(null)} className="px-3 py-1.5 border rounded-lg text-xs">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditingCommission(c.vehicle_class); setEditCommissionPct(c.commission_percent); }}
                          className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-500 hover:bg-gray-100"><Edit3 className="h-3 w-3" /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
            <strong>Malawi Setup:</strong> Driver earns → Wallet → Withdraw → Airtel Money / TNM Mpamba. Commission is deducted per trip before wallet credit.
          </div>
        </div>
      )}

      {/* ═══════ 3. TAX SETTINGS ═══════ */}
      {activeSection === "tax" && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center"><Landmark className="h-5 w-5 text-indigo-600" /></div>
            <div><h3 className="text-lg font-semibold text-gray-900">Tax Settings</h3><p className="text-sm text-gray-500">Configure applicable taxes for driver earnings and company revenue</p></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {taxConfigs.map(t => (
              <div key={t.tax_name} className="p-5 bg-gray-50 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-900">{t.tax_name}</h4>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${t.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>
                    {t.is_active ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <p className="text-xs text-gray-500">{t.description}</p>

                {editingTax === t.tax_name ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[11px] text-gray-400">Rate (%)</label>
                      <input type="number" step="0.1" value={editTaxPct} onChange={e => setEditTaxPct(parseFloat(e.target.value) || 0)}
                        className="w-full mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400">Applies To</label>
                      <select value={editTaxAppliesTo} onChange={e => setEditTaxAppliesTo(e.target.value)}
                        className="w-full mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white">
                        <option value="driver">Driver Only</option><option value="company">Company Only</option><option value="both">Both</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={editTaxActive} onChange={e => setEditTaxActive(e.target.checked)} className="rounded" />
                      <label className="text-xs text-gray-600">Active</label>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveTaxConfig(t.tax_name)} className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-xs"><Save className="h-3 w-3 inline mr-1" />Save</button>
                      <button onClick={() => setEditingTax(null)} className="px-4 py-1.5 border rounded-lg text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-gray-400">Rate:</span> <span className="font-semibold">{t.tax_percent}%</span></div>
                    <div><span className="text-gray-400">Type:</span> <span className="font-medium">{t.tax_type}</span></div>
                    <div><span className="text-gray-400">Applies to:</span> <span className="font-medium">{t.applies_to}</span></div>
                    <div><span className="text-gray-400">Fixed:</span> <span className="font-medium">{t.fixed_amount > 0 ? formatCurrency(t.fixed_amount) : "—"}</span></div>
                    <button onClick={() => { setEditingTax(t.tax_name); setEditTaxPct(t.tax_percent); setEditTaxAppliesTo(t.applies_to); setEditTaxActive(t.is_active); }}
                      className="mt-2 px-3 py-1.5 border border-gray-200 rounded-lg text-xs hover:bg-gray-100 col-span-2 text-center"><Edit3 className="h-3 w-3 inline mr-1" />Edit</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════ 4. FRAUD PROTECTION ═══════ */}
      {activeSection === "fraud" && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center"><Shield className="h-5 w-5 text-red-600" /></div>
            <div><h3 className="text-lg font-semibold text-gray-900">Fraud Protection</h3><p className="text-sm text-gray-500">Prevent abuse with withdrawal limits, manual reviews, and freezing suspicious accounts</p></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fraudRules.map(f => (
              <div key={f.rule_name} className={`p-5 rounded-xl border-2 transition-colors ${f.is_active ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50 opacity-60"}`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-900">{f.rule_name}</h4>
                  <button onClick={() => toggleFraudRule(f.rule_name, f.is_active)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${f.is_active ? "bg-green-500" : "bg-gray-300"}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${f.is_active ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
                <p className="text-xs text-gray-500 mb-3">{f.description}</p>

                {editingFraud === f.rule_name ? (
                  <div className="space-y-2">
                    {f.threshold_value > 0 && (
                      <div>
                        <label className="text-[11px] text-gray-400">Threshold Value (MWK)</label>
                        <input type="number" value={editFraudValue} onChange={e => setEditFraudValue(parseFloat(e.target.value) || 0)}
                          className="w-full mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
                      </div>
                    )}
                    {f.threshold_count > 0 && (
                      <div>
                        <label className="text-[11px] text-gray-400">Threshold Count</label>
                        <input type="number" value={editFraudCount} onChange={e => setEditFraudCount(parseInt(e.target.value) || 0)}
                          className="w-full mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
                      </div>
                    )}
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => saveFraudRule(f.rule_name)} className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-xs"><Save className="h-3 w-3 inline mr-1" />Save</button>
                      <button onClick={() => setEditingFraud(null)} className="px-4 py-1.5 border rounded-lg text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs">
                    {f.threshold_value > 0 && <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-600">Limit: {formatCurrency(f.threshold_value)}</span>}
                    {f.threshold_count > 0 && <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-600">Count: {f.threshold_count}</span>}
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      f.action === "block" ? "bg-red-100 text-red-700" : f.action === "manual_review" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                    }`}>Action: {f.action}</span>
                    <button onClick={() => { setEditingFraud(f.rule_name); setEditFraudValue(f.threshold_value); setEditFraudCount(f.threshold_count); }}
                      className="ml-auto px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50"><Edit3 className="h-3 w-3" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}