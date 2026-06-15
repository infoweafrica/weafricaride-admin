"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  Bell, Send, Clock, CheckCircle, XCircle, Calendar, Users,
  ChevronDown, Eye, Copy, Trash2, AlertTriangle, Zap, Target,
  Smartphone, MapPin, Image as ImageIcon, RefreshCw,
} from "lucide-react";
import { formatNumber, timeAgo, formatDate } from "@/lib/utils";

const NOTIFICATION_TYPES = [
  { value: "general", label: "General Announcement" },
  { value: "promo", label: "Rider Promotion" },
  { value: "driver_alert", label: "Driver Alert" },
  { value: "safety", label: "Safety Alert" },
  { value: "trip_update", label: "Trip Update" },
  { value: "payment", label: "Payment Alert" },
  { value: "account", label: "Account Notice" },
  { value: "maintenance", label: "System Maintenance" },
  { value: "emergency", label: "Emergency Alert" },
];

const RECIPIENT_GROUPS = [
  { value: "all", label: "All Users" },
  { value: "riders", label: "Riders Only" },
  { value: "drivers", label: "Drivers Only" },
  { value: "approved_drivers", label: "Approved Drivers" },
  { value: "pending_drivers", label: "Pending Drivers" },
  { value: "online_drivers", label: "Online Drivers" },
  { value: "offline_drivers", label: "Offline Drivers" },
  { value: "city", label: "Specific City" },
  { value: "country", label: "Specific Country" },
  { value: "high_value", label: "High Value Riders" },
  { value: "inactive", label: "Inactive Users" },
];

const DEEP_LINKS = [
  { value: "home", label: "Open App Home" },
  { value: "wallet", label: "Open Wallet" },
  { value: "promos", label: "Open Promo Codes" },
  { value: "trips", label: "Open Trip History" },
  { value: "documents", label: "Open Driver Documents" },
  { value: "referral", label: "Open Referral Page" },
  { value: "support", label: "Open Support" },
  { value: "profile", label: "Open Profile" },
];

const PRIORITIES = [
  { value: "low", label: "Low", color: "bg-gray-100 text-gray-600" },
  { value: "normal", label: "Normal", color: "bg-blue-100 text-blue-700" },
  { value: "high", label: "High", color: "bg-amber-100 text-amber-700" },
  { value: "critical", label: "Critical", color: "bg-red-100 text-red-700" },
];

interface PushNotification {
  id: string; title: string; body: string; notification_type: string;
  recipient_group: string; target_country: string | null; target_city: string | null;
  target_area: string | null; image_url: string | null;
  priority: string; status: string; scheduled_at: string | null; sent_at: string | null;
  delivered_count: number; failed_count: number; opened_count: number; target_count: number;
  created_at: string; deep_link: string | null;
}

export default function NotificationsPage() {
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<PushNotification[]>([]);
  const [stats, setStats] = useState({ total: 0, delivered: 0, failed: 0, scheduled: 0 });

  // Form state
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [notifType, setNotifType] = useState("general");
  const [recipientGroup, setRecipientGroup] = useState("all");
  const [targetCountry, setTargetCountry] = useState("");
  const [targetCity, setTargetCity] = useState("");
  const [targetArea, setTargetArea] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [deepLink, setDeepLink] = useState("home");
  const [priority, setPriority] = useState("normal");
  const [sendMode, setSendMode] = useState<"now" | "later">("now");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [targetCount, setTargetCount] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from("push_notifications").select("*").order("created_at", { ascending: false }).limit(50);
      const all = (data || []) as PushNotification[];
      setNotifications(all);
      setStats({
        total: all.length,
        delivered: all.filter(n => n.status === "sent").length,
        failed: all.filter(n => n.status === "failed").length,
        scheduled: all.filter(n => n.status === "scheduled").length,
      });
    } catch { /* silent */ } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  // Check target count when recipient group changes
  useEffect(() => {
    const checkCount = async () => {
      if (!recipientGroup) return;
      try {
        const { data } = await supabase.rpc("get_notification_target_count", {
          p_recipient_group: recipientGroup,
          p_target_country: targetCountry || null,
          p_target_city: targetCity || null,
        });
        setTargetCount(data || 0);
      } catch { setTargetCount(0); }
    };
    checkCount();
  }, [recipientGroup, targetCountry, targetCity]);

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) { setFormError("Title and body are required"); return; }
    setFormError(null);

    const scheduledAt = sendMode === "later" && scheduledDate && scheduledTime
      ? new Date(`${scheduledDate}T${scheduledTime}`).toISOString()
      : null;

    const status = sendMode === "later" ? "scheduled" : "pending";

    const { data, error } = await supabase.from("push_notifications").insert({
      title, body, notification_type: notifType, recipient_group: recipientGroup,
      target_country: targetCountry || null, target_city: targetCity || null,
      target_area: targetArea || null, image_url: imageUrl || null,
      deep_link: deepLink, priority, status, scheduled_at: scheduledAt,
    }).select().single();

    if (error) { setFormError(error.message); return; }

    if (sendMode === "now") {
      // Trigger send via RPC
      await supabase.rpc("send_push_notification", { p_notification_id: (data as PushNotification).id });
      await supabase.rpc("complete_push_notification", {
        p_notification_id: (data as PushNotification).id,
        p_delivered: targetCount,
        p_failed: 0,
      });
    }

    // Reset form
    setTitle(""); setBody(""); setImageUrl(""); setTargetArea("");
    setShowConfirm(false);
    setSuccessMsg(sendMode === "later" ? "Notification scheduled!" : "Notification sent!");
    setTimeout(() => setSuccessMsg(null), 4000);
    fetchData();
  };

  const handleCancel = async (id: string) => {
    await supabase.rpc("cancel_push_notification", { p_notification_id: id });
    fetchData();
  };

  const handleDuplicate = (n: PushNotification) => {
    setTitle(n.title); setBody(n.body); setNotifType(n.notification_type);
    setRecipientGroup(n.recipient_group); setTargetCountry(n.target_country || "");
    setTargetCity(n.target_city || ""); setPriority(n.priority);
    setDeepLink(n.deep_link || "home"); setImageUrl(n.image_url || "");
  };

  const handleDelete = async (id: string) => {
    await supabase.from("push_notifications").delete().eq("id", id);
    fetchData();
  };

  const priorityColor = PRIORITIES.find(p => p.value === priority)?.color || "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Push Notifications & Announcements</h1>
          <p className="text-gray-500 mt-1">Send important alerts, promotions, safety updates, and system announcements to riders and drivers.</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"><RefreshCw className="h-4 w-4"/>Refresh</button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { l: "Total Sent", v: stats.total, c: "bg-blue-50 text-blue-600", icon: Bell },
          { l: "Delivered", v: stats.delivered, c: "bg-green-50 text-green-600", icon: CheckCircle },
          { l: "Failed", v: stats.failed, c: "bg-red-50 text-red-600", icon: XCircle },
          { l: "Scheduled", v: stats.scheduled, c: "bg-purple-50 text-purple-600", icon: Clock },
        ].map(s => (
          <div key={s.l} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
            <div className={`p-2 rounded-lg ${s.c}`}><s.icon className="h-5 w-5" /></div>
            <div><p className="text-xs text-gray-400">{s.l}</p><p className="text-xl font-bold">{formatNumber(s.v)}</p></div>
          </div>
        ))}
      </div>

      {/* Success message */}
      {successMsg && <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 flex items-center gap-2"><CheckCircle className="h-4 w-4"/>{successMsg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* FORM COLUMN */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Bell className="h-5 w-5 text-green-600"/> Create Notification</h2>

          {formError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{formError}</div>}

          {/* Type */}
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Notification Type</label>
            <select value={notifType} onChange={e => setNotifType(e.target.value)} className="w-full border rounded-lg px-3 py-2.5 text-sm">
              {NOTIFICATION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Recipients */}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Recipients</label>
              <select value={recipientGroup} onChange={e => setRecipientGroup(e.target.value)} className="w-full border rounded-lg px-3 py-2.5 text-sm">
                {RECIPIENT_GROUPS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} className="w-full border rounded-lg px-3 py-2.5 text-sm">
                {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          {/* Target Location */}
          {(recipientGroup === "city" || recipientGroup === "country") && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Country</label>
                <input type="text" value={targetCountry} onChange={e => setTargetCountry(e.target.value)} placeholder="e.g. Malawi" className="w-full border rounded-lg px-3 py-2.5 text-sm"/>
              </div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">City</label>
                <input type="text" value={targetCity} onChange={e => setTargetCity(e.target.value)} placeholder="e.g. Lilongwe" className="w-full border rounded-lg px-3 py-2.5 text-sm"/>
              </div>
            </div>
          )}
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Area / Zone (optional)</label>
            <input type="text" value={targetArea} onChange={e => setTargetArea(e.target.value)} placeholder="e.g. Area 25" className="w-full border rounded-lg px-3 py-2.5 text-sm"/>
          </div>

          {/* Content */}
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Title *</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Get 20% off your next ride" className="w-full border rounded-lg px-3 py-2.5 text-sm"/>
          </div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Body *</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} placeholder="e.g. Use code WELCOME20 today and save on your next WeAfrica Ride." className="w-full border rounded-lg px-3 py-2.5 text-sm"/>
          </div>

          {/* Image + Deep Link */}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Image URL (optional)</label>
              <input type="text" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://..." className="w-full border rounded-lg px-3 py-2.5 text-sm"/>
            </div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Tap Action</label>
              <select value={deepLink} onChange={e => setDeepLink(e.target.value)} className="w-full border rounded-lg px-3 py-2.5 text-sm">
                {DEEP_LINKS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>

          {/* Scheduling */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">When to send</label>
            <div className="flex gap-3">
              <label className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm cursor-pointer ${sendMode==="now"?"bg-green-50 border-green-300 text-green-700":"border-gray-200 text-gray-500"}`}>
                <input type="radio" checked={sendMode==="now"} onChange={()=>setSendMode("now")} className="sr-only"/>⚡ Send Now
              </label>
              <label className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm cursor-pointer ${sendMode==="later"?"bg-purple-50 border-purple-300 text-purple-700":"border-gray-200 text-gray-500"}`}>
                <input type="radio" checked={sendMode==="later"} onChange={()=>setSendMode("later")} className="sr-only"/>📅 Schedule
              </label>
            </div>
          </div>
          {sendMode === "later" && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Date</label><input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} className="w-full border rounded-lg px-3 py-2.5 text-sm"/></div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Time</label><input type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} className="w-full border rounded-lg px-3 py-2.5 text-sm"/></div>
            </div>
          )}

          {/* Send Button */}
          <div className="flex gap-2 pt-2">
            <button onClick={() => setShowConfirm(true)} disabled={!title.trim() || !body.trim() || submitting}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 text-sm font-semibold disabled:opacity-40">
              <Send className="h-4 w-4"/>{sendMode==="now"?"Send Notification":"Schedule Notification"}
            </button>
            <button onClick={()=>{setTitle("");setBody("");setImageUrl("");setFormError(null);}} className="px-4 py-3 border rounded-xl text-sm text-gray-600 hover:bg-gray-50">Clear</button>
          </div>
        </div>

        {/* PREVIEW COLUMN */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><Smartphone className="h-4 w-4 text-gray-400"/>Phone Preview</h3>
            <div className="bg-gray-900 rounded-3xl p-4 max-w-[240px] mx-auto">
              <div className="bg-gray-800 rounded-2xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-green-500 flex items-center justify-center"><span className="text-[8px] text-white font-bold">W</span></div>
                  <span className="text-[10px] text-gray-300 font-medium">WeAfrica Ride</span>
                  <span className="text-[9px] text-gray-500 ml-auto">now</span>
                </div>
                <p className="text-[11px] text-white font-semibold leading-tight">{title || "Notification Title"}</p>
                <p className="text-[10px] text-gray-400 leading-tight">{body || "Message body appears here..."}</p>
                {imageUrl && <div className="bg-gray-700 rounded-lg h-16 flex items-center justify-center"><ImageIcon className="h-4 w-4 text-gray-500"/></div>}
              </div>
              <div className="flex justify-center mt-2"><div className="w-20 h-1 bg-gray-700 rounded-full"/></div>
            </div>
            <div className="mt-3 space-y-1 text-xs text-gray-500">
              <div className="flex justify-between"><span>Target recipients</span><span className="font-semibold text-gray-700">{formatNumber(targetCount)}</span></div>
              <div className="flex justify-between"><span>Priority</span><span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${priorityColor}`}>{PRIORITIES.find(p=>p.value===priority)?.label}</span></div>
              <div className="flex justify-between"><span>Mode</span><span className="font-medium">{sendMode==="now"?"Send Now":"Scheduled"}</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-md mx-4 p-6 space-y-4">
            <div className="text-center">
              <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto"/>
              <h3 className="text-lg font-semibold mt-2">Confirm {sendMode==="now"?"Send":"Schedule"}</h3>
            </div>
            <p className="text-sm text-gray-600 text-center">
              {sendMode==="now"
                ? `You are about to send this notification to ${formatNumber(targetCount)} users.`
                : `This notification will be scheduled for ${scheduledDate} at ${scheduledTime}.`}
            </p>
            <div className="bg-gray-50 rounded-xl p-3 text-xs space-y-1">
              <p><span className="text-gray-400">Type:</span> {NOTIFICATION_TYPES.find(t=>t.value===notifType)?.label}</p>
              <p><span className="text-gray-400">Priority:</span> {PRIORITIES.find(p=>p.value===priority)?.label}</p>
              <p className="font-medium">{title}</p>
              <p className="text-gray-500">{body}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowConfirm(false)} className="flex-1 px-4 py-2.5 border rounded-xl text-sm">Cancel</button>
              <button onClick={()=>{setShowConfirm(false);handleSend();}} className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Notification History */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b bg-gray-50"><h2 className="text-lg font-semibold text-gray-900">Notification History</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 bg-gray-50 border-b">
              <th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Title</th><th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Recipients</th><th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Delivered</th><th className="px-4 py-3 font-medium text-right">Failed</th>
              <th className="px-4 py-3 font-medium text-right">Open Rate</th><th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr></thead>
            <tbody>
              {notifications.length === 0 ? (
                <tr><td colSpan={9} className="px-6 py-12 text-center text-gray-400">No notifications sent yet</td></tr>
              ) : notifications.map(n => {
                const openRate = n.delivered_count > 0 ? Math.round((n.opened_count / n.delivered_count) * 100) : 0;
                const nt = NOTIFICATION_TYPES.find(t=>t.value===n.notification_type);
                const rg = RECIPIENT_GROUPS.find(r=>r.value===n.recipient_group);
                return (
                  <tr key={n.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs text-gray-400">{timeAgo(n.created_at)}</td>
                    <td className="px-4 py-3 text-xs font-medium max-w-[180px] truncate">{n.title}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{nt?.label || n.notification_type}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{rg?.label || n.recipient_group}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-[10px] font-medium ${
                        n.status==="sent"?"bg-green-100 text-green-700":n.status==="scheduled"?"bg-purple-100 text-purple-700":n.status==="failed"?"bg-red-100 text-red-700":n.status==="cancelled"?"bg-gray-100 text-gray-500":"bg-amber-100 text-amber-700"
                      }`}>{n.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-right text-green-600">{formatNumber(n.delivered_count)}</td>
                    <td className="px-4 py-3 text-xs text-right text-red-500">{formatNumber(n.failed_count)}</td>
                    <td className="px-4 py-3 text-xs text-right">{openRate}%</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {(n.status==="scheduled"||n.status==="pending") && <button onClick={()=>handleCancel(n.id)} className="p-1 text-red-400 hover:text-red-600" title="Cancel"><XCircle className="h-3.5 w-3.5"/></button>}
                        <button onClick={()=>handleDuplicate(n)} className="p-1 text-gray-400 hover:text-gray-600" title="Duplicate"><Copy className="h-3.5 w-3.5"/></button>
                        <button onClick={()=>handleDelete(n.id)} className="p-1 text-gray-400 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5"/></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}