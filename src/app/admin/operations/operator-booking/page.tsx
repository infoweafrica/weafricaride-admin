/* eslint-disable react-hooks/set-state-in-effect, react-hooks/immutability, react-hooks/purity */
"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { createOperatorRide, estimateOperatorFare } from "@/lib/api/operator-rides";
import { supabase } from "@/lib/supabase";
import { isValidMwPhone } from "@/lib/phone";
import PermissionGuard from "@/components/guards/PermissionGuard";
import AddressAutocomplete from "@/components/AddressAutocomplete";

const LiveMapView = dynamic(() => import("../live-map/LiveMapView"), { ssr: false });

export default function DispatchCenterPage() {
  return (
    <PermissionGuard permission="dispatch_rides">
      <DispatchCenterPageInner />
    </PermissionGuard>
  );
}

function DispatchCenterPageInner() {
  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    pickup_address: "",
    dropoff_address: "",
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

  // The pickup/destination lat/lng above are only trustworthy once the
  // operator has actually picked a geocoded suggestion. Booking is blocked
  // until both are resolved (the server rejects unresolved coords anyway).
  const [pickupResolved, setPickupResolved] = useState(false);
  const [dropoffResolved, setDropoffResolved] = useState(false);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [drivers, setDrivers] = useState<any[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [lastRideId, setLastRideId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const fetchDrivers = useCallback(async () => {
    // `drivers.is_online` is the source of truth (set atomically by the
    // driver_go_online/offline RPCs). driver_locations is populated
    // separately by the client's GPS stream and can lag behind or be
    // missing entirely (no fix yet, permission denied) — so it must only
    // enrich position, never gate whether a driver is considered online.
    try {
      const res = await fetch("/api/drivers/operator-available");
      const body = await res.json();
      if (!res.ok) {
        console.error("fetchDrivers: operator-available request failed", body.error);
        setDrivers([]);
        return;
      }
      setDrivers(body.drivers || []);
    } catch (err) {
      console.error("fetchDrivers: operator-available request failed", err);
      setDrivers([]);
    }
  }, []);

  // The anon client's postgres_changes subscription never fired here --
  // Realtime enforces the same RLS as REST, and drivers/driver_locations
  // have no anon/authenticated policy. Polling the service-role-backed
  // route above is the simplest way to actually get live-ish updates.
  useEffect(() => {
    fetchDrivers();
    const interval = setInterval(fetchDrivers, 10000);
    return () => clearInterval(interval);
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

  async function cancelLastRide() {
    if (!lastRideId) return;
    setCancelling(true);
    try {
      const { error } = await supabase.rpc("admin_cancel_ride", {
        p_ride_id: lastRideId,
        p_reason: "Cancelled by operator",
      });
      if (error) throw new Error(error.message);
      setMessage(`Ride ${lastRideId} cancelled.`);
      setLastRideId(null);
    } catch (e: any) {
      setMessage(e?.message ?? "Failed to cancel ride");
    } finally {
      setCancelling(false);
    }
  }

  async function submitRide() {
    setMessage("");
    setLastRideId(null);

    if (!form.customer_name.trim()) {
      setMessage("Customer name is required.");
      return;
    }
    if (!isValidMwPhone(form.customer_phone)) {
      setMessage("Enter a valid Malawi phone number — +265 followed by 9 digits starting 8 or 9.");
      return;
    }
    if (!pickupResolved || !dropoffResolved) {
      setMessage("Pick both the pickup and the destination from the address suggestions so the trip has real coordinates.");
      return;
    }

    setLoading(true);
    try {
      // Everything below (phone format, coordinates, EXACT vehicle-class
      // availability) is re-validated and enforced by operator_create_ride.
      // If no driver of the requested class is available it raises
      // "No WeAfrica X drivers are currently available in your area." and
      // nothing is created.
      const res = await createOperatorRide({ ...form, driver_id: selectedDriverId });

      if (selectedDriverId) {
        const selected = drivers.find((d) => d.driver_id === selectedDriverId);
        setMessage(
          `Ride sent to ${selected?.driver_name || "driver"} (WeAfrica ${res.vehicle_label}). ` +
            `PIN: ${res.rider_pin}. Ride ID: ${res.ride_id}`,
        );
      } else {
        setMessage(
          `Ride created — ${res.requests_sent} WeAfrica ${res.vehicle_label} driver(s) notified. ` +
            `PIN: ${res.rider_pin}. Ride ID: ${res.ride_id}`,
        );
      }
      setLastRideId(res.ride_id);
    } catch (e: any) {
      setMessage(e?.message ?? "Failed to create ride");
    } finally {
      setLoading(false);
    }
  }

  function update(key: string, value: any) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Address autocomplete only fires lat/lng when an actual suggestion is
  // picked (free typing just updates the text, same as before) — so this
  // only overwrites the coordinates when they're actually provided.
  function updateAddress(prefix: "pickup" | "dropoff", address: string, lat?: number, lng?: number) {
    setForm((prev) => ({
      ...prev,
      [`${prefix}_address`]: address,
      ...(lat !== undefined ? { [`${prefix}_lat`]: lat } : {}),
      ...(lng !== undefined ? { [`${prefix}_lng`]: lng } : {}),
    }));
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-green-50/30 to-white p-6 space-y-6">
      <div className="rounded-3xl border bg-white/80 backdrop-blur p-6 shadow-sm flex items-center justify-between">
        <div>
        <h1 className="text-3xl font-black tracking-tight text-slate-900">Operator Dispatch Center</h1>
        <p className="text-sm text-gray-500">
          Create rides, select drivers, generate PINs, and dispatch requests in real time.
        </p>
        </div>
        <div className="hidden md:block rounded-2xl bg-green-500 px-5 py-3 text-white font-bold shadow-sm">Live Dispatch</div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section className="xl:col-span-3 rounded-3xl border bg-white p-5 space-y-4 shadow-sm">
          <h2 className="font-semibold text-lg">Create Ride Request</h2>

          <div className="grid grid-cols-1 gap-4">
            <Input label="Customer name" value={form.customer_name} onChange={(v: string) => update("customer_name", v)} />
            <div>
              <Input label="Customer phone" value={form.customer_phone} onChange={(v: string) => update("customer_phone", v)} />
              {form.customer_phone.trim() !== "" && !isValidMwPhone(form.customer_phone) && (
                <p className="mt-1 text-xs font-medium text-red-500">
                  Not a valid Malawi mobile number (+265, 9 digits starting 8 or 9).
                </p>
              )}
            </div>

            <div>
              <AddressAutocomplete label="Pickup address" value={form.pickup_address}
                onChange={(address, lat, lng) => updateAddress("pickup", address, lat, lng)}
                onResolvedChange={setPickupResolved} />
              {form.pickup_address.trim() !== "" && !pickupResolved && (
                <p className="mt-1 text-xs font-medium text-amber-600">Select a suggestion to lock in the pickup location.</p>
              )}
            </div>
            <div>
              <AddressAutocomplete label="Destination address" value={form.dropoff_address}
                onChange={(address, lat, lng) => updateAddress("dropoff", address, lat, lng)}
                onResolvedChange={setDropoffResolved} />
              {form.dropoff_address.trim() !== "" && !dropoffResolved && (
                <p className="mt-1 text-xs font-medium text-amber-600">Select a suggestion to lock in the destination.</p>
              )}
            </div>



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

            <Input label="Operator notes" value={form.operator_notes} onChange={(v: string) => update("operator_notes", v)} />
          </div>

          <button
            onClick={submitRide}
            disabled={loading || !form.customer_name.trim() || !isValidMwPhone(form.customer_phone) || !pickupResolved || !dropoffResolved}
            className="w-full rounded-2xl bg-green-500 px-5 py-4 text-white font-bold shadow-lg shadow-green-200 hover:bg-green-600 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Ride Request"}
          </button>

          {message && (
            <div className="rounded-xl bg-green-50 border border-green-200 p-3 space-y-2">
              <p className="text-sm font-semibold text-green-700">{message}</p>
              {lastRideId && (
                <button
                  onClick={cancelLastRide}
                  disabled={cancelling}
                  className="w-full rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {cancelling ? "Cancelling..." : "Cancel This Ride"}
                </button>
              )}
            </div>
          )}
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
                <div key={driver.driver_id} className={`rounded-xl border p-3 text-sm ${selectedDriverId === driver.driver_id ? "border-green-500 bg-green-50" : "bg-white"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{driver.driver_name}</p>
                      <p className="text-xs text-gray-500">{driver.plate || "No plate"} · {driver.vehicle || "Vehicle"}</p>
                    </div>
                    <button onClick={() => setSelectedDriverId(driver.driver_id)} className="rounded-xl bg-green-500 px-4 py-2 text-xs font-bold text-white hover:bg-green-600">
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
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:bg-white focus:ring-2 focus:ring-green-400"
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
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:bg-white focus:ring-2 focus:ring-green-400"
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
