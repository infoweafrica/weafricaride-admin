"use client";
import { useState } from "react";
import { Tag, Plus, Edit, Trash2, Search, Gift, Copy, Percent, Clock } from "lucide-react";

export default function PromoCodesPage() {
  const [promos] = useState([
    { id: "1", code: "WELCOME50", type: "percentage", value: 50, maxDiscount: 2000, minRide: 500, usageLimit: 100, used: 45, isActive: true, expires: "2026-12-31", isFirstRide: true },
    { id: "2", code: "SAVE2000", type: "fixed", value: 2000, maxDiscount: 2000, minRide: 5000, usageLimit: 200, used: 89, isActive: true, expires: "2026-08-15", isFirstRide: false },
    { id: "3", code: "WEEKEND10", type: "percentage", value: 10, maxDiscount: 500, minRide: 1000, usageLimit: 500, used: 120, isActive: true, expires: "2026-06-30", isFirstRide: false },
    { id: "4", code: "REFER1000", type: "fixed", value: 1000, maxDiscount: 1000, minRide: 0, usageLimit: 1000, used: 234, isActive: false, expires: "2026-05-01", isFirstRide: false },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Promo Codes</h1><p className="text-gray-500 mt-1">Create and manage promotional discount codes</p></div>
        <button className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"><Plus className="h-4 w-4" /> Create Promo</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-400">Active Promos</p><p className="text-xl font-bold mt-1 text-green-600">{promos.filter(p=>p.isActive).length}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-400">Total Redeemed</p><p className="text-xl font-bold mt-1">{promos.reduce((s,p)=>s+p.used,0)}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-400">Total Discount Given</p><p className="text-xl font-bold mt-1 text-purple-600">MWK 488,000</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-400">Expiring Soon</p><p className="text-xl font-bold mt-1 text-amber-600">1</p></div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" /><input type="text" placeholder="Search promo codes..." className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm" /></div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200"><th className="px-4 py-3 font-medium">Code</th><th className="px-4 py-3 font-medium">Type</th><th className="px-4 py-3 font-medium">Value</th><th className="px-4 py-3 font-medium">Limit</th><th className="px-4 py-3 font-medium">Usage</th><th className="px-4 py-3 font-medium">Expires</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium text-right">Actions</th></tr></thead>
          <tbody>
            {promos.map(p => (
              <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="px-2 py-1 bg-purple-50 text-purple-700 rounded text-xs font-bold font-mono">{p.code}</span>{p.isFirstRide && <span className="text-xs text-gray-400">1st Ride</span>}</div></td>
                <td className="px-4 py-3 text-xs capitalize">{p.type}</td>
                <td className="px-4 py-3 font-medium text-xs">{p.type === "percentage" ? `${p.value}%` : `MWK ${p.value}`}</td>
                <td className="px-4 py-3 text-xs">{p.usageLimit}</td>
                <td className="px-4 py-3 text-xs">
                  <div className="flex items-center gap-2"><span>{p.used}</span><div className="w-16 h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-purple-500 rounded-full" style={{width:`${(p.used/p.usageLimit)*100}%`}} /></div></div>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{p.expires}</td>
                <td className="px-4 py-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${p.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>{p.isActive ? "Active" : "Inactive"}</span></td>
                <td className="px-4 py-3 text-right"><div className="flex items-center justify-end gap-1"><button className="p-1.5 hover:bg-gray-100 rounded text-gray-500"><Edit className="h-4 w-4" /></button><button className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><Copy className="h-4 w-4" /></button><button className="p-1.5 hover:bg-red-50 rounded text-red-600"><Trash2 className="h-4 w-4" /></button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
