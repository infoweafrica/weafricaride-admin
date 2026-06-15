"use client";

import { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

// Fix default marker icon paths (Leaflet + webpack issue)
import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";

const DefaultIcon = L.icon({
  iconUrl: icon.src,
  shadowUrl: iconShadow.src,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

interface DriverLocation {
  id: string;
  driver_id: string;
  driver_name: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  is_online: boolean;
  updated_at: string;
}

interface RideOnMap {
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
  onForceOffline?: (driverId: string) => void;
  onSuspendDriver?: (driverId: string) => void;
}

// Color-coded driver car icon
const createDriverIcon = (heading: number, isOnTrip: boolean) => {
  const bgColor = isOnTrip ? "#2563EB" : "#22C55E";
  return L.divIcon({
    className: "",
    html: `<div style="
      width:46px; height:46px;
      background:${bgColor};
      border:3px solid white;
      border-radius:18px;
      box-shadow:0 6px 18px rgba(0,0,0,0.35);
      display:flex; align-items:center; justify-content:center;
      transform:rotate(${heading}deg);
      transition:transform 0.8s ease-in-out;
      position:relative;
    ">
      <div style="
        width:24px;
        height:14px;
        background:white;
        border-radius:8px 8px 5px 5px;
        position:relative;
      ">
        <span style="position:absolute;left:3px;bottom:-4px;width:5px;height:5px;background:#111827;border-radius:50%;"></span>
        <span style="position:absolute;right:3px;bottom:-4px;width:5px;height:5px;background:#111827;border-radius:50%;"></span>
        <span style="position:absolute;left:8px;top:2px;width:8px;height:4px;background:${bgColor};opacity:.55;border-radius:4px;"></span>
      </div>
    </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
};

const createPickupIcon = () => L.divIcon({
  className: "",
  html: `<div style="width:28px;height:28px;background:#22c55e;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px">📍</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const createDropoffIcon = () => L.divIcon({
  className: "",
  html: `<div style="width:28px;height:28px;background:#ef4444;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px">🏁</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const DEFAULT_CENTER: L.LatLngExpression = [-13.9626, 33.7741];
const DEFAULT_ZOOM = 7;
const ANIM_DURATION = 800;

function fitDriversOnMap(map: L.Map | null, drivers: DriverLocation[]) {
  if (!map || drivers.length === 0) return;

  const bounds = L.latLngBounds(
    drivers.map((d) => [d.latitude, d.longitude] as [number, number])
  );

  map.fitBounds(bounds, {
    padding: [60, 60],
    maxZoom: 15,
  });
}

export default function LiveMapView({
  drivers,
  rides = [],
  onForceOffline,
  onSuspendDriver,
}: LiveMapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const rideMarkersRef = useRef<L.Layer[]>([]);
  const prevDriversRef = useRef<Map<string, DriverLocation>>(new Map());
  const animFramesRef = useRef<Map<string, number>>(new Map());
  const hasAutoFitRef = useRef(false);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    const clusterGroup = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 48,
    });

    clusterGroup.addTo(map);

    clusterGroupRef.current = clusterGroup;
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Render ride markers + lines
  useEffect(() => {
    if (!mapRef.current) return;
    // Clear old ride layers
    rideMarkersRef.current.forEach((l) => l.remove());
    rideMarkersRef.current = [];

    rides.forEach((ride) => {
      if (!ride.pickup_lat || !ride.pickup_lng) return;

      const pickupMarker = L.marker([ride.pickup_lat, ride.pickup_lng], { icon: createPickupIcon() })
        .addTo(mapRef.current!)
        .bindPopup(`<div style="min-width:150px"><strong>Pickup</strong><br/>${ride.pickup_addr}<br/><span style="font-size:11px">Rider: ${ride.rider_name || "—"}</span></div>`);
      rideMarkersRef.current.push(pickupMarker);

      if (ride.dropoff_lat && ride.dropoff_lng) {
        const dropoffMarker = L.marker([ride.dropoff_lat, ride.dropoff_lng], { icon: createDropoffIcon() })
          .addTo(mapRef.current!)
          .bindPopup(`<div style="min-width:150px"><strong>Drop-off</strong><br/>${ride.dropoff_addr}<br/><span style="font-size:11px">${ride.status}</span></div>`);
        rideMarkersRef.current.push(dropoffMarker);

        // Draw trip line
        const line = L.polyline(
          [[ride.pickup_lat, ride.pickup_lng], [ride.dropoff_lat, ride.dropoff_lng]],
          { color: ride.status === "in_progress" ? "#2563EB" : "#F59E0B", weight: 3, dashArray: "8 4", opacity: 0.7 }
        ).addTo(mapRef.current!);
        rideMarkersRef.current.push(line);
      }
    });
  }, [rides]);

  // Smooth marker animation
  const animateMarker = useCallback(
    (marker: L.Marker, driverId: string, fromLat: number, fromLng: number, toLat: number, toLng: number, fromHeading: number, toHeading: number, driver: DriverLocation) => {
      const existing = animFramesRef.current.get(driverId);
      if (existing) cancelAnimationFrame(existing);
      const startTime = performance.now();

      const step = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / ANIM_DURATION, 1);
        const eased = progress < 0.5 ? 4*progress*progress*progress : 1 - Math.pow(-2*progress+2, 3)/2;

        const lat = fromLat + (toLat - fromLat) * eased;
        const lng = fromLng + (toLng - fromLng) * eased;
        let hDiff = toHeading - fromHeading;
        while (hDiff > 180) hDiff -= 360;
        while (hDiff < -180) hDiff += 360;
        const h = fromHeading + hDiff * eased;

        marker.setLatLng([lat, lng]);
        const onTrip = (driver as unknown as Record<string, unknown>).on_trip as boolean || false;
        marker.setIcon(createDriverIcon(h, onTrip));
        marker.setPopupContent(buildPopup(driver));

        if (progress < 1) {
          animFramesRef.current.set(driverId, requestAnimationFrame(step));
        } else {
          animFramesRef.current.delete(driverId);
        }
      };
      animFramesRef.current.set(driverId, requestAnimationFrame(step));
    }, []);

  // Build enhanced popup HTML
  function buildPopup(d: DriverLocation): string {
    const id = d.driver_id || d.id;
    const onTrip = (d as unknown as Record<string, unknown>).on_trip as boolean || false;
    const statusColor = onTrip ? "#2563EB" : "#22C55E";
    const statusLabel = onTrip ? "On Trip" : "Available";

    return `<div style="min-width:180px;font-size:13px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${statusColor}"></span>
        <strong>${d.driver_name}</strong>
        <span style="font-size:11px;color:#6b7280">${statusLabel}</span>
      </div>
      ${d.speed != null ? `<div>🏎️ ${d.speed.toFixed(1)} km/h</div>` : ""}
      <div style="font-size:11px;color:#9ca3af">Last seen: ${new Date(d.updated_at).toLocaleTimeString()}</div>
      <div style="margin-top:6px;display:flex;gap:4px">
        <button onclick="window.__weafricaForceOffline('${id}')" style="padding:3px 8px;font-size:11px;border-radius:6px;border:1px solid #ef4444;color:#ef4444;background:white;cursor:pointer">Go Go Offline</button>
        <button onclick="window.__weafricaSuspend('${id}')" style="padding:3px 8px;font-size:11px;border-radius:6px;border:1px solid #f59e0b;color:#f59e0b;background:white;cursor:pointer">Suspend</button>
      </div>
    </div>`;
  }

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

  // Update driver markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const prevDrivers = prevDriversRef.current;
    const currentIds = new Set(drivers.map((d) => d.id));
    const prevIds = new Set(prevDrivers.keys());

    for (const id of prevIds) {
      if (!currentIds.has(id)) {
        const marker = markersRef.current.get(id);
        if (marker) clusterGroupRef.current?.removeLayer(marker);
        markersRef.current.delete(id);
        prevDrivers.delete(id);
        const frame = animFramesRef.current.get(id);
        if (frame) { cancelAnimationFrame(frame); animFramesRef.current.delete(id); }
      }
    }

    for (const driver of drivers) {
      const latLng: L.LatLngExpression = [driver.latitude, driver.longitude];
      const prev = prevDrivers.get(driver.id);
      const existing = markersRef.current.get(driver.id);
      const newHeading = driver.heading ?? 0;
      const onTrip = (driver as unknown as Record<string, unknown>).on_trip as boolean || false;

      if (existing && prev) {
        const moved = Math.abs(prev.latitude - driver.latitude) > 0.0001 || Math.abs(prev.longitude - driver.longitude) > 0.0001;
        const rotated = Math.abs((prev.heading ?? 0) - newHeading) > 0.5;

        if (moved || rotated) {
          animateMarker(existing, driver.id, prev.latitude, prev.longitude, driver.latitude, driver.longitude, prev.heading ?? 0, newHeading, driver);
        } else {
          existing.setIcon(createDriverIcon(newHeading, onTrip));
          existing.setPopupContent(buildPopup(driver));
        }
      } else if (!existing) {
        const marker = L.marker(latLng, { icon: createDriverIcon(newHeading, onTrip) })
          .bindPopup(buildPopup(driver));

        clusterGroupRef.current?.addLayer(marker);
        markersRef.current.set(driver.id, marker);
      }

      prevDrivers.set(driver.id, { ...driver, heading: newHeading });
    }

    for (const id of prevIds) {
      if (!currentIds.has(id)) prevDrivers.delete(id);
    }

    if (drivers.length > 0 && !hasAutoFitRef.current) {
      const bounds = L.latLngBounds(
        drivers.map((d) => [d.latitude, d.longitude] as [number, number])
      );
      map.fitBounds(bounds, {
        padding: [60, 60],
        maxZoom: 15,
      });
      hasAutoFitRef.current = true;
    }
  }, [drivers, animateMarker]);

  return (
    <div className="relative">
      <div className="absolute top-4 right-4 z-[1000] flex gap-2">
        <button
          onClick={() => {
            mapRef.current?.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
          }}
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

      <div
        ref={containerRef}
        className="bg-white rounded-xl border border-gray-200 overflow-hidden"
        style={{ minHeight: "680px" }}
      />
    </div>
  );
}