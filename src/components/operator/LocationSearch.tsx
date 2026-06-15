"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type SelectedLocation = {
  address: string;
  latitude: number;
  longitude: number;
  source: "place" | "pin" | "current_location";
  place_id?: string;
};

type Props = {
  label: string;
  city?: string;
  value?: SelectedLocation | null;
  onSelect: (location: SelectedLocation) => void;
  onChooseMap: () => void;
};

export default function LocationSearch({ label, city, value, onSelect, onChooseMap }: Props) {
  const [query, setQuery] = useState(value?.address ?? "");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const run = async () => {
      if (!query || query.trim().length < 2) {
        setResults([]);
        return;
      }

      setLoading(true);

      let request = supabase
        .from("places")
        .select("*")
        .eq("is_active", true)
        .or(`name.ilike.%${query}%,address.ilike.%${query}%,city.ilike.%${query}%`)
        .limit(8);

      if (city) request = request.eq("city", city);

      const { data } = await request;
      setResults(data ?? []);
      setLoading(false);
    };

    const timer = setTimeout(run, 300);
    return () => clearTimeout(timer);
  }, [query, city]);

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-sm font-medium text-gray-600">{label}</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${label.toLowerCase()}`}
          className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-orange-400"
        />
      </label>

      {loading && <p className="text-xs text-gray-400">Searching...</p>}

      {results.length > 0 && (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          {results.map((place) => (
            <button
              key={place.id}
              type="button"
              onClick={() => {
                const location = {
                  address: `${place.name}, ${place.city}`,
                  latitude: place.latitude,
                  longitude: place.longitude,
                  source: "place" as const,
                  place_id: place.id,
                };
                setQuery(location.address);
                setResults([]);
                onSelect(location);
              }}
              className="block w-full px-3 py-2 text-left hover:bg-orange-50"
            >
              <div className="text-sm font-semibold">{place.name}</div>
              <div className="text-xs text-gray-500">{place.address || place.city}</div>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onChooseMap}
        className="text-xs font-semibold text-orange-600 hover:underline"
      >
        Choose on map instead
      </button>

      {value && (
        <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
          Selected: {value.address}
        </div>
      )}
    </div>
  );
}
