"use client";

import { useState } from "react";
import { createOperatorRide, estimateOperatorFare } from "@/lib/api/operator-rides";

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
    vehicle_type: "weafrica_x",
    payment_method: "cash",
    city: "Lilongwe",
    operator_notes: "",
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const estimate = estimateOperatorFare(form);

  async function submitRide() {
    setLoading(true);
    setMessage("");
    try {
      const ride = await createOperatorRide(form);
      setMessage(`Ride created successfully. Ride ID: ${ride.id}`);
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
    <main className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Operator Dispatch Center</h1>
        <p className="text-sm text-gray-500">
          Create rides for customers who call, WhatsApp, or cannot use the rider app.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 rounded-2xl border bg-white p-5 space-y-4">
          <h2 className="font-semibold text-lg">Create Ride Request</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Customer name" value={form.customer_name} onChange={(v: string) => update("customer_name", v)} />
            <Input label="Customer phone" value={form.customer_phone} onChange={(v: string) => update("customer_phone", v)} />

            <Input label="Pickup address" value={form.pickup_address} onChange={(v: string) => update("pickup_address", v)} />
            <Input label="Destination address" value={form.dropoff_address} onChange={(v: string) => update("dropoff_address", v)} />

            <Input label="Pickup lat" value={form.pickup_lat} type="number" onChange={(v: string) => update("pickup_lat", Number(v))} />
            <Input label="Pickup lng" value={form.pickup_lng} type="number" onChange={(v: string) => update("pickup_lng", Number(v))} />

            <Input label="Dropoff lat" value={form.dropoff_lat} type="number" onChange={(v: string) => update("dropoff_lat", Number(v))} />
            <Input label="Dropoff lng" value={form.dropoff_lng} type="number" onChange={(v: string) => update("dropoff_lng", Number(v))} />

            <Select label="Vehicle type" value={form.vehicle_type} onChange={(v: string) => update("vehicle_type", v)}
              options={[
                ["weafrica_x", "WeAfrica X"],
                ["weafrica_xl", "WeAfrica XL"],
                ["weafrica_women", "WeAfrica Women"],
                ["weafrica_van", "WeAfrica Van"],
                ["weafrica_shuttle", "WeAfrica Shuttle"],
                ["weafrica_black", "WeAfrica Black"],
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
                ["Lilongwe", "Lilongwe"],
                ["Blantyre", "Blantyre"],
                ["Mzuzu", "Mzuzu"],
                ["Zomba", "Zomba"],
              ]}
            />

            <Input label="Operator notes" value={form.operator_notes} onChange={(v: string) => update("operator_notes", v)} />
          </div>

          <button
            onClick={submitRide}
            disabled={loading}
            className="rounded-xl bg-orange-500 px-5 py-3 text-white font-semibold disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Ride Request"}
          </button>

          {message && <p className="text-sm font-medium">{message}</p>}
        </section>

        <aside className="rounded-2xl border bg-white p-5 space-y-4">
          <h2 className="font-semibold text-lg">Fare Estimate</h2>
          <Row label="Distance" value={`${estimate.distance_km} km`} />
          <Row label="Estimated time" value={`${estimate.duration_min} min`} />
          <Row label="Vehicle" value={form.vehicle_type} />
          <Row label="Payment" value={form.payment_method} />
          <div className="border-t pt-4">
            <Row label="Estimated fare" value={`MK ${estimate.estimated_fare.toLocaleString()}`} strong />
          </div>

          <div className="rounded-xl bg-gray-100 p-4 text-sm text-gray-600">
            Map and live drivers will be connected here next. This page already creates real ride rows.
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
        className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-orange-400"
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
        className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-orange-400"
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
