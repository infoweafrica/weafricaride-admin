"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Car, DollarSign, Percent, RefreshCw, Search } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type VehicleCategory = {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  base_fare: number;
  minimum_fare: number;
  per_km_rate: number;
  per_minute_rate: number;
  commission_percent: number;
  is_active: boolean;
  max_seats: number;
};

export default function VehicleCategoriesPage() {
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      // Pricing lives in pricing_config, not on ride_categories — and
      // pricing_config's only RLS policy checks auth.uid(), which is never
      // set for admin-dashboard's anon-key browser client, so a direct
      // table query would silently return nothing. admin_list_pricing_config
      // is SECURITY DEFINER and already granted to anon, so it's the
      // correct way to read it from here.
      const [{ data: cats }, { data: pricingResult }] = await Promise.all([
        supabase
          .from("ride_categories")
          .select("id, name, slug, description, icon, is_active, sort_order")
          .order("sort_order"),
        supabase.rpc("admin_list_pricing_config", { p_country_code: "MW" }),
      ]);

      const pricingRows: Record<string, any>[] = pricingResult?.data ?? [];
      const merged = (cats ?? []).map((c) => {
        const p = pricingRows.find((pc) => pc.vehicle_type === c.slug);
        return {
          ...c,
          base_fare: p?.base_fare ?? 0,
          minimum_fare: p?.minimum_fare ?? 0,
          per_km_rate: p?.per_km ?? 0,
          per_minute_rate: p?.per_min ?? 0,
          commission_percent: p?.commission_percent ?? 0,
          max_seats: c.slug === "xl" ? 7 : 4,
        };
      });

      setCategories(merged as VehicleCategory[]);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  const toggleActive = async (cat: VehicleCategory) => {
    setCategories((prev) => prev.map((c) => (c.id === cat.id ? { ...c, is_active: !c.is_active } : c)));
    const { error } = await supabase.from("ride_categories").update({ is_active: !cat.is_active }).eq("id", cat.id);
    if (error) {
      console.error(error);
      setCategories((prev) => prev.map((c) => (c.id === cat.id ? { ...c, is_active: cat.is_active } : c)));
    }
  };

  const filtered = categories.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vehicle Categories</h1>
          <p className="text-gray-500 mt-1">Manage ride categories with base fare, per km, per minute rates, and commission</p>
        </div>
        <button onClick={fetchCategories} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input type="text" placeholder="Search categories..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
              <div className="h-8 bg-gray-200 rounded w-16" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((cat) => (
            <div key={cat.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-50 rounded-lg">
                    <Car className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{cat.name}</h3>
                    {cat.slug && <p className="text-xs text-gray-400">{cat.slug}</p>}
                  </div>
                </div>
                <button
                  onClick={() => toggleActive(cat)}
                  className={`text-xs px-2 py-0.5 rounded-full font-medium hover:opacity-80 ${cat.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}
                >
                  {cat.is_active ? "Active" : "Inactive"}
                </button>
              </div>

              {cat.description && (
                <p className="text-xs text-gray-500 mb-4">{cat.description}</p>
              )}

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400">Base Fare</p>
                  <p className="font-medium">{formatCurrency(cat.base_fare)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Min Fare</p>
                  <p className="font-medium">{formatCurrency(cat.minimum_fare)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Per Km</p>
                  <p className="font-medium">{formatCurrency(cat.per_km_rate)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Per Min</p>
                  <p className="font-medium">{formatCurrency(cat.per_minute_rate)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Commission</p>
                  <p className="font-medium text-green-600">{cat.commission_percent}%</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Seats</p>
                  <p className="font-medium">{cat.max_seats}</p>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full text-center text-gray-400 text-sm py-12">
              No vehicle categories found
            </div>
          )}
        </div>
      )}
    </div>
  );
}