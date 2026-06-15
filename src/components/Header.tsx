"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useCityContext } from "@/lib/city-context";
import { Bell, Search, LogOut, User, ChevronDown, MapPin } from "lucide-react";
import Link from "next/link";

export default function Header() {
  const { adminProfile, signOut } = useAuth();
  const { cities, selectedCityId, selectedCityName, setSelectedCity, loading: citiesLoading } = useCityContext();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showCityDropdown, setShowCityDropdown] = useState(false);

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      {/* Search */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search users, drivers, rides..."
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* City Selector */}
      <div className="relative">
        <button
          onClick={() => setShowCityDropdown(!showCityDropdown)}
          className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 whitespace-nowrap"
        >
          <MapPin className="h-4 w-4 text-green-600" />
          <span className={selectedCityId ? "text-gray-900 font-medium" : "text-gray-500"}>
            {selectedCityName}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
        </button>

        {showCityDropdown && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowCityDropdown(false)} />
            <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
              <div className="p-2">
                <button
                  onClick={() => { setSelectedCity(null); setShowCityDropdown(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm ${!selectedCityId ? "bg-green-50 text-green-700 font-medium" : "text-gray-700 hover:bg-gray-50"}`}
                >
                  🌍 All Cities
                </button>
                {citiesLoading ? (
                  <div className="px-3 py-4 text-center text-sm text-gray-400">Loading...</div>
                ) : cities.length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-gray-400">
                    No cities configured
                    <br />
                    <Link href="/admin/cities" className="text-green-600 hover:underline text-xs" onClick={() => setShowCityDropdown(false)}>
                      Set up cities →
                    </Link>
                  </div>
                ) : (
                  cities.map((city) => (
                    <button
                      key={city.id}
                      onClick={() => { setSelectedCity(city.id); setShowCityDropdown(false); }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between ${selectedCityId === city.id ? "bg-green-50 text-green-700 font-medium" : "text-gray-700 hover:bg-gray-50"}`}
                    >
                      <span>{city.name}</span>
                      <span className="text-xs text-gray-400">{city.region}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4">
        {/* Notifications */}
        <button className="relative p-2 text-gray-600 hover:bg-gray-100 rounded-lg">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full"></span>
        </button>

        {/* User dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-gray-100"
          >
            <div className="h-8 w-8 bg-green-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
              {(adminProfile?.display_name || adminProfile?.email || "A").charAt(0).toUpperCase()}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-medium text-gray-700">
                {adminProfile?.display_name || "Admin"}
              </p>
              <p className="text-xs text-gray-500">
                {adminProfile?.role || "Admin"}
              </p>
            </div>
            <ChevronDown className="h-4 w-4 text-gray-400" />
          </button>

          {showDropdown && (
            <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
              <div className="p-3 border-b border-gray-100">
                <p className="text-sm font-medium">{adminProfile?.display_name || "Admin"}</p>
                <p className="text-xs text-gray-500">{adminProfile?.email}</p>
              </div>
              <div className="py-2">
                <Link
                  href="/admin/settings"
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <User className="h-4 w-4" />
                  Profile
                </Link>
                <button
                  onClick={signOut}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 w-full text-left"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}