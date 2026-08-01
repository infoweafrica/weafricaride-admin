"use client";

import { useState } from "react";
import { MapPin, Building2, Plane, TrendingUp, Ban, Search, RefreshCw } from "lucide-react";

type Zone = {
  id: string;
  name: string;
  city: string;
  type: "operating" | "airport" | "surge" | "restricted";
  drivers: number;
  rides_24h: number;
  active: boolean;
};

const MOCK_ZONES: Zone[] = [
  { id: "1", name: "Lilongwe City Center", city: "Lilongwe", type: "operating", drivers: 45, rides_24h: 128, active: true },
  { id: "2", name: "Area 47", city: "Lilongwe", type: "operating", drivers: 12, rides_24h: 34, active: true },
  { id: "3", name: "Kanengo Industrial", city: "Lilongwe", type: "operating", drivers: 8, rides_24h: 22, active: true },
  { id: "4", name: "Kamuzu International Airport", city: "Lilongwe", type: "airport", drivers: 15, rides_24h: 67, active: true },
  { id: "5", name: "Blantyre CBD", city: "Blantyre", type: "operating", drivers: 38, rides_24h: 95, active: true },
  { id: "6", name: "Chileka Airport", city: "Blantyre", type: "airport", drivers: 10, rides_24h: 42, active: true },
  { id: "7", name: "Mzuzu City", city: "Mzuzu", type: "operating", drivers: 22, rides_24h: 55, active: true },
  { id: "8", name: "Zomba Town", city: "Zomba", type: "operating", drivers: 15, rides_24h: 38, active: true },
  { id: "9", name: "Lilongwe Surge Zone (Peak)", city: "Lilongwe", type: "surge", drivers: 30, rides_24h: 200, active: true },
  { id: "10", name: "Restricted: Government Area", city: "Lilongwe", type: "restricted", drivers: 0, rides_24h: 0, active: false },
];

const ZONE_TYPES = [
  { type: "operating" as const, label: "Operating Areas", icon: Building2, color: "bg-green-50 text-green-700" },
  { type: "airport" as const, label: "Airport Zones", icon: Plane, color: "bg-blue-50 text-blue-700" },
  { type: "surge" as const, label: "Surge Zones", icon: TrendingUp, color: "bg-amber-50 text-amber-700" },
  { type: "restricted" as const, label: "Restricted Zones", icon: Ban, color: "bg-red-50 text-red-700" },
];

export default function ServiceZonesPage() {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");

  const filtered = MOCK_ZONES.filter((z) => {
    if (filterType !== "all" && z.type !== filterType) return false;
    if (search && !z.name.toLowerCase().includes(search.toLowerCase()) && !z.city.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalByType = (type: string) => MOCK_ZONES.filter((z) => z.type === type).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Service Zones</h1>
          <p className="text-gray-500 mt-1">Manage cities, operating areas, airport zones, surge zones, and restricted zones</p>
        </div>
      </div>

      {/* Zone Type Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {ZONE_TYPES.map((zt) => (
          <div key={zt.type} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <zt.icon className="h-5 w-5 text-gray-600" />
              <p className="text-xs text-gray-500 font-medium">{zt.label}</p>
            </div>
            <p className="text-2xl font-bold">{totalByType(zt.type)}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input type="text" placeholder="Search zones..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
        </div>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="all">All Types</option>
          <option value="operating">Operating Areas</option>
          <option value="airport">Airport Zones</option>
          <option value="surge">Surge Zones</option>
          <option value="restricted">Restricted Zones</option>
        </select>
      </div>

      {/* Zones List */}
      <div className="space-y-3">
        {filtered.map((zone) => {
          const typeInfo = ZONE_TYPES.find((z) => z.type === zone.type)!;
          return (
            <div key={zone.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`p-2 rounded-lg ${zone.active ? "bg-green-50" : "bg-gray-50"}`}>
                  <typeInfo.icon className={`h-5 w-5 ${zone.active ? "text-green-600" : "text-gray-400"}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-900">{zone.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeInfo.color}`}>
                      {typeInfo.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                    <span><MapPin className="h-3 w-3 inline" /> {zone.city}</span>
                    <span>{zone.drivers} drivers</span>
                    <span>{zone.rides_24h} rides/24h</span>
                  </div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" defaultChecked={zone.active} className="sr-only peer" />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600"></div>
              </label>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-12">No zones match your search</div>
        )}
      </div>
    </div>
  );
}