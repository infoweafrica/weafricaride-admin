"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Bell, MessageSquare, Mail, Send, RefreshCw } from "lucide-react";
import { formatDate } from "@/lib/utils";

type NotificationLog = {
  id: string;
  channel: string;
  recipient: string;
  subject: string;
  status: string;
  created_at: string;
};

export default function NotificationLogsPage() {
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState("all");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("notification_logs")
        .select("id, channel, recipient, subject, status, created_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (channelFilter !== "all") query = query.eq("channel", channelFilter);

      const { data } = await query;
      if (data) setLogs(data as NotificationLog[]);
    } catch (err) {
      console.error("Notification logs not available:", err);
    } finally {
      setLoading(false);
    }
  }, [channelFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case "push": return <Bell className="h-4 w-4 text-blue-500" />;
      case "sms": return <MessageSquare className="h-4 w-4 text-green-500" />;
      case "whatsapp": return <MessageSquare className="h-4 w-4 text-emerald-500" />;
      case "email": return <Mail className="h-4 w-4 text-purple-500" />;
      default: return <Send className="h-4 w-4 text-gray-500" />;
    }
  };

  const channels = [
    { key: "push", label: "Push", count: logs.filter((l) => l.channel === "push").length, icon: Bell },
    { key: "sms", label: "SMS", count: logs.filter((l) => l.channel === "sms").length, icon: MessageSquare },
    { key: "whatsapp", label: "WhatsApp", count: logs.filter((l) => l.channel === "whatsapp").length, icon: MessageSquare },
    { key: "email", label: "Email", count: logs.filter((l) => l.channel === "email").length, icon: Mail },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notification Logs</h1>
          <p className="text-gray-500 mt-1">Track all push, SMS, WhatsApp, and email notifications sent</p>
        </div>
        <button onClick={fetchLogs} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Channel Breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {channels.map((ch) => (
          <div key={ch.key} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <ch.icon className="h-5 w-5 text-gray-500" />
              <p className="text-xs text-gray-500 font-medium">{ch.label}</p>
            </div>
            <p className="text-2xl font-bold">{ch.count}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}
        className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
        <option value="all">All Channels</option>
        <option value="push">Push</option>
        <option value="sms">SMS</option>
        <option value="whatsapp">WhatsApp</option>
        <option value="email">Email</option>
      </select>

      {/* Logs Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Channel</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Recipient</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Subject</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">Loading...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">
                  No notification logs yet. This table requires a <code className="bg-gray-100 px-1 rounded">notification_logs</code> table.
                </td></tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {getChannelIcon(log.channel)}
                        <span className="capitalize">{log.channel}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{log.recipient}</td>
                    <td className="px-4 py-3 font-medium">{log.subject}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        log.status === "sent" || log.status === "delivered" ? "bg-green-100 text-green-700" :
                        log.status === "failed" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"
                      }`}>{log.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(log.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}