"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { PricingRule, RideCategory, Country } from "@/lib/types";
import { Save, Plus } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function PricingPage() {
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [categories, setCategories] = useState<RideCategory[]>([]);
  const [selectedCity, setSelectedCity] = useState("Lilongwe");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, Partial<PricingRule>>>({});

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: cats } = await supabase.from("ride_categories").select("*").order("sort_order");
      setCategories(cats || []);
      const { data: rules } = await supabase.from("pricing_rules").select("*, category:ride_categories(name, slug), city:cities(name)").order("category_id");
      setPricingRules(rules || []);
      const init: Record<string, Partial<PricingRule>> = {};
      (rules || []).forEach(r => { init[r.id] = { base_fare: r.base_fare, price_per_km: r.price_per_km, price_per_minute: r.price_per_minute, minimum_fare: r.minimum_fare, cancellation_fee: r.cancellation_fee, waiting_fee_per_minute: r.waiting_fee_per_minute }; });
      setEditing(init);
    } catch {
      setCategories([
        { id: "c1", name: "Economy", slug: "economy", description: "Affordable rides", icon: "", min_seats: 1, max_seats: 4, base_fare_multiplier: 1, per_km_multiplier: 1, per_min_multiplier: 1, is_active: true, sort_order: 1, created_at: new Date().toISOString() },
        { id: "c2", name: "Comfort", slug: "comfort", description: "More space", icon: "", min_seats: 1, max_seats: 4, base_fare_multiplier: 1.5, per_km_multiplier: 1.3, per_min_multiplier: 1.2, is_active: true, sort_order: 2, created_at: new Date().toISOString() },
        { id: "c3", name: "XL", slug: "xl", description: "Group rides", icon: "", min_seats: 4, max_seats: 7, base_fare_multiplier: 2, per_km_multiplier: 1.8, per_min_multiplier: 1.5, is_active: true, sort_order: 3, created_at: new Date().toISOString() },
      ]);
      setPricingRules(categories.map((cat, i) => ({
        id: `p${i}`, name: cat.name, country_code: "mw" as Country,
        base_fare: 500, price_per_km: 300, price_per_minute: 50, minimum_fare: 800,
        cancellation_fee: 500, waiting_fee_per_minute: 50,
        is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })) as PricingRule[]);
    } finally { setLoading(false); }
  };

  const handleSave = async (ruleId: string) => {
    const updates = editing[ruleId];
    try { await supabase.from("pricing_rules").update(updates).eq("id", ruleId); } catch {}
  };

  const updateField = (ruleId: string, field: keyof PricingRule, value: string) => {
    setEditing(prev => ({ ...prev, [ruleId]: { ...prev[ruleId], [field]: parseFloat(value) || 0 } }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pricing Settings</h1>
        <p className="text-gray-500 mt-1">Set fare prices for ride categories</p>
      </div>

      <div className="flex gap-4">
        <select value={selectedCity} onChange={(e) => setSelectedCity(e.target.value)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm">
          <option value="Lilongwe">Lilongwe</option>
          <option value="Blantyre">Blantyre</option>
          <option value="Mzuzu">Mzuzu</option>
          <option value="Zomba">Zomba</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium text-right">Base Fare (MWK)</th>
                  <th className="px-4 py-3 font-medium text-right">Per KM (MWK)</th>
                  <th className="px-4 py-3 font-medium text-right">Per Minute (MWK)</th>
                  <th className="px-4 py-3 font-medium text-right">Minimum Fare (MWK)</th>
                  <th className="px-4 py-3 font-medium text-right">Cancellation Fee (MWK)</th>
                  <th className="px-4 py-3 font-medium text-right">Waiting/Min (MWK)</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pricingRules.map((rule) => (
                  <tr key={rule.id} className="border-b border-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{rule.category?.name}</p>
                    </td>
                    {(["base_fare", "price_per_km", "price_per_minute", "minimum_fare", "cancellation_fee", "waiting_fee_per_minute"] as (keyof PricingRule)[]).map(field => (
                      <td key={field} className="px-4 py-3">
                        <input
                          type="number"
                          value={String((editing[rule.id] as Record<string, unknown>)?.[field] ?? 0)}
                          onChange={(e) => updateField(rule.id, field, e.target.value)}
                          className="w-24 px-2 py-1.5 border border-gray-200 rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleSave(rule.id)} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700">
                        <Save className="h-3 w-3" /> Save
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold mb-3">Commission Settings</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Platform Commission (%)</label>
            <input type="number" value="20" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Driver Payout (%)</label>
            <input type="number" value="80" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" disabled />
          </div>
        </div>
      </div>
    </div>
  );
}