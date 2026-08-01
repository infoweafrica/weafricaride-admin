/* eslint-disable react-hooks/set-state-in-effect, react-hooks/immutability, react-hooks/purity */
"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { createOperatorRide, estimateOperatorFare } from "@/lib/api/operator-rides";
import { supabase } from "@/lib/supabase";

const LiveMapView = dynamic(() => import("../live-map/LiveMapView"), { ssr: false });

export default function DispatchCenterPage() {
  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    pickup_address: "Lilongwe City Centre",
    dropoff_address: "Area 18",
    pickup_lat: -13.9626,
    pickup_lng: 33.7741,
    dropoff_lat: -13.935,
    dropoff_lng: 33.787,
    vehicle_type: "x",
    payment_method: "cash",
    city: "Lilongwe",
    operator_notes: "",
    request_source: "phone_call",
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [drivers, setDrivers] = useState<any[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

  const fetchDrivers = useCallback(async () => {
    // `drivers.is_online` is the source of truth (set atomically by the
    // driver_go_online/offline RPCs). driver_locations is populated
    // separately by the client's GPS stream and can lag behind or be
    // missing entirely (no fix yet, permission denied) — so it must only
    // enrich position, never gate whether a driver is considered online.
    const { data: drData, error: drErr } = await supabase
      .from("drivers")
      .select("id, user:users(full_name), vehicle:vehicles!drivers_vehicle_id_fkey(plate_number, make, model, vehicle_type)")
      .eq("is_online", true);

    if (drErr) {
      console.error("fetchDrivers: drivers query failed", drErr);
      setDrivers([]);
      return;
    }

    const ids = (drData || []).map((d: any) => d.id);
    const locMap: Record<string, any> = {};
    if (ids.length > 0) {
      const { data: locData, error: locErr } = await supabase
        .from("driver_locations")
        .select("driver_id, latitude, longitude, heading, speed, updated_at")
        .in("driver_id", ids);

      if (locErr) {
        console.error("fetchDrivers: driver_locations query failed", locErr);
      } else {
        (locData || []).forEach((l: any) => {
          locMap[l.driver_id] = l;
        });
      }
    }

    const result = (drData || []).map((d: any) => {
      const loc = locMap[d.id];
      return {
        id: d.id,
        driver_id: d.id,
        driver_name: d.user?.full_name || d.id.slice(0, 8),
        plate: d.vehicle?.plate_number,
        vehicle: [d.vehicle?.make, d.vehicle?.model].filter(Boolean).join(" "),
        vehicle_type: d.vehicle?.vehicle_type,
        latitude: loc?.latitude ?? null,
        longitude: loc?.longitude ?? null,
        heading: loc?.heading,
        speed: loc?.speed,
        is_online: true,
        updated_at: loc?.updated_at,
      };
    });

    setDrivers(result);
  }, []);

  useEffect(() => {
    fetchDrivers();

    const channel = supabase
      .channel("operator_booking_driver_locations")
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_locations" }, fetchDrivers)
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, fetchDrivers)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchDrivers]);

  async function forceOffline(driverId: string) {
    await supabase.rpc("admin_force_driver_offline", { p_driver_id: driverId });
    await fetchDrivers();
  }

  async function suspendDriver(driverId: string) {
    await supabase.rpc("admin_suspend_driver", { p_driver_id: driverId, p_reason: "Suspended from operator booking" });
    await fetchDrivers();
  }


  const driversWithLocation = drivers.filter((d) => d.latitude != null && d.longitude != null);
  const estimate = estimateOperatorFare(form);
  const currencyPrefix = form.city === "Cape Town" ? "R" : "MK";
  const selectedDriver = selectedDriverId ? drivers.find((d) => d.driver_id === selectedDriverId) : null;

  async function submitRide() {
    setLoading(true);
    setMessage("");

    try {
      if (!form.customer_name || !form.customer_phone || !form.pickup_address || !form.dropoff_address) {
        throw new Error("Customer name, phone, pickup, and destination are required.");
      }

      const ride = await createOperatorRide(form);
      const pin = String(Math.floor(1000 + Math.random() * 9000));

      await supabase
        .from("rides")
        .update({
          rider_pin: pin,
          request_source: form.request_source,
          status: "searching",
          updated_at: new Date().toISOString(),
        })
        .eq("id", ride.id);

      if (selectedDriverId) {
        const selected = drivers.find((d) => d.driver_id === selectedDriverId);

        const { error: reqErr } = await supabase.from("ride_requests").insert({
          ride_id: ride.id,
          driver_id: selectedDriverId,
          rider_id: ride.rider_id || null,
          pickup_address: form.pickup_address,
          pickup_lat: form.pickup_lat,
          pickup_lng: form.pickup_lng,
          destination_address: form.dropoff_address,
          destination_lat: form.dropoff_lat,
          destination_lng: form.dropoff_lng,
          status: "pending",
          vehicle_class: form.vehicle_type,
          estimated_fare: estimate.estimated_fare,
          payment_method: form.payment_method,
          expires_at: new Date(Date.now() + 30000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        if (reqErr) throw new Error(reqErr.message);

        await supabase
          .from("rides")
          .update({
            driver_id: selectedDriverId,
            status: "searching",
            updated_at: new Date().toISOString(),
          })
          .eq("id", ride.id);

        setMessage(`Ride sent to ${selected?.driver_name || "driver"}. PIN: ${pin}. Ride ID: ${ride.id}`);
      } else {
        const { error: rpcErr } = await supabase.rpc("assign_driver", { p_ride_id: ride.id });
        if (rpcErr) throw new Error(rpcErr.message);
        setMessage(`Ride created and auto-dispatched. PIN: ${pin}. Ride ID: ${ride.id}`);
      }
    } catch (e: any) {
      setMessage(e?.message ?? "Failed to create ride");
    } finally {
      setLoading(false);
    }
  }

  function update(key: string, value: any) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-orange-50/30 to-white p-6 space-y-6">
      <div className="rounded-3xl border bg-white/80 backdrop-blur p-6 shadow-sm flex items-center justify-between">
        <div>
        <h1 className="text-3xl font-black tracking-tight text-slate-900">Operator Dispatch Center</h1>
        <p className="text-sm text-gray-500">
          Create rides, select drivers, generate PINs, and dispatch requests in real time.
        </p>
        </div>
        <div className="hidden md:block rounded-2xl bg-orange-500 px-5 py-3 text-white font-bold shadow-sm">Live Dispatch</div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section className="xl:col-span-3 rounded-3xl border bg-white p-5 space-y-4 shadow-sm">
          <h2 className="font-semibold text-lg">Create Ride Request</h2>

          <div className="grid grid-cols-1 gap-4">
            <Input label="Customer name" value={form.customer_name} onChange={(v: string) => update("customer_name", v)} />
            <Input label="Customer phone" value={form.customer_phone} onChange={(v: string) => update("customer_phone", v)} />

            <Input label="Pickup address" value={form.pickup_address} onChange={(v: string) => update("pickup_address", v)} />
            <Input label="Destination address" value={form.dropoff_address} onChange={(v: string) => update("dropoff_address", v)} />



            <Select label="Vehicle type" value={form.vehicle_type} onChange={(v: string) => update("vehicle_type", v)}
              options={[
                ["go", "WeAfrica Go"],
                ["x", "WeAfrica X"],
                ["xl", "WeAfrica XL"],
                ["comfort", "WeAfrica Comfort"],
                ["black", "WeAfrica Black"],
                ["women", "WeAfrica Women"],
              ]}
            />

            <Select label="Payment method" value={form.payment_method} onChange={(v: string) => update("payment_method", v)}
              options={[
                ["cash", "Cash"],
                ["airtel_money", "Airtel Money"],
                ["tnm_mpamba", "TNM Mpamba"],
                ["wallet", "Wallet"],
                ["bank_card", "Bank Card"],
              ]}
            />

            <Select label="City" value={form.city} onChange={(v: string) => update("city", v)}
              options={[
                ["Cape Town", "Cape Town"],
                ["Lilongwe", "Lilongwe"],
                ["Blantyre", "Blantyre"],
                ["Mzuzu", "Mzuzu"],
                ["Zomba", "Zomba"],
              ]}
            />

            <Select label="Request source" value={form.request_source} onChange={(v: string) => update("request_source", v)}
              options={[
                ["phone_call", "Phone Call"],
                ["whatsapp", "WhatsApp"],
                ["walk_in", "Walk-in"],
                ["hotel", "Hotel Concierge"],
              ]}
            />

            <Select label="Request source" value={form.request_source} onChange={(v: string) => update("request_source", v)}
              options={[
                ["phone_call", "Phone Call"],
                ["whatsapp", "WhatsApp"],
                ["walk_in", "Walk-in"],
                ["hotel", "Hotel Concierge"],
              ]}
            />

            <Input label="Operator notes" value={form.operator_notes} onChange={(v: string) => update("operator_notes", v)} />
          </div>

          <button
            onClick={submitRide}
            disabled={loading}
            className="w-full rounded-2xl bg-orange-500 px-5 py-4 text-white font-bold shadow-lg shadow-orange-200 hover:bg-orange-600 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Ride Request"}
          </button>

          {message && <p className="rounded-xl bg-orange-50 border border-orange-200 p-3 text-sm font-semibold text-orange-700">{message}</p>}
        </section>

        <section className="xl:col-span-6 rounded-3xl border bg-white p-3 min-h-[650px] shadow-sm">
  <div className="mb-3 flex items-center justify-between">
    <div>
      <h2 className="font-semibold text-lg">Live Driver Map</h2>
      <p className="text-xs text-gray-500">Pickup, destination, online drivers, and assignment actions.</p>
    </div>
    <button onClick={fetchDrivers} className="rounded-xl border bg-white px-4 py-2 text-sm font-bold hover:bg-slate-50">Refresh</button>
  </div>

  <div className="h-[590px] overflow-hidden rounded-xl">
    <LiveMapView
      drivers={driversWithLocation}
      rides={[{
        id: "operator-preview",
        status: "preview",
        pickup_lat: form.pickup_lat,
        pickup_lng: form.pickup_lng,
        dropoff_lat: form.dropoff_lat,
        dropoff_lng: form.dropoff_lng,
        pickup_addr: form.pickup_address,
        dropoff_addr: form.dropoff_address,
      }]}
      selectedDriverId={selectedDriverId}
      onForceOffline={forceOffline}
      onSuspendDriver={suspendDriver}
    />
  </div>
</section>

        <aside className="xl:col-span-3 rounded-3xl border bg-white p-5 space-y-4 shadow-sm">
          <h2 className="font-semibold text-lg">Fare Estimate</h2>
          <Row label="Distance" value={`${estimate.distance_km} km`} />
          <Row label="Estimated time" value={`${estimate.duration_min} min`} />
          <Row label="Vehicle" value={form.vehicle_type} />
          <Row label="Payment" value={form.payment_method} />
          <Row label="Selected driver" value={selectedDriver ? `${selectedDriver.driver_name} · ${selectedDriver.plate || "No plate"}` : "Auto assign / not selected"} />
          <div className="border-t pt-4">
            <Row label="Estimated fare" value={`${currencyPrefix} ${estimate.estimated_fare.toLocaleString()}`} strong />
          </div>

          <div className="border-t pt-4 space-y-3">
            <h3 className="font-semibold">Online Drivers ({drivers.length})</h3>
            <div className="space-y-2 max-h-72 overflow-auto">
              {drivers.length === 0 ? (
                <p className="text-sm text-gray-500">No online drivers found.</p>
              ) : drivers.map((driver) => (
                <div key={driver.driver_id} className={`rounded-xl border p-3 text-sm ${selectedDriverId === driver.driver_id ? "border-orange-500 bg-orange-50" : "bg-white"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{driver.driver_name}</p>
                      <p className="text-xs text-gray-500">{driver.plate || "No plate"} · {driver.vehicle || "Vehicle"}</p>
                    </div>
                    <button onClick={() => setSelectedDriverId(driver.driver_id)} className="rounded-xl bg-orange-500 px-4 py-2 text-xs font-bold text-white hover:bg-orange-600">
                      Select
                    </button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => forceOffline(driver.driver_id)} className="rounded-lg border px-2 py-1 text-xs text-gray-700">Force offline</button>
                    <button onClick={() => suspendDriver(driver.driver_id)} className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-600">Suspend</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Input({ label, value, onChange, type = "text" }: any) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium text-gray-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:bg-white focus:ring-2 focus:ring-orange-400"
      />
    </label>
  );
}

function Select({ label, value, onChange, options }: any) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium text-gray-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:bg-white focus:ring-2 focus:ring-orange-400"
      >
        {options.map(([v, l]: any) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function Row({ label, value, strong = false }: any) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={strong ? "font-bold text-lg" : "font-semibold"}>{value}</span>
    </div>
  );
}
