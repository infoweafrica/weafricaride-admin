"use client";

import { useEffect, useRef, useState } from "react";

interface Suggestion {
  id: string;
  placeName: string;
  lat: number;
  lng: number;
}

interface AddressAutocompleteProps {
  label: string;
  value: string;
  onChange: (address: string, lat?: number, lng?: number) => void;
  // Fired true when the operator picks a real suggestion (coordinates set),
  // false as soon as they free-type again (coordinates now stale). The
  // operator booking form blocks submit until both addresses are resolved.
  onResolvedChange?: (resolved: boolean) => void;
}

// Pickup/destination were plain text inputs with no geocoding at all —
// operators had to type an address and hope it matched something real,
// with no way to actually set the ride's lat/lng from typed text. This
// uses Mapbox's Geocoding API (same NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
// already configured for the map) for autocomplete suggestions, and
// fills in real coordinates when one is picked.
export default function AddressAutocomplete({ label, value, onChange, onResolvedChange }: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchSuggestions = (query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
      if (!token) {
        console.error("AddressAutocomplete: NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN is not set");
        setError("Address search is not configured");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        // Restrict to the countries WeAfrica operates in (MW primary, ZA for
        // the Cape Town option) + bias toward Lilongwe, so operators can't
        // accidentally resolve a pickup to a same-named street elsewhere.
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
            `?access_token=${token}&autocomplete=true&limit=5` +
            `&country=mw,za&proximity=33.7741,-13.9626` +
            `&types=address,poi,place,locality,neighborhood`
        );
        const body = await res.json();
        if (!res.ok) {
          console.error("AddressAutocomplete: geocoding request failed", res.status, body);
          setError(body?.message || `Address search failed (${res.status})`);
          setSuggestions([]);
          return;
        }
        const results: Suggestion[] = (body.features || []).map((f: any) => ({
          id: f.id,
          placeName: f.place_name,
          lat: f.center[1],
          lng: f.center[0],
        }));
        setSuggestions(results);
        setOpen(results.length > 0);
      } catch (e) {
        console.error("AddressAutocomplete: geocoding request threw", e);
        setError("Address search failed — check your connection");
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  return (
    <div className="relative space-y-1" ref={containerRef}>
      <span className="text-sm font-medium text-gray-600">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onResolvedChange?.(false);
          fetchSuggestions(e.target.value);
        }}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        autoComplete="off"
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:bg-white focus:ring-2 focus:ring-green-400"
      />
      {loading && (
        <div className="absolute right-3 top-9 text-xs text-gray-400">…</div>
      )}
      {error && !loading && (
        <p className="text-xs font-medium text-red-500">{error}</p>
      )}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(s.placeName, s.lat, s.lng);
                  onResolvedChange?.(true);
                  setSuggestions([]);
                  setOpen(false);
                }}
                className="block w-full text-left px-4 py-2 text-sm hover:bg-green-50"
              >
                {s.placeName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
