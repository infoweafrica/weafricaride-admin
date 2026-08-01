"use client";

import { useState, useEffect } from "react";
import { MapPin, Navigation } from "lucide-react";

export default function LiveMapPage() {
  const [activeDrivers, setActiveDrivers] = useState([
    { id: "d1", name: "James Chirwa", lat: -13.9833, lng: 33.7833, status: "available", vehicle: "LL 1234" },
    { id: "d3", name: "Peter Mwale", lat: -14.0167, lng: 33.7500, status: "on_ride", vehicle: "MZ 9012" },
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Live Map</h1>
        <p className="text-gray-500 mt-1">Track active drivers and rides in real-time</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map Area */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="bg-gray-100 h-[500px] flex items-center justify-center relative">
            <div className="absolute inset-0 bg-gray-200 flex items-center justify-center">
              <div className="text-center">
                <MapPin className="h-16 w-16 text-green-600 mx-auto mb-4 opacity-50" />
                <p className="text-gray-500 text-lg font-medium">Map Integration</p>
                <p className="text-gray-400 text-sm">Connect Leaflet/Google Maps with Supabase Realtime</p>
                <p className="text-gray-400 text-sm mt-1">for live driver tracking</p>
              </div>
            </div>
            {/* Mock markers */}
            {activeDrivers.map((d) => (
              <div
                key={d.id}
                className="absolute flex items-center gap-2 bg-white rounded-full shadow-lg px-3 py-1.5 border border-gray-200"
                style={{
                  top: "35%",
                  left: d.id === "d1" ? "45%" : "55%",
                }}
              >
                <div className={`h-3 w-3 rounded-full ${d.status === "available" ? "bg-green-500" : "bg-blue-500"}`}></div>
                <span className="text-xs font-medium">{d.name}</span>
                <span className="text-xs text-gray-400">{d.vehicle}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Active Drivers List */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Navigation className="h-4 w-4 text-green-600" />
            Active Drivers ({activeDrivers.length})
          </h3>
          <div className="space-y-3">
            {activeDrivers.map((driver) => (
              <div key={driver.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="h-8 w-8 bg-purple-600 rounded-full flex items-center justify-center text-white text-xs font-medium">
                      {driver.name.charAt(0)}
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${driver.status === "available" ? "bg-green-500" : "bg-blue-500"}`}></span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{driver.name}</p>
                    <p className="text-xs text-gray-400">{driver.vehicle}</p>
                  </div>
                </div>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${driver.status === "available" ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"}`}>
                  {driver.status === "available" ? "Available" : "On Ride"}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 bg-gray-50 rounded-lg">
            <h4 className="text-xs font-semibold mb-2">Service Zones</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Lilongwe</span>
                <span className="text-green-600 font-medium">Active</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Blantyre</span>
                <span className="text-green-600 font-medium">Active</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Mzuzu</span>
                <span className="text-yellow-600 font-medium">Limited</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Drivers Online</p>
          <p className="text-xl font-bold text-green-600">{activeDrivers.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Available</p>
          <p className="text-xl font-bold">{activeDrivers.filter(d => d.status === "available").length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">On Ride</p>
          <p className="text-xl font-bold text-blue-600">{activeDrivers.filter(d => d.status === "on_ride").length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Service Zones</p>
          <p className="text-xl font-bold">3</p>
        </div>
      </div>
    </div>
  );
}