"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "@/lib/mapboxClient";
import "mapbox-gl/dist/mapbox-gl.css";
import type { ServiceZone, ZoneCoordinate } from "@/lib/api/service-zones";

interface ServiceZonesMapProps {
  zones: ServiceZone[];
  selectedZoneId?: string | null;
  draftCoordinates?: ZoneCoordinate[];
  drawingEnabled?: boolean;
  onSelectZone?: (zone: ServiceZone) => void;
  onDraftCoordinatesChange?: (coordinates: ZoneCoordinate[]) => void;
}

// Mapbox uses [lng, lat] — opposite of Leaflet's [lat, lng]
const DEFAULT_CENTER: [number, number] = [33.7741, -13.9626]; // Lilongwe, Malawi
const DEFAULT_ZOOM = 7;

const zoneColors: Record<string, { stroke: string; fill: string }> = {
  operating: { stroke: "#16a34a", fill: "#22c55e" },
  airport: { stroke: "#2563eb", fill: "#3b82f6" },
  surge: { stroke: "#d97706", fill: "#f59e0b" },
  restricted: { stroke: "#dc2626", fill: "#ef4444" },
};

function coordsToLngLats(coords: ZoneCoordinate[]): [number, number][] {
  return coords.map((point) => [point.lng, point.lat]);
}

function zoneCenter(zone: ServiceZone): [number, number] | null {
  // Returned as [lng, lat] for Mapbox use
  if (zone.center_lat != null && zone.center_lng != null) return [zone.center_lng, zone.center_lat];
  if (!zone.boundary_coordinates.length) return null;
  const sum = zone.boundary_coordinates.reduce((acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }), { lat: 0, lng: 0 });
  return [sum.lng / zone.boundary_coordinates.length, sum.lat / zone.boundary_coordinates.length];
}

function circlePolygon(center: [number, number], radiusMeters: number): GeoJSON.Polygon {
  const points = 64;
  const coords: [number, number][] = [];
  const [lng, lat] = center;
  const latRad = (lat * Math.PI) / 180;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(latRad);
  for (let i = 0; i <= points; i++) {
    const theta = (i / points) * 2 * Math.PI;
    coords.push([lng + (radiusMeters * Math.cos(theta)) / metersPerDegLng, lat + (radiusMeters * Math.sin(theta)) / metersPerDegLat]);
  }
  return { type: "Polygon", coordinates: [coords] };
}

// Per-zone layer set tracked as {sourceId, layerIds} so we can removeLayer before removeSource
interface ZoneLayerHandle {
  sourceId: string;
  layerIds: string[];
}

let zoneLayerCounter = 0;

export default function ServiceZonesMap({
  zones,
  selectedZoneId,
  draftCoordinates = [],
  drawingEnabled = false,
  onSelectZone,
  onDraftCoordinatesChange,
}: ServiceZonesMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapLoadedRef = useRef(false);
  const zoneLayersRef = useRef<ZoneLayerHandle[]>([]);
  const zonePopupsRef = useRef<mapboxgl.Popup[]>([]);
  const draftLayerRef = useRef<ZoneLayerHandle | null>(null);
  const draftMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const clickHandlerRef = useRef<((event: mapboxgl.MapMouseEvent) => void) | null>(null);
  const latestDraftRef = useRef<ZoneCoordinate[]>(draftCoordinates);
  const onDraftChangeRef = useRef(onDraftCoordinatesChange);
  const onSelectZoneRef = useRef(onSelectZone);
  const renderZonesRef = useRef<() => void>(() => {});
  const [webglUnsupported, setWebglUnsupported] = useState(false);

  useEffect(() => {
    latestDraftRef.current = draftCoordinates;
    onDraftChangeRef.current = onDraftCoordinatesChange;
    onSelectZoneRef.current = onSelectZone;
  }, [draftCoordinates, onDraftCoordinatesChange, onSelectZone]);

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
    map.addControl(new mapboxgl.NavigationControl());
    map.on("load", () => {
      mapLoadedRef.current = true;
      renderZonesRef.current();
    });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      mapLoadedRef.current = false;
    };
  }, []);

  // Render zones (polygons/circles + driver dots + demand dots)
  useEffect(() => {
    const removeZoneLayers = () => {
      const map = mapRef.current;
      if (!map) return;
      zonePopupsRef.current.forEach((p) => p.remove());
      zonePopupsRef.current = [];
      zoneLayersRef.current.forEach(({ sourceId, layerIds }) => {
        layerIds.forEach((id) => {
          if (map.getLayer(id)) map.removeLayer(id);
        });
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      });
      zoneLayersRef.current = [];
    };

    const render = () => {
      const map = mapRef.current;
      if (!map || !mapLoadedRef.current) return;
      removeZoneLayers();

      const bounds: [number, number][] = [];

      zones.forEach((zone) => {
        const colors = zoneColors[zone.zone_type] || zoneColors.operating;
        const isSelected = zone.id === selectedZoneId;
        const id = `zone-${zoneLayerCounter++}`;
        const fillLayerId = `${id}-fill`;
        const lineLayerId = `${id}-line`;

        if (zone.boundary_coordinates.length >= 3) {
          const ring = coordsToLngLats(zone.boundary_coordinates);
          map.addSource(id, {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } },
          });
          map.addLayer({
            id: fillLayerId,
            type: "fill",
            source: id,
            paint: {
              "fill-color": colors.fill,
              "fill-opacity": zone.status === "disabled" ? 0.08 : isSelected ? 0.32 : 0.18,
            },
          });
          map.addLayer({
            id: lineLayerId,
            type: "line",
            source: id,
            paint: {
              "line-color": colors.stroke,
              "line-opacity": zone.status === "disabled" ? 0.45 : 0.95,
              "line-width": isSelected ? 4 : 2,
            },
          });
          zoneLayersRef.current.push({ sourceId: id, layerIds: [fillLayerId, lineLayerId] });
          zone.boundary_coordinates.forEach((point) => bounds.push([point.lng, point.lat]));

          const clickHandler = () => onSelectZoneRef.current?.(zone);
          map.on("click", fillLayerId, clickHandler);
          map.on("mouseenter", fillLayerId, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", fillLayerId, () => { map.getCanvas().style.cursor = drawingEnabled ? "crosshair" : ""; });

          const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });
          map.on("click", fillLayerId, (e) => {
            popup.setLngLat(e.lngLat).setHTML(`<strong>${zone.name}</strong><br/>${zone.city}<br/>${zone.zone_type} · ${zone.status}`).addTo(map);
          });
          zonePopupsRef.current.push(popup);
        } else {
          const center = zoneCenter(zone);
          if (!center) return;
          map.addSource(id, {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: circlePolygon(center, 4500) },
          });
          map.addLayer({
            id: fillLayerId,
            type: "fill",
            source: id,
            paint: { "fill-color": colors.fill, "fill-opacity": isSelected ? 0.28 : 0.14 },
          });
          map.addLayer({
            id: lineLayerId,
            type: "line",
            source: id,
            paint: { "line-color": colors.stroke, "line-width": isSelected ? 4 : 2 },
          });
          zoneLayersRef.current.push({ sourceId: id, layerIds: [fillLayerId, lineLayerId] });
          bounds.push(center);

          map.on("click", fillLayerId, () => onSelectZoneRef.current?.(zone));
          map.on("mouseenter", fillLayerId, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", fillLayerId, () => { map.getCanvas().style.cursor = drawingEnabled ? "crosshair" : ""; });

          const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });
          map.on("click", fillLayerId, (e) => {
            popup.setLngLat(e.lngLat).setHTML(`<strong>${zone.name}</strong><br/>${zone.city}<br/>No polygon boundary yet`).addTo(map);
          });
          zonePopupsRef.current.push(popup);
        }

        const drivers = (zone.drivers || []).slice(0, 80);
        if (drivers.length > 0) {
          const driversSourceId = `${id}-drivers`;
          map.addSource(driversSourceId, {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: drivers.map((driver) => ({
                type: "Feature",
                properties: { name: driver.name, vehicle: driver.vehicle_label, online: driver.is_online },
                geometry: { type: "Point", coordinates: [driver.longitude, driver.latitude] },
              })),
            },
          });
          const driversLayerId = `${driversSourceId}-layer`;
          map.addLayer({
            id: driversLayerId,
            type: "circle",
            source: driversSourceId,
            paint: {
              "circle-radius": 5,
              "circle-color": ["case", ["get", "online"], "#22c55e", "#d1d5db"],
              "circle-stroke-color": ["case", ["get", "online"], "#16a34a", "#9ca3af"],
              "circle-stroke-width": 1,
              "circle-opacity": 0.9,
            },
          });
          zoneLayersRef.current.push({ sourceId: driversSourceId, layerIds: [driversLayerId] });
          const driverPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });
          map.on("click", driversLayerId, (e) => {
            const f = e.features?.[0];
            if (!f) return;
            driverPopup.setLngLat(e.lngLat).setHTML(`<strong>${f.properties?.name}</strong><br/>${f.properties?.vehicle}<br/>${f.properties?.online ? "Online" : "Offline"}`).addTo(map);
          });
          zonePopupsRef.current.push(driverPopup);
        }

        const trips = (zone.trips || []).slice(0, 50);
        if (trips.length > 0) {
          const center = zoneCenter(zone);
          if (center) {
            const tripsSourceId = `${id}-trips`;
            map.addSource(tripsSourceId, {
              type: "geojson",
              data: {
                type: "FeatureCollection",
                features: trips.map((trip) => ({
                  type: "Feature",
                  properties: { status: trip.status, pickup_address: trip.pickup_address },
                  geometry: {
                    type: "Point",
                    coordinates: [center[0] + (Math.random() - 0.5) * 0.04, center[1] + (Math.random() - 0.5) * 0.04],
                  },
                })),
              },
            });
            const tripsLayerId = `${tripsSourceId}-layer`;
            map.addLayer({
              id: tripsLayerId,
              type: "circle",
              source: tripsSourceId,
              paint: {
                "circle-radius": 4,
                "circle-color": "#fb923c",
                "circle-opacity": 0.35,
                "circle-stroke-color": "#f97316",
                "circle-stroke-opacity": 0.55,
                "circle-stroke-width": 1,
              },
            });
            zoneLayersRef.current.push({ sourceId: tripsSourceId, layerIds: [tripsLayerId] });
            const tripPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });
            map.on("click", tripsLayerId, (e) => {
              const f = e.features?.[0];
              if (!f) return;
              tripPopup.setLngLat(e.lngLat).setHTML(`<strong>Demand</strong><br/>${f.properties?.status}<br/>${f.properties?.pickup_address}`).addTo(map);
            });
            zonePopupsRef.current.push(tripPopup);
          }
        }
      });

      if (bounds.length > 0 && !selectedZoneId) {
        const b = bounds.reduce((acc, p) => acc.extend(p), new mapboxgl.LngLatBounds());
        map.fitBounds(b, { padding: 28, maxZoom: 13 });
      }

      if (selectedZoneId) {
        const selected = zones.find((zone) => zone.id === selectedZoneId);
        const points = selected?.boundary_coordinates?.length ? coordsToLngLats(selected.boundary_coordinates) : [];
        if (points.length >= 2) {
          const b = points.reduce((acc, p) => acc.extend(p), new mapboxgl.LngLatBounds());
          map.fitBounds(b, { padding: 36, maxZoom: 15 });
        } else {
          const center = selected ? zoneCenter(selected) : null;
          if (center) map.flyTo({ center, zoom: 13 });
        }
      }
    };

    renderZonesRef.current = render;
    render();

    return removeZoneLayers;
  }, [zones, selectedZoneId, drawingEnabled]);

  // Render draft polygon/polyline + numbered vertex markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    const removeDraft = () => {
      if (draftLayerRef.current) {
        const { sourceId, layerIds } = draftLayerRef.current;
        layerIds.forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
        if (map.getSource(sourceId)) map.removeSource(sourceId);
        draftLayerRef.current = null;
      }
      draftMarkersRef.current.forEach((m) => m.remove());
      draftMarkersRef.current = [];
    };

    removeDraft();

    if (draftCoordinates.length >= 2) {
      const id = "draft-outline";
      const coords = coordsToLngLats(draftCoordinates);
      const isPolygon = draftCoordinates.length >= 3;
      map.addSource(id, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: isPolygon ? { type: "Polygon", coordinates: [coords] } : { type: "LineString", coordinates: coords },
        },
      });
      const layerIds: string[] = [];
      if (isPolygon) {
        map.addLayer({ id: `${id}-fill`, type: "fill", source: id, paint: { "fill-color": "#111827", "fill-opacity": 0.08 } });
        layerIds.push(`${id}-fill`);
      }
      map.addLayer({ id: `${id}-line`, type: "line", source: id, paint: { "line-color": "#111827", "line-width": 3, "line-dasharray": [2, 1.5] } });
      layerIds.push(`${id}-line`);
      draftLayerRef.current = { sourceId: id, layerIds };
    }

    draftCoordinates.forEach((point, index) => {
      const el = document.createElement("div");
      el.style.cssText =
        "width:18px;height:18px;border-radius:50%;background:#ffffff;border:2px solid #111827;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#111827";
      el.innerText = String(index + 1);
      const marker = new mapboxgl.Marker({ element: el }).setLngLat([point.lng, point.lat]).addTo(map);
      draftMarkersRef.current.push(marker);
    });

    return removeDraft;
  }, [draftCoordinates]);

  // Click-to-add-point drawing mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const attach = () => {
      if (clickHandlerRef.current) {
        map.off("click", clickHandlerRef.current);
        clickHandlerRef.current = null;
      }
      if (!drawingEnabled) {
        map.getCanvas().style.cursor = "";
        return;
      }

      map.getCanvas().style.cursor = "crosshair";
      const handler = (event: mapboxgl.MapMouseEvent) => {
        const next = [...latestDraftRef.current, { lat: Number(event.lngLat.lat.toFixed(6)), lng: Number(event.lngLat.lng.toFixed(6)) }];
        onDraftChangeRef.current?.(next);
      };
      clickHandlerRef.current = handler;
      map.on("click", handler);
    };

    if (mapLoadedRef.current) attach();
    else map.once("load", attach);

    return () => {
      if (clickHandlerRef.current) map.off("click", clickHandlerRef.current);
      map.getCanvas().style.cursor = "";
    };
  }, [drawingEnabled]);

  if (webglUnsupported) {
    return (
      <div className="min-h-[520px] flex flex-col items-center justify-center gap-2 text-center p-6 rounded-2xl border border-gray-200 bg-white">
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
      <div ref={containerRef} className="min-h-[520px] overflow-hidden rounded-2xl border border-gray-200 bg-white" />
      <div className="absolute left-3 top-3 z-[1000] max-w-xs rounded-xl border border-gray-200 bg-white/95 p-3 text-xs text-gray-600 shadow-sm">
        <p className="font-semibold text-gray-900">Zone boundary map</p>
        <p className="mt-1">{drawingEnabled ? "Click on the map to add polygon points. Use Reset/Undo in the form to edit." : "Select a zone or open Add/Edit to draw boundaries."}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(zoneColors).map(([type, colors]) => (
            <span key={type} className="inline-flex items-center gap-1 capitalize"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors.fill }} />{type}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
