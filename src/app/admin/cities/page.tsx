"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { MapPin, Plus, Edit, Ban, CheckCircle, Search, Building2 } from "lucide-react";

export default function CitiesPage() {
  const [cities, setCities] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCities() {
      try {
        const { data } = await supabase
          .from("cities")
          .select("*, country:countries(name)")
          .order("name");
        setCities((data as Record<string, unknown>[]) || []);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadCities();
  }, []);

  const activeCount = cities.filter((c) => c.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cities</h1>
          <p className="text-gray-500 mt-1">Manage cities and regions where WeAfrica operates</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
          <Plus className="h-4 w-4" /> Add City
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Total Cities</p>
          <p className="text-xl font-bold mt-1">{cities.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Active Cities</p>
          <p className="text-xl font-bold mt-1 text-green-600">{activeCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Inactive Cities</p>
          <p className="text-xl font-bold mt-1">{cities.length - activeCount}</p>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input type="text" placeholder="Search cities..." className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 font-medium">City</th>
                <th className="px-6 py-3 font-medium">Country</th>
                <th className="px-6 py-3 font-medium">Region</th>
                <th className="px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {cities.map((c) => (
                <tr key={c.id as string} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-teal-50 rounded-lg"><Building2 className="h-5 w-5 text-teal-600" /></div>
                      <span className="font-medium">{c.name as string}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-xs">{(c.country as Record<string, unknown>)?.name as string || "—"}</td>
                  <td className="px-6 py-4 text-xs text-gray-500">{c.region as string || "—"}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${c.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                      {c.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
              {cities.length === 0 && (
                <tr><td colSpan={4} className="px-6 py-12 text-center text-gray-400">No cities found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}