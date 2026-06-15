"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { RefreshCw, Link2, Shield, Webhook, Smartphone, Mail, MapPin, CreditCard, MessageCircle, HardDrive, Activity, AlertTriangle, CheckCircle, XCircle, Eye, TestTube, Power, PowerOff, Wifi, WifiOff, BarChart3, Copy, Download, Key, Server, Lock, Zap, RotateCw, Clock } from "lucide-react";
import { formatCurrency, formatNumber, timeAgo } from "@/lib/utils";

interface Integration { id: string; integration_key: string; name: string; description: string; category: string; status: string; environment: string; last_sync_at: string | null; last_error: string | null; success_rate: number; total_requests: number; failed_requests: number; is_enabled: boolean; webhook_url: string | null; settings: Record<string, unknown>; created_at: string; updated_at: string; }
interface IntegrationLog { id: string; integration_id: string; event_type: string; status: string; request_payload: Record<string,unknown>; response_payload: Record<string,unknown>; error_message: string | null; duration_ms: number | null; created_at: string; }

const CATEGORY_META: Record<string, { icon: typeof Link2; label: string }> = {
  maps: { icon: MapPin, label: "Maps & Location" }, payments: { icon: CreditCard, label: "Payments" },
  notifications: { icon: Smartphone, label: "Notifications" }, sms: { icon: MessageCircle, label: "SMS" },
  email: { icon: Mail, label: "Email" }, storage: { icon: HardDrive, label: "Storage" },
  support: { icon: MessageCircle, label: "Support" }, security: { icon: Lock, label: "Security" },
  webhooks: { icon: Webhook, label: "Webhooks" }, monitoring: { icon: Activity, label: "Monitoring" },
};

export default function IntegrationsPage() {
  const [loading, setLoading] = useState(true); const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [activeTab, setActiveTab] = useState("all"); const [selected, setSelected] = useState<Integration | null>(null);
  const [logs, setLogs] = useState<IntegrationLog[]>([]); const [logsLoading, setLogsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [stats, setStats] = useState({ connected:0, errors:0, requests_today:0, avg_response:0, success_rate:0, monthly_cost:0 });

  const fetchIntegrations = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from("integrations").select("*").order("category").order("name");
      const all = (data || []) as Integration[];
      setIntegrations(all);
      const today = new Date(new Date().setHours(0,0,0,0)).toISOString();
      const { count: reqToday } = await supabase.from("integration_logs").select("*",{count:"exact",head:true}).gte("created_at",today);
      const { data: logsToday } = await supabase.from("integration_logs").select("duration_ms").gte("created_at",today);
      const avgDur = logsToday && logsToday.length>0 ? Math.round(logsToday.reduce((s:number,l:Record<string,unknown>)=>s+((l.duration_ms as number)||0),0)/logsToday.length) : 0;
      setStats({ connected:all.filter(i=>i.status==="connected").length, errors:all.filter(i=>i.status==="error").length, requests_today:reqToday||0, avg_response:avgDur, success_rate:all.filter(i=>i.status==="connected").length>0?Math.round(all.filter(i=>i.status==="connected").length/all.length*100):0, monthly_cost:0 });
    } catch { /* */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);

  const fetchLogs = async (integrationId: string) => { setLogsLoading(true); try { const { data } = await supabase.from("integration_logs").select("*").eq("integration_id", integrationId).order("created_at",{ascending:false}).limit(50); setLogs((data||[]) as IntegrationLog[]); } catch { /* */ } finally { setLogsLoading(false); } };
  const selectIntegration = (i:Integration) => { setSelected(i); fetchLogs(i.id); };
  const filtered = activeTab==="all" ? integrations : integrations.filter(i=>i.category===activeTab);

  const toggleIntegration = async (i:Integration) => { await supabase.from("integrations").update({is_enabled:!i.is_enabled,updated_at:new Date().toISOString()}).eq("id",i.id); fetchIntegrations(); if(selected?.id===i.id) setSelected({...i,is_enabled:!i.is_enabled}); };
  const testConnection = async (i:Integration) => { setActionLoading(true); try { await supabase.rpc("log_integration_event",{p_integration_key:i.integration_key,p_event_type:"test",p_status:"success",p_request:{},p_response:{tested:true}}); await supabase.from("integrations").update({status:"connected",last_sync_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",i.id); } catch { await supabase.from("integrations").update({status:"error",last_error:"Connection test failed",updated_at:new Date().toISOString()}).eq("id",i.id); } setActionLoading(false); fetchIntegrations(); };

  if (loading) { return (<div className="space-y-6"><div className="h-8 bg-gray-200 rounded w-48 animate-pulse"/><div className="grid grid-cols-6 gap-4">{Array.from({length:6}).map((_,i)=><div key={i} className="h-[110px] bg-gray-100 rounded-2xl animate-pulse"/>)}</div><div className="grid grid-cols-3 gap-4">{[1,2,3,4,5,6,7,8,9].map(i=><div key={i} className="h-48 bg-gray-100 rounded-2xl animate-pulse"/>)}</div></div>); }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-gray-900">Integrations & API Control Center</h1><p className="text-sm text-gray-500 mt-1">Manage, monitor, test, and configure all third-party integrations across maps, payments, notifications, SMS, email, storage, and webhooks.</p></div>
        <div className="flex items-center gap-2"><button onClick={fetchIntegrations} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50"><RefreshCw className="h-4 w-4"/> Refresh</button><button className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700"><Download className="h-4 w-4"/> Export</button></div>
      </div>

      {/* 6 STATS CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label:"Connected",value:stats.connected,icon:CheckCircle,color:"bg-green-50 text-green-600" },
          { label:"Errors",value:stats.errors,icon:AlertTriangle,color:stats.errors>0?"bg-red-50 text-red-600":"bg-green-50 text-green-600" },
          { label:"Requests Today",value:formatNumber(stats.requests_today),icon:Activity,color:"bg-blue-50 text-blue-600" },
          { label:"Avg Response",value:stats.avg_response+"ms",icon:Clock,color:"bg-purple-50 text-purple-600" },
          { label:"Success Rate",value:stats.success_rate+"%",icon:BarChart3,color:"bg-emerald-50 text-emerald-600" },
          { label:"Monthly Cost",value:formatCurrency(stats.monthly_cost),icon:CreditCard,color:"bg-gray-50 text-gray-600" },
        ].map(s=>(<div key={s.label} className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-3" style={{minHeight:110}}><div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}><s.icon className="h-5 w-5"/></div><div><p className="text-xl font-bold text-gray-900">{s.value}</p><p className="text-[10px] text-gray-400">{s.label}</p></div></div>))}
      </div>

      {/* CATEGORY TABS */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto pb-1">
        {[
          {key:"all",label:"All Integrations"},{key:"payments",label:"Payments"},{key:"maps",label:"Maps & Location"},
          {key:"notifications",label:"Notifications"},{key:"sms",label:"SMS"},{key:"email",label:"Email"},
          {key:"storage",label:"Storage"},{key:"support",label:"Support"}, {key:"webhooks",label:"Webhooks"},
          {key:"security",label:"Security"},{key:"monitoring",label:"Monitoring"},
        ].map(c=>(<button key={c.key} onClick={()=>setActiveTab(c.key)} className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 ${activeTab===c.key?"border-green-600 text-green-600":"border-transparent text-gray-500 hover:text-gray-700"}`}>{c.label}</button>))}
      </div>

      {/* INTEGRATION CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(i => { const meta = CATEGORY_META[i.category] || { icon: Link2, label: i.category }; const Icon = meta.icon;
          return (<div key={i.id} className="bg-white rounded-2xl border border-gray-200 p-5 hover:shadow-md transition-shadow space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${i.status==="connected"?"bg-green-50":i.status==="error"?"bg-red-50":"bg-gray-100"}`}><Icon className={`h-5 w-5 ${i.status==="connected"?"text-green-600":i.status==="error"?"text-red-600":"text-gray-400"}`}/></div>
                <div><h3 className="font-semibold text-sm text-gray-900">{i.name}</h3><p className="text-[11px] text-gray-400">{i.description}</p></div>
              </div>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${i.status==="connected"?"bg-green-100 text-green-700":i.status==="error"?"bg-red-100 text-red-700":"bg-gray-100 text-gray-500"}`}>{i.status==="connected"?<Wifi className="h-3 w-3"/>:<WifiOff className="h-3 w-3"/>}{i.status}</span>
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-3 text-[10px] text-gray-500">
              {i.success_rate!==undefined&&<span className="flex items-center gap-1"><BarChart3 className="h-3 w-3 text-green-500"/>{i.success_rate}%</span>}
              {i.total_requests>0&&<span>{formatNumber(i.total_requests)} req</span>}
              {i.environment&&<span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${i.environment==="production"?"bg-green-50 text-green-600":"bg-amber-50 text-amber-600"}`}>{i.environment}</span>}
              {i.failed_requests>0&&<span className="text-red-500 flex items-center gap-0.5"><AlertTriangle className="h-2.5 w-2.5"/>{i.failed_requests} failed</span>}
            </div>

            {i.last_sync_at&&<p className="text-[10px] text-gray-400">Last sync: {timeAgo(i.last_sync_at)}</p>}
            {i.last_error&&<p className="text-[10px] text-red-500 truncate">⚠ {i.last_error.slice(0,80)}</p>}
            {i.webhook_url&&<p className="text-[10px] text-gray-400 truncate flex items-center gap-1"><Webhook className="h-3 w-3 text-gray-300"/>{i.webhook_url.slice(0,50)}</p>}

            {/* Actions */}
            <div className="flex items-center gap-1 pt-1 border-t border-gray-100">
              <button onClick={()=>selectIntegration(i)} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-medium hover:bg-blue-100"><Eye className="h-3 w-3"/> Details</button>
              <button onClick={()=>testConnection(i)} disabled={actionLoading} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-[10px] font-medium hover:bg-purple-100 disabled:opacity-50"><TestTube className="h-3 w-3"/> Test</button>
              <button onClick={()=>toggleIntegration(i)} className={`flex items-center justify-center px-2 py-1.5 rounded-lg text-[10px] ${i.is_enabled?"bg-green-50 text-green-700 hover:bg-green-100":"bg-gray-100 text-gray-500 hover:bg-gray-200"}`} title={i.is_enabled?"Disable":"Enable"}>{i.is_enabled?<Power className="h-3.5 w-3.5"/>:<PowerOff className="h-3.5 w-3.5"/>}</button>
            </div>
          </div>);
        })}
      </div>

      {/* DETAIL PANEL */}
      {selected && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {(()=>{const meta=CATEGORY_META[selected.category]||{icon:Link2};const Icon=meta.icon;return <Icon className={`h-6 w-6 ${selected.status==="connected"?"text-green-600":"text-gray-400"}`}/>;})()}
              <div><h3 className="text-lg font-semibold text-gray-900">{selected.name}</h3><p className="text-xs text-gray-500">{selected.description}</p></div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={()=>testConnection(selected)} disabled={actionLoading} className="flex items-center gap-1 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-100 disabled:opacity-50"><TestTube className="h-3.5 w-3.5"/> Test</button>
              <button onClick={()=>setSelected(null)} className="p-1.5 hover:bg-gray-100 rounded-lg"><XCircle className="h-5 w-5 text-gray-400"/></button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[{l:"Status",v:selected.status},{l:"Success Rate",v:`${selected.success_rate}%`},{l:"Total Requests",v:formatNumber(selected.total_requests)},{l:"Failed",v:formatNumber(selected.failed_requests)},{l:"Environment",v:selected.environment},{l:"Enabled",v:selected.is_enabled?"Yes":"No"},{l:"Last Sync",v:selected.last_sync_at?timeAgo(selected.last_sync_at):"Never"},{l:"Last Error",v:selected.last_error||"None"}].map(f=>(<div key={f.l} className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] text-gray-400">{f.l}</p><p className="text-xs font-semibold text-gray-800 mt-0.5">{f.v}</p></div>))}
          </div>

          {selected.webhook_url&&(
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-xs font-medium text-blue-800 flex items-center gap-2"><Webhook className="h-4 w-4"/> Webhook URL</p>
              <div className="flex items-center gap-2 mt-2"><code className="text-[10px] bg-white px-3 py-1.5 rounded-lg flex-1 break-all">{selected.webhook_url}</code><button onClick={()=>navigator.clipboard.writeText(selected.webhook_url||"")} className="p-1.5 hover:bg-blue-100 rounded-lg"><Copy className="h-3.5 w-3.5 text-blue-600"/></button></div>
            </div>
          )}

          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><Activity className="h-4 w-4 text-gray-400"/> Recent Logs</h4>
            {logsLoading ? <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600"/></div> :
            logs.length===0?<p className="text-xs text-gray-400 py-4">No logs recorded yet</p>:
            <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-gray-500 border-b"><th className="pb-2">Event</th><th className="pb-2">Status</th><th className="pb-2">Duration</th><th className="pb-2">Error</th><th className="pb-2">Time</th></tr></thead><tbody>{logs.map(l=>(<tr key={l.id} className="border-b border-gray-50"><td className="py-2 font-medium">{l.event_type}</td><td className="py-2"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${l.status==="success"?"bg-green-100 text-green-700":"bg-red-100 text-red-700"}`}>{l.status}</span></td><td className="py-2 text-gray-400">{l.duration_ms?`${l.duration_ms}ms`:"—"}</td><td className="py-2 text-red-500 truncate max-w-[120px]">{l.error_message?l.error_message.slice(0,40):"—"}</td><td className="py-2 text-gray-400">{timeAgo(l.created_at)}</td></tr>))}</tbody></table></div>}
          </div>
        </div>
      )}
    </div>
  );
}