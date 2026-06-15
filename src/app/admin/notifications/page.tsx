"use client";
import { useState } from "react";
import { Search, Plus } from "lucide-react";

export default function Page() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900 capitalize">notifications</h1><p className="text-gray-500 mt-1">Manage notifications</p></div>
        <button className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"><Plus className="h-4 w-4" /> Add New</button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" /><input type="text" placeholder="Search..." className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm" /></div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <p className="text-gray-500 font-medium capitalize">notifications Module</p>
        <p className="text-sm text-gray-400 mt-1">This section is ready for data integration. Connect to Supabase to enable full functionality.</p>
      </div>
    </div>
  );
}
