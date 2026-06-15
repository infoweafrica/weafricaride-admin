"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

export interface CityOption {
  id: string;
  name: string;
  region: string;
  country_id: string;
  country_name?: string;
}

interface CityContextType {
  cities: CityOption[];
  selectedCityId: string | null; // null = all cities
  selectedCityName: string;
  selectedCountryId: string | null;
  setSelectedCity: (cityId: string | null) => void;
  loading: boolean;
}

const CityContext = createContext<CityContextType>({
  cities: [],
  selectedCityId: null,
  selectedCityName: "All Cities",
  selectedCountryId: null,
  setSelectedCity: () => {},
  loading: true,
});

export function useCityContext() {
  return useContext(CityContext);
}

export function CityProvider({ children }: { children: React.ReactNode }) {
  const [cities, setCities] = useState<CityOption[]>([]);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [selectedCountryId, setSelectedCountryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Try to restore from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("weafrica_selected_city");
      if (saved) {
        const parsed = JSON.parse(saved);
        setSelectedCityId(parsed.cityId || null);
        setSelectedCountryId(parsed.countryId || null);
      }
    } catch {
      // Ignore
    }
  }, []);

  // Fetch cities
  useEffect(() => {
    const fetchCities = async () => {
      try {
        const { data } = await supabase
          .from("cities")
          .select("id, name, region, country_id, country:countries(name)")
          .eq("is_active", true)
          .order("name");

        if (data) {
          setCities(
            data.map((c: Record<string, unknown>) => ({
              id: c.id as string,
              name: c.name as string,
              region: c.region as string,
              country_id: c.country_id as string,
              country_name: (c.country as { name?: string })?.name || "",
            }))
          );
        }
      } catch {
        // Cities table may not exist yet — that's fine
        setCities([]);
      } finally {
        setLoading(false);
      }
    };
    fetchCities();
  }, []);

  const setSelectedCity = useCallback(
    (cityId: string | null) => {
      setSelectedCityId(cityId);
      if (cityId) {
        const city = cities.find((c) => c.id === cityId);
        setSelectedCountryId(city?.country_id || null);
        try {
          localStorage.setItem(
            "weafrica_selected_city",
            JSON.stringify({ cityId, countryId: city?.country_id || null })
          );
        } catch {
          // Ignore
        }
      } else {
        setSelectedCountryId(null);
        try {
          localStorage.setItem(
            "weafrica_selected_city",
            JSON.stringify({ cityId: null, countryId: null })
          );
        } catch {
          // Ignore
        }
      }
    },
    [cities]
  );

  const selectedCity = cities.find((c) => c.id === selectedCityId);
  const selectedCityName = selectedCity
    ? `${selectedCity.name}, ${selectedCity.country_name || ""}`
    : "All Cities";

  return (
    <CityContext.Provider
      value={{
        cities,
        selectedCityId,
        selectedCityName,
        selectedCountryId,
        setSelectedCity,
        loading,
      }}
    >
      {children}
    </CityContext.Provider>
  );
}