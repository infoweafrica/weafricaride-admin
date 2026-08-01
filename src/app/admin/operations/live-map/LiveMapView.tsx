"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import mapboxgl from "@/lib/mapboxClient";
import "mapbox-gl/dist/mapbox-gl.css";

export interface DriverLocation {
  id: string;
  driver_id: string;
  driver_name: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  is_online: boolean;
  updated_at: string;
  vehicle_type?: string;
  phone?: string;
  rating?: number;
  plate_number?: string;
  photo_url?: string;
  city?: string;
}

export interface RideOnMap {
  id: string;
  status: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  pickup_addr: string;
  dropoff_addr: string;
  driver_id?: string;
  driver_name?: string;
  rider_name?: string;
  fare?: number;
}

interface LiveMapViewProps {
  drivers: DriverLocation[];
  rides?: RideOnMap[];
  selectedDriverId?: string | null;
  vehicleFilter?: string;
  onForceOffline?: (driverId: string) => void;
  onSuspendDriver?: (driverId: string) => void;
}

// ── Status Colors ──
const STATUS_COLORS: Record<string, { bg: string; border: string; glow: string; label: string }> = {
  available: { bg: "#22c55e", border: "#16a34a", glow: "rgba(34,197,94,0.4)", label: "Available" },
  on_trip: { bg: "#2563eb", border: "#1d4ed8", glow: "rgba(37,99,235,0.5)", label: "On Trip" },
  busy: { bg: "#f97316", border: "#ea580c", glow: "rgba(249,115,22,0.4)", label: "Busy" },
  offline: { bg: "#9ca3af", border: "#6b7280", glow: "rgba(156,163,175,0.3)", label: "Offline" },
};

function getStatusKey(d: DriverLocation): string {
  const onTrip = (d as unknown as Record<string, unknown>).on_trip as boolean || false;
  if (onTrip) return "on_trip";
  if (d.is_online) return "available";
  return "offline";
}

// ── Vehicle SVG Icons (top-down view) ──
const VEHICLE_SVGS: Record<string, (color: string) => string> = {
  sedan: (c) => `<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="20" cy="20" rx="14" ry="9" fill="${c}" stroke="white" stroke-width="2"/>
    <rect x="12" y="14" width="16" height="12" rx="6" fill="${c}" opacity="0.8"/>
    <rect x="14" y="12" width="12" height="4" rx="2" fill="white" opacity="0.3"/>
    <circle cx="12" cy="15" r="2.5" fill="#111" stroke="white" stroke-width="1"/>
    <circle cx="28" cy="15" r="2.5" fill="#111" stroke="white" stroke-width="1"/>
    <circle cx="12" cy="25" r="2.5" fill="#111" stroke="white" stroke-width="1"/>
    <circle cx="28" cy="25" r="2.5" fill="#111" stroke="white" stroke-width="1"/>
    <rect x="17" y="16" width="6" height="3" rx="1" fill="white" opacity="0.5"/>
  </svg>`,
  suv: (c) => `<svg width="44" height="44" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="22" cy="22" rx="16" ry="10" fill="${c}" stroke="white" stroke-width="2"/>
    <rect x="10" y="14" width="24" height="16" rx="6" fill="${c}" opacity="0.85"/>
    <rect x="12" y="12" width="20" height="5" rx="2.5" fill="white" opacity="0.3"/>
    <circle cx="10" cy="17" r="3" fill="#111" stroke="white" stroke-width="1.2"/>
    <circle cx="34" cy="17" r="3" fill="#111" stroke="white" stroke-width="1.2"/>
    <circle cx="10" cy="27" r="3" fill="#111" stroke="white" stroke-width="1.2"/>
    <circle cx="34" cy="27" r="3" fill="#111" stroke="white" stroke-width="1.2"/>
    <rect x="18" y="17" width="8" height="4" rx="1.5" fill="white" opacity="0.5"/>
  </svg>`,
  premium: (c) => `<svg width="42" height="42" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="21" cy="21" rx="15" ry="9" fill="${c}" stroke="#d4af37" stroke-width="2.5"/>
    <rect x="11" y="13" width="20" height="16" rx="7" fill="${c}" opacity="0.9"/>
    <rect x="13" y="11" width="16" height="4" rx="2" fill="white" opacity="0.4"/>
    <circle cx="11" cy="16" r="2.5" fill="#111" stroke="#d4af37" stroke-width="1"/>
    <circle cx="31" cy="16" r="2.5" fill="#111" stroke="#d4af37" stroke-width="1"/>
    <circle cx="11" cy="26" r="2.5" fill="#111" stroke="#d4af37" stroke-width="1"/>
    <circle cx="31" cy="26" r="2.5" fill="#111" stroke="#d4af37" stroke-width="1"/>
    <rect x="16" y="15" width="10" height="4" rx="2" fill="white" opacity="0.6"/>
    <text x="21" y="20" text-anchor="middle" font-size="6" fill="#d4af37" font-weight="bold">★</text>
  </svg>`,
  moto: (c) => `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="16" cy="16" rx="10" ry="7" fill="${c}" stroke="white" stroke-width="1.5"/>
    <rect x="13" y="12" width="6" height="8" rx="3" fill="${c}" opacity="0.8"/>
    <circle cx="9" cy="14" r="3" fill="#111" stroke="white" stroke-width="1"/>
    <circle cx="23" cy="14" r="3" fill="#111" stroke="white" stroke-width="1"/>
    <circle cx="9" cy="20" r="2" fill="#111" stroke="white" stroke-width="0.8"/>
    <circle cx="23" cy="20" r="2" fill="#111" stroke="white" stroke-width="0.8"/>
    <circle cx="16" cy="10" r="1.5" fill="white" opacity="0.6"/>
  </svg>`,
  delivery: (c) => `<svg width="44" height="44" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="22" cy="22" rx="17" ry="10" fill="${c}" stroke="white" stroke-width="2"/>
    <rect x="8" y="13" width="28" height="18" rx="4" fill="${c}" opacity="0.85"/>
    <rect x="10" y="11" width="12" height="5" rx="2" fill="white" opacity="0.3"/>
    <rect x="24" y="13" width="10" height="8" rx="2" fill="${c}" opacity="0.6"/>
    <circle cx="10" cy="17" r="3" fill="#111" stroke="white" stroke-width="1.2"/>
    <circle cx="34" cy="17" r="3" fill="#111" stroke="white" stroke-width="1.2"/>
    <circle cx="10" cy="29" r="3" fill="#111" stroke="white" stroke-width="1.2"/>
    <circle cx="34" cy="29" r="3" fill="#111" stroke="white" stroke-width="1.2"/>
    <rect x="26" y="15" width="6" height="4" rx="1" fill="white" opacity="0.4"/>
  </svg>`,
};

function getVehicleSVG(type?: string): (color: string) => string {
  const t = (type || "").toLowerCase();
  if (t.includes("suv") || t.includes("rav4")) return VEHICLE_SVGS.suv;
  if (t.includes("premium") || t.includes("black") || t.includes("bmw") || t.includes("mercedes")) return VEHICLE_SVGS.premium;
  if (t.includes("moto") || t.includes("motorcycle") || t.includes("bike")) return VEHICLE_SVGS.moto;
  if (t.includes("delivery") || t.includes("van") || t.includes("truck")) return VEHICLE_SVGS.delivery;
  return VEHICLE_SVGS.sedan;
}

// ── Build driver marker inner HTML (rotating vehicle + status dot) ──
function buildDriverMarkerHtml(heading: number, status: string, vehicleType?: string): string {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.available;
  const svgFn = getVehicleSVG(vehicleType);
  const svgHtml = svgFn(colors.bg);

  return `<div style="
      width:48px; height:48px;
      display:flex; align-items:center; justify-content:center;
      transform:rotate(${heading}deg);
      transition:transform 0.8s ease-in-out;
      filter: drop-shadow(0 4px 8px ${colors.glow});
      position:relative;
    ">
      ${svgHtml}
      <div style="
        position:absolute; bottom:-2px; right:-2px;
        width:14px; height:14px;
        background:${colors.bg};
        border:2px solid white;
        border-radius:50%;
        box-shadow:0 0 8px ${colors.glow};
        ${status === "on_trip" ? "animation:pulse-blue 2s infinite;" : ""}
      "></div>
    </div>
    <style>
      @keyframes pulse-blue { 0%,100%{ box-shadow:0 0 4px ${colors.glow}; } 50%{ box-shadow:0 0 16px ${colors.glow}; } }
    </style>`;
}

function createPickupEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "width:28px;height:28px;background:#22c55e;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px";
  el.innerText = "📍";
  return el;
}

function createDropoffEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "width:28px;height:28px;background:#ef4444;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px";
  el.innerText = "🏁";
  return el;
}

// Mapbox uses [lng, lat] — opposite of Leaflet's [lat, lng]
const DEFAULT_CENTER: [number, number] = [33.7741, -13.9626]; // Lilongwe, Malawi
const DEFAULT_ZOOM = 7;
const ANIM_DURATION = 800;
const RIDE_LINES_SOURCE = "live-map-ride-lines";
const RIDE_LINES_LAYER = "live-map-ride-lines-layer";

function fitDriversOnMap(map: mapboxgl.Map | null, drivers: DriverLocation[]) {
  if (!map || drivers.length === 0) return;
  const bounds = drivers.reduce(
    (b, d) => b.extend([d.longitude, d.latitude]),
    new mapboxgl.LngLatBounds()
  );
  map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
}

export default function LiveMapView({
  drivers,
  rides = [],
  selectedDriverId,
  vehicleFilter = "all",
  onForceOffline,
  onSuspendDriver,
}: LiveMapViewProps) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapLoadedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const rideMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const prevDriversRef = useRef<Map<string, DriverLocation>>(new Map());
  const animFramesRef = useRef<Map<string, number>>(new Map());
  const hasAutoFitRef = useRef(false);
  const pendingRidesRef = useRef<RideOnMap[]>(rides);
  const [webglUnsupported, setWebglUnsupported] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!mapboxgl.supported()) {
      setWebglUnsupported(true);
      return;
    }

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
      });
    } catch (err) {
      console.error("Mapbox failed to initialize:", err);
      setWebglUnsupported(true);
      return;
    }
    map.on("error", (e) => console.error("Mapbox error:", e.error));
    map.addControl(new mapboxgl.NavigationControl(), "top-left");

    map.on("load", () => {
      map.addSource(RIDE_LINES_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: RIDE_LINES_LAYER,
        type: "line",
        source: RIDE_LINES_SOURCE,
        paint: {
          "line-color": ["get", "color"],
          "line-width": 3,
          "line-dasharray": [2, 1.5],
          "line-opacity": 0.7,
        },
      });
      mapLoadedRef.current = true;
      renderRideLines(pendingRidesRef.current);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      mapLoadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render ride markers + connecting lines
  const renderRideLines = useCallback((currentRides: RideOnMap[]) => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const source = map.getSource(RIDE_LINES_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: currentRides
        .filter((r) => r.pickup_lat && r.pickup_lng && r.dropoff_lat && r.dropoff_lng)
        .map((r) => ({
          type: "Feature",
          properties: { color: r.status === "in_progress" ? "#2563EB" : "#F59E0B" },
          geometry: {
            type: "LineString",
            coordinates: [
              [r.pickup_lng, r.pickup_lat],
              [r.dropoff_lng, r.dropoff_lat],
            ],
          },
        })),
    });
  }, []);

  useEffect(() => {
    pendingRidesRef.current = rides;
    rideMarkersRef.current.forEach((m) => m.remove());
    rideMarkersRef.current = [];

    const map = mapRef.current;
    if (map) {
      rides.forEach((ride) => {
        if (!ride.pickup_lat || !ride.pickup_lng) return;
        const pickupMarker = new mapboxgl.Marker({ element: createPickupEl() })
          .setLngLat([ride.pickup_lng, ride.pickup_lat])
          .setPopup(
            new mapboxgl.Popup().setHTML(
              `<div style="min-width:150px"><strong>Pickup</strong><br/>${ride.pickup_addr}<br/><span style="font-size:11px">Rider: ${ride.rider_name || "—"}</span></div>`
            )
          )
          .addTo(map);
        rideMarkersRef.current.push(pickupMarker);

        if (ride.dropoff_lat && ride.dropoff_lng) {
          const dropoffMarker = new mapboxgl.Marker({ element: createDropoffEl() })
            .setLngLat([ride.dropoff_lng, ride.dropoff_lat])
            .setPopup(
              new mapboxgl.Popup().setHTML(
                `<div style="min-width:150px"><strong>Drop-off</strong><br/>${ride.dropoff_addr}<br/><span style="font-size:11px">${ride.status}</span></div>`
              )
            )
            .addTo(map);
          rideMarkersRef.current.push(dropoffMarker);
        }
      });
    }

    renderRideLines(rides);
  }, [rides, renderRideLines]);

  // Build enhanced popup HTML
  const buildPopup = useCallback((d: DriverLocation): string => {
    const id = d.driver_id || d.id;
    const status = getStatusKey(d);
    const colors = STATUS_COLORS[status];
    const vehicle = d.vehicle_type || "Standard";
    const phone = d.phone || "";
    const rating = d.rating || 0;
    const plate = d.plate_number || "";
    const city = d.city || "";
    const photo = d.photo_url || "";
    const lastSeen = new Date(d.updated_at).toLocaleTimeString();
    const speed = d.speed != null ? d.speed.toFixed(1) + " km/h" : "Stationary";
    const stars = rating > 0 ? "⭐".repeat(Math.min(5, Math.round(rating))) : "";

    return `<div style="min-width:260px;font-size:13px;font-family:system-ui,sans-serif;max-width:300px">
      ${photo ? `<div style="width:100%;height:100px;background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:center;overflow:hidden"><img src="${photo}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'"/></div>` : ""}
      <div style="padding:${photo ? "8" : "4"}px 0 0 0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #e5e7eb">
          <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${colors.bg};box-shadow:0 0 8px ${colors.glow};flex-shrink:0"></span>
          <div style="flex:1;min-width:0">
            <strong style="font-size:14px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.driver_name}</strong>
            <div style="font-size:11px;color:#6b7280;display:flex;align-items:center;gap:4px">
              <span style="background:${colors.bg}22;color:${colors.bg};padding:1px 6px;border-radius:4px;font-weight:600">${colors.label}</span>
              ${city ? `<span>· ${city}</span>` : ""}
            </div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 8px;margin-bottom:8px;font-size:12px">
          <span style="color:#6b7280">🚗</span><span style="font-weight:600">${vehicle}</span>
          ${plate ? `<><span style="color:#6b7280">🪪</span><span style="font-weight:600;font-family:monospace">${plate}</span></>` : ""}
          ${stars ? `<><span style="color:#6b7280">${stars}</span><span style="font-weight:600">${rating.toFixed(1)}</span></>` : ""}
          <span style="color:#6b7280">🏎️</span><span style="font-weight:600">${speed}</span>
          ${phone ? `<><span style="color:#6b7280">📱</span><span style="font-weight:600">${phone}</span></>` : ""}
          <span style="color:#6b7280">🕐</span><span style="font-weight:600;font-size:11px;color:#9ca3af">${lastSeen}</span>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;padding-top:6px;border-top:1px solid #f3f4f6">
          ${phone ? `<a href="tel:${phone}" style="padding:5px 12px;font-size:11px;border-radius:6px;border:1px solid #22c55e;color:#22c55e;background:white;cursor:pointer;font-weight:600;text-decoration:none">📞 Call</a>` : ""}
          <a href="/admin/drivers/${id}" style="padding:5px 12px;font-size:11px;border-radius:6px;border:1px solid #3b82f6;color:#3b82f6;background:white;cursor:pointer;font-weight:600;text-decoration:none">👤 Profile</a>
          <button onclick="window.__weafricaForceOffline('${id}')" style="padding:5px 12px;font-size:11px;border-radius:6px;border:1px solid #ef4444;color:#ef4444;background:white;cursor:pointer;font-weight:600">Go Offline</button>
          <button onclick="window.__weafricaSuspend('${id}')" style="padding:5px 12px;font-size:11px;border-radius:6px;border:1px solid #f59e0b;color:#f59e0b;background:white;cursor:pointer;font-weight:600">Suspend</button>
        </div>
      </div>
    </div>`;
  }, []);

  // Smooth marker animation
  const animateMarker = useCallback(
    (marker: mapboxgl.Marker, driverId: string, fromLat: number, fromLng: number, toLat: number, toLng: number, fromHeading: number, toHeading: number, driver: DriverLocation) => {
      const existing = animFramesRef.current.get(driverId);
      if (existing) cancelAnimationFrame(existing);
      const startTime = performance.now();
      const step = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / ANIM_DURATION, 1);
        const eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        const lat = fromLat + (toLat - fromLat) * eased;
        const lng = fromLng + (toLng - fromLng) * eased;
        let hDiff = toHeading - fromHeading;
        while (hDiff > 180) hDiff -= 360;
        while (hDiff < -180) hDiff += 360;
        const h = fromHeading + hDiff * eased;
        marker.setLngLat([lng, lat]);
        const status = getStatusKey(driver);
        marker.getElement().innerHTML = buildDriverMarkerHtml(h, status, driver.vehicle_type);
        marker.getPopup()?.setHTML(buildPopup(driver));
        if (progress < 1) {
          animFramesRef.current.set(driverId, requestAnimationFrame(step));
        } else {
          animFramesRef.current.delete(driverId);
        }
      };
      animFramesRef.current.set(driverId, requestAnimationFrame(step));
    },
    [buildPopup]
  );

  // Expose callbacks globally for popup buttons
  useEffect(() => {
    if (onForceOffline) {
      (window as unknown as Record<string, unknown>).__weafricaForceOffline = (id: string) => onForceOffline(id);
    }
    if (onSuspendDriver) {
      (window as unknown as Record<string, unknown>).__weafricaSuspend = (id: string) => onSuspendDriver(id);
    }
    return () => {
      delete (window as unknown as Record<string, unknown>).__weafricaForceOffline;
      delete (window as unknown as Record<string, unknown>).__weafricaSuspend;
    };
  }, [onForceOffline, onSuspendDriver]);

  // Filter and update driver markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Apply vehicle filter
    const filtered = vehicleFilter === "all"
      ? drivers
      : drivers.filter((d) => (d.vehicle_type || "sedan").toLowerCase().includes(vehicleFilter.toLowerCase()));

    const prevDrivers = prevDriversRef.current;
    const currentIds = new Set(filtered.map((d) => d.id));
    const prevIds = new Set(prevDrivers.keys());

    for (const id of prevIds) {
      if (!currentIds.has(id)) {
        const marker = markersRef.current.get(id);
        marker?.remove();
        markersRef.current.delete(id);
        prevDrivers.delete(id);
        const frame = animFramesRef.current.get(id);
        if (frame) { cancelAnimationFrame(frame); animFramesRef.current.delete(id); }
      }
    }

    for (const driver of filtered) {
      const prev = prevDrivers.get(driver.id);
      const existing = markersRef.current.get(driver.id);
      const newHeading = driver.heading ?? 0;
      const status = getStatusKey(driver);
      const isSelected = driver.driver_id === selectedDriverId || driver.id === selectedDriverId;

      if (existing && prev) {
        const moved = Math.abs(prev.latitude - driver.latitude) > 0.0001 || Math.abs(prev.longitude - driver.longitude) > 0.0001;
        const rotated = Math.abs((prev.heading ?? 0) - newHeading) > 0.5;
        if (moved || rotated) {
          animateMarker(existing, driver.id, prev.latitude, prev.longitude, driver.latitude, driver.longitude, prev.heading ?? 0, newHeading, driver);
        } else {
          existing.getElement().innerHTML = buildDriverMarkerHtml(newHeading, status, driver.vehicle_type);
          existing.getPopup()?.setHTML(buildPopup(driver));
        }
        existing.getElement().style.outline = isSelected ? "3px solid #f97316" : "none";
        existing.getElement().style.borderRadius = "50%";
      } else if (!existing) {
        const el = document.createElement("div");
        el.innerHTML = buildDriverMarkerHtml(newHeading, status, driver.vehicle_type);
        el.style.outline = isSelected ? "3px solid #f97316" : "none";
        el.style.borderRadius = "50%";
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([driver.longitude, driver.latitude])
          .setPopup(new mapboxgl.Popup().setHTML(buildPopup(driver)))
          .addTo(map);
        markersRef.current.set(driver.id, marker);
      }

      prevDrivers.set(driver.id, { ...driver, heading: newHeading });
    }

    if (filtered.length > 0 && !hasAutoFitRef.current) {
      const bounds = filtered.reduce(
        (b, d) => b.extend([d.longitude, d.latitude]),
        new mapboxgl.LngLatBounds()
      );
      map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
      hasAutoFitRef.current = true;
    }
  }, [drivers, vehicleFilter, selectedDriverId, animateMarker, buildPopup]);

  if (webglUnsupported) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center gap-2 text-center p-6" style={{ minHeight: "680px" }}>
        <p className="font-semibold text-gray-700">Map unavailable in this browser</p>
        <p className="text-sm text-gray-500 max-w-sm">
          This view requires WebGL, which isn&apos;t available here (common in embedded webviews like VS Code&apos;s Simple Browser,
          or with hardware acceleration disabled). Open this page in a regular Chrome, Firefox, or Safari window.
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute top-4 right-4 z-[1000] flex gap-2">
        <button
          onClick={() => mapRef.current?.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM })}
          className="bg-white border border-gray-200 shadow-sm rounded-xl px-3 py-2 text-xs font-semibold hover:bg-gray-50"
        >
          Malawi
        </button>
        <button
          onClick={() => fitDriversOnMap(mapRef.current, drivers)}
          className="bg-white border border-gray-200 shadow-sm rounded-xl px-3 py-2 text-xs font-semibold hover:bg-gray-50"
        >
          Fit Drivers
        </button>
      </div>
      <div ref={containerRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden" style={{ minHeight: "680px" }} />
    </div>
  );
}
