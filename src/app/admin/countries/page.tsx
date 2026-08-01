"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Globe, Plus, Edit, Ban, CheckCircle, Search } from "lucide-react";

export default function CountriesPage() {
  const [countries, setCountries] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCountries() {
      try {
        const { data } = await supabase
          .from("countries")
          .select("*")
          .order("name");
        setCountries((data as Record<string, unknown>[]) || []);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadCountries();
  }, []);

  const activeCount = countries.filter((c) => c.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Countries</h1>
          <p className="text-gray-500 mt-1">Manage supported countries and their currencies</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
          <Plus className="h-4 w-4" /> Add Country
        </button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input type="text" placeholder="Search countries..." className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm" />
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
                <th className="px-6 py-3 font-medium">Country</th>
                <th className="px-6 py-3 font-medium">Code</th>
                <th className="px-6 py-3 font-medium">Currency</th>
                <th className="px-6 py-3 font-medium">Phone Code</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {countries.map((c) => (
                <tr key={c.id as string} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-50 rounded-lg"><Globe className="h-5 w-5 text-blue-600" /></div>
                      <span className="font-medium">{c.name as string}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs">{c.code as string}</td>
                  <td className="px-6 py-4 text-xs">{c.currency_code as string} — {c.currency_name as string}</td>
                  <td className="px-6 py-4 text-xs">{c.phone_code as string}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${c.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                      {c.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button className="p-1.5 hover:bg-gray-100 rounded text-gray-500"><Edit className="h-4 w-4" /></button>
                      {c.is_active ? (
                        <button className="p-1.5 hover:bg-red-50 rounded text-red-600"><Ban className="h-4 w-4" /></button>
                      ) : (
                        <button className="p-1.5 hover:bg-green-50 rounded text-green-600"><CheckCircle className="h-4 w-4" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {countries.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-400">No countries found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}