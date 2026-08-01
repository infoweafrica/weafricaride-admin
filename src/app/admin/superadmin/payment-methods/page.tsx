"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { CreditCard, Smartphone, Building2, RefreshCw } from "lucide-react";

type PaymentMethod = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  supported_cities: string[];
  transaction_fee_percent: number;
  processing_time: string;
};

export default function PaymentMethodsPage() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMethods = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("payment_methods")
        .select("id, name, slug, is_active, supported_cities, transaction_fee_percent, processing_time")
        .order("name");

      if (data) setMethods(data as PaymentMethod[]);
    } catch (err) {
      console.error(err);
      // Fallback: provide default payment methods info
      setMethods([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMethods(); }, [fetchMethods]);

  const getMethodIcon = (slug: string) => {
    switch (slug) {
      case "airtel_money":
      case "tnm_mpamba":
        return <Smartphone className="h-5 w-5 text-green-600" />;
      case "card":
        return <CreditCard className="h-5 w-5 text-blue-600" />;
      case "wallet":
        return <Building2 className="h-5 w-5 text-purple-600" />;
      default:
        return <CreditCard className="h-5 w-5 text-gray-500" />;
    }
  };

  const allCities = ["Lilongwe", "Blantyre", "Mzuzu", "Zomba"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payment Methods</h1>
          <p className="text-gray-500 mt-1">Manage Airtel Money, TNM Mpamba, Cash, Card, Wallet — enable/disable per city</p>
        </div>
        <button onClick={fetchMethods} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-32" />
            </div>
          ))}
        </div>
      ) : methods.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-4">
            Payment methods configuration requires a <code className="bg-gray-100 px-1 rounded">payment_methods</code> table. 
            Showing available payment methods for reference:
          </p>
          <div className="space-y-3">
            {[
              { name: "Airtel Money", slug: "airtel_money", active: true },
              { name: "TNM Mpamba", slug: "tnm_mpamba", active: true },
              { name: "Cash", slug: "cash", active: true },
              { name: "Card", slug: "card", active: true },
              { name: "Wallet", slug: "wallet", active: true },
            ].map((m) => (
              <div key={m.slug} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  {getMethodIcon(m.slug)}
                  <div>
                    <p className="font-medium text-gray-900">{m.name}</p>
                    <p className="text-xs text-gray-400">{m.slug}</p>
                  </div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Enabled</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {methods.map((method) => (
            <div key={method.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {getMethodIcon(method.slug)}
                  <div>
                    <h3 className="font-semibold text-gray-900">{method.name}</h3>
                    <p className="text-xs text-gray-400">{method.slug}</p>
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${method.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                  {method.is_active ? "Enabled" : "Disabled"}
                </span>
              </div>

              <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                <span>Fee: <strong>{method.transaction_fee_percent}%</strong></span>
                <span>Processing: <strong>{method.processing_time}</strong></span>
              </div>

              <div>
                <p className="text-xs text-gray-400 mb-2">Enabled Cities:</p>
                <div className="flex gap-2 flex-wrap">
                  {allCities.map((city) => (
                    <label key={city} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={method.supported_cities?.includes(city)}
                        readOnly
                        className="rounded border-gray-300 text-green-600"
                      />
                      {city}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}