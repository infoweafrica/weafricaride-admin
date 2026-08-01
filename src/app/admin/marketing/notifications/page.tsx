"use client";

import { useState } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { Bell, Send } from "lucide-react";

export default function NotificationsPage() {
  return (
    <PermissionGuard permission="manage_notifications">
      <NotificationsContent />
    </PermissionGuard>
  );
}

function NotificationsContent() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<"all" | "riders" | "drivers" | "city">("all");
  const [sent, setSent] = useState(false);

  const handleSend = () => {
    if (!title.trim() || !body.trim()) return;
    // In production: call Supabase Edge Function to send push notifications
    setSent(true);
    setTimeout(() => setSent(false), 3000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Push Notifications</h1>
        <p className="text-sm text-gray-500 mt-1">Send announcements and alerts to users</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Recipients</label>
            <select value={recipients} onChange={(e) => setRecipients(e.target.value as typeof recipients)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none">
              <option value="all">All Users</option>
              <option value="riders">Riders Only</option>
              <option value="drivers">Drivers Only</option>
              <option value="city">Specific City</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Notification title..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4}
              placeholder="Notification message..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none" />
          </div>
          <button onClick={handleSend} disabled={!title.trim() || !body.trim()}
            className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50">
            <Send className="h-4 w-4" /> Send Notification
          </button>
          {sent && <p className="text-sm text-green-600">Notification sent successfully!</p>}
        </div>
      </div>
    </div>
  );
}