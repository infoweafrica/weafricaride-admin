"use client";

import { useState } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { Link2, Shield, Database, Webhook } from "lucide-react";

interface Integration {
  key: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  status: "connected" | "disconnected";
  lastSync?: string;
}

export default function IntegrationsPage() {
  return (
    <PermissionGuard permission="manage_integrations">
      <IntegrationsContent />
    </PermissionGuard>
  );
}

function IntegrationsContent() {
  const [integrations] = useState<Integration[]>([
    {
      key: "google_maps",
      name: "Google Maps Platform",
      description: "Maps, geocoding, and directions API",
      icon: <Database className="h-6 w-6 text-blue-600" />,
      status: "connected",
      lastSync: "2026-05-27",
    },
    {
      key: "firebase",
      name: "Firebase Cloud Messaging",
      description: "Push notifications and real-time updates",
      icon: <Webhook className="h-6 w-6 text-orange-600" />,
      status: "connected",
      lastSync: "2026-05-27",
    },
    {
      key: "paychangu",
      name: "PayChangu",
      description: "Malawi payment gateway — Airtel Money, TNM Mpamba, Visa, Mastercard",
      icon: <Link2 className="h-6 w-6 text-emerald-600" />,
      status: "connected",
      lastSync: "2026-05-28",
    },
    {
      key: "mobile_money",
      name: "Airtel Money / Mpamba (Direct)",
      description: "Legacy direct mobile money callback handler",
      icon: <Link2 className="h-6 w-6 text-green-600" />,
      status: "connected",
      lastSync: "2026-05-27",
    },
    {
      key: "stripe",
      name: "Stripe",
      description: "International card processing",
      icon: <Shield className="h-6 w-6 text-purple-600" />,
      status: "disconnected",
    },
    {
      key: "twilio",
      name: "Twilio",
      description: "SMS and phone verification",
      icon: <Webhook className="h-6 w-6 text-red-600" />,
      status: "disconnected",
    },
    {
      key: "sendgrid",
      name: "SendGrid",
      description: "Transactional email service",
      icon: <Link2 className="h-6 w-6 text-blue-400" />,
      status: "disconnected",
    },
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
        <p className="text-sm text-gray-500 mt-1">Manage third-party service connections and webhooks</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {integrations.map((integration) => (
          <div key={integration.key} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div className="p-2 bg-gray-50 rounded-lg">{integration.icon}</div>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  integration.status === "connected"
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {integration.status}
              </span>
            </div>
            <h3 className="font-semibold text-gray-900">{integration.name}</h3>
            <p className="text-xs text-gray-500 mt-1">{integration.description}</p>
            {integration.lastSync && (
              <p className="text-xs text-gray-400 mt-2">Last synced: {integration.lastSync}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}