"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  RefreshCw, UserPlus, ShieldOff, ShieldCheck, Mail, X, ChevronDown,
  Users, UserCheck, Clock, Ban, Search, Filter, Eye, Edit3, Trash2,
  Key, UserX, Building, MapPin, Activity, AlertTriangle,
} from "lucide-react";
import { formatNumber, timeAgo } from "@/lib/utils";

interface StaffMember {
  id: string; full_name: string; email: string; role_name: string;
  status: string; city: string | null; country_code: string | null;
  phone: string | null; avatar_url: string | null;
  last_sign_in: string | null; created_at: string; updated_at: string;
  created_by_name?: string; department_label?: string;
}

interface AdminRole {
  id: string; name: string; description: string | null; permissions: string[];
}

const ROLE_MAP: Record<string, { label: string; department: string; color: string }> = {
  superadmin: { label: "Superadmin", department: "Superadmin", color: "bg-purple-100 text-purple-700" },
  operations_manager: { label: "Operations Manager", department: "Operations", color: "bg-blue-100 text-blue-700" },
  dispatch_operator: { label: "Dispatch Operator", department: "Operations", color: "bg-cyan-100 text-cyan-700" },
  city_manager: { label: "City Manager", department: "Operations", color: "bg-teal-100 text-teal-700" },
  driver_onboarding: { label: "Driver Onboarding", department: "Drivers", color: "bg-indigo-100 text-indigo-700" },
  vehicle_inspector: { label: "Vehicle Inspector", department: "Drivers", color: "bg-lime-100 text-lime-700" },
  safety_officer: { label: "Safety Officer", department: "Safety", color: "bg-red-100 text-red-700" },
  incident_reviewer: { label: "Incident Reviewer", department: "Safety", color: "bg-orange-100 text-orange-700" },
  finance_manager: { label: "Finance Manager", department: "Finance", color: "bg-emerald-100 text-emerald-700" },
  accounts_officer: { label: "Accounts Officer", department: "Finance", color: "bg-green-100 text-green-700" },
  support_agent: { label: "Support Agent", department: "Support", color: "bg-sky-100 text-sky-700" },
  customer_success: { label: "Customer Success", department: "Support", color: "bg-blue-100 text-blue-600" },
  marketing_manager: { label: "Marketing Manager", department: "Marketing", color: "bg-pink-100 text-pink-700" },
  moderator: { label: "Moderator", department: "Marketing", color: "bg-rose-100 text-rose-700" },
  analyst: { label: "Analyst", department: "Analytics", color: "bg-gray-100 text-gray-700" },
  system_admin: { label: "System Admin", department: "Technical", color: "bg-violet-100 text-violet-700" },
};

const CITIES = ["All Cities","Blantyre","Lilongwe","Mzuzu","Zomba","Cape Town","Johannesburg","Lusaka","Harare","Nairobi","Dar es Salaam"];

export default function StaffManagementPage() {
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [filteredStaff, setFilteredStaff] = useState<StaffMember[]>([]);

  // Filters
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");

  // Stats
  const [stats, setStats] = useState({ total: 0, active: 0, pending: 0, suspended: 0 });

  // Invite modal
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ full_name: "", email: "", phone: "", role_name: "", city: "" });
  const [inviting, setInviting] = useState(false);

  // Detail panel
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("admin_users")
        .select("*")
        .order("created_at", { ascending: false });

      const all = ((data || []) as unknown as StaffMember[]).map((s) => ({
        ...s,
        department_label: ROLE_MAP[s.role_name as string]?.department || "Unknown",
        created_by_name: undefined,
      })) as StaffMember[];
      setStaff(all);

      setStats({
        total: all.length,
        active: all.filter(s => s.status === "active").length,
        pending: all.filter(s => s.status === "pending").length,
        suspended: all.filter(s => s.status === "suspended").length,
      });
    } catch { /* */ } finally { setLoading(false); }
  }, []);

  const fetchRoles = useCallback(async () => {
    try {
      const { data } = await supabase.from("admin_roles").select("*").order("name");
      setRoles((data || []) as AdminRole[]);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchStaff(); fetchRoles(); }, [fetchStaff, fetchRoles]);

  // Filter
  useEffect(() => {
    let result = [...staff];
    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(m => m.full_name?.toLowerCase().includes(s) || m.email?.toLowerCase().includes(s));
    }
    if (roleFilter !== "all") result = result.filter(m => m.role_name === roleFilter);
    if (statusFilter !== "all") result = result.filter(m => m.status === statusFilter);
    if (cityFilter !== "all") result = result.filter(m => (m.city || "All") === (cityFilter === "all" ? m.city : cityFilter));
    setFilteredStaff(result);
  }, [staff, search, roleFilter, statusFilter, cityFilter]);

  const handleSuspend = async (id: string) => {
    setActionLoading(id);
    await supabase.from("admin_users").update({ status: "suspended", updated_at: new Date().toISOString() }).eq("id", id);
    setActionLoading(null);
    fetchStaff();
  };

  const handleActivate = async (id: string) => {
    setActionLoading(id);
    await supabase.from("admin_users").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", id);
    setActionLoading(null);
    fetchStaff();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Permanently delete this staff member?")) return;
    setActionLoading(id);
    await supabase.from("admin_users").delete().eq("id", id);
    setActionLoading(null);
    setSelectedStaff(null);
    fetchStaff();
  };

  const handleRoleChange = async (id: string, newRole: string) => {
    await supabase.from("admin_users").update({ role_name: newRole, updated_at: new Date().toISOString() }).eq("id", id);
    fetchStaff();
  };

  const handleCityChange = async (id: string, city: string) => {
    await supabase.from("admin_users").update({ city: city === "all" ? null : city, updated_at: new Date().toISOString() }).eq("id", id);
    fetchStaff();
  };

  const handleInvite = async () => {
    if (!inviteForm.email || !inviteForm.full_name || !inviteForm.role_name) return;
    setInviting(true);
    try {
      // Insert staff record with pending status
      await supabase.from("admin_users").insert({
        full_name: inviteForm.full_name,
        email: inviteForm.email,
        phone: inviteForm.phone || null,
        role_name: inviteForm.role_name,
        city: inviteForm.city === "all" ? null : inviteForm.city,
        status: "pending",
      });
      setShowInvite(false);
      setInviteForm({ full_name: "", email: "", phone: "", role_name: "", city: "" });
      fetchStaff();
      // In production: send invite email via edge function
    } catch (err) {
      alert("Failed to invite: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setInviting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-gray-200 rounded w-48 animate-pulse"/>
        <div className="grid grid-cols-4 gap-4">
          {Array.from({length:4}).map((_,i)=><div key={i} className="h-[110px] bg-gray-100 rounded-2xl animate-pulse"/>)}
        </div>
        <div className="h-96 bg-gray-100 rounded-2xl animate-pulse"/>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── HEADER ─── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Management</h1>
          <p className="text-sm text-gray-500 mt-1">Manage admin users, roles, permissions, and access control across the platform.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchStaff} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50"><RefreshCw className="h-4 w-4"/> Refresh</button>
          <button onClick={() => setShowInvite(true)} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700"><UserPlus className="h-4 w-4"/> Invite Staff</button>
        </div>
      </div>

      {/* ─── STATS CARDS ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Staff", value: stats.total, icon: Users, color: "bg-blue-50 text-blue-600" },
          { label: "Active", value: stats.active, icon: UserCheck, color: "bg-green-50 text-green-600" },
          { label: "Pending Invites", value: stats.pending, icon: Clock, color: "bg-amber-50 text-amber-600" },
          { label: "Suspended", value: stats.suspended, icon: Ban, color: "bg-red-50 text-red-600" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-4" style={{minHeight:110}}>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${s.color}`}><s.icon className="h-6 w-6"/></div>
            <div><p className="text-2xl font-bold text-gray-900">{formatNumber(s.value)}</p><p className="text-xs text-gray-400">{s.label}</p></div>
          </div>
        ))}
      </div>

      {/* ─── FILTER BAR ─── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"/>
          <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name or email..." className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-xs"/>
        </div>
        <select value={roleFilter} onChange={e=>setRoleFilter(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-xs">
          <option value="all">All Roles</option>
          {roles.map(r=><option key={r.id} value={r.name}>{ROLE_MAP[r.name]?.label || r.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-xs">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="suspended">Suspended</option>
        </select>
        <select value={cityFilter} onChange={e=>setCityFilter(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-xs">
          {CITIES.map(c=><option key={c} value={c==="All Cities"?"all":c}>{c}</option>)}
        </select>
        {(search||roleFilter!=="all"||statusFilter!=="all"||cityFilter!=="all")&&(
          <button onClick={()=>{setSearch("");setRoleFilter("all");setStatusFilter("all");setCityFilter("all");}} className="flex items-center gap-1 px-3 py-2.5 text-xs text-red-600 hover:bg-red-50 rounded-xl"><X className="h-3 w-3"/> Clear</button>
        )}
      </div>

      {/* ─── STAFF TABLE ─── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200" style={{height:52}}>
                <th className="px-4 py-3 text-xs font-medium">Staff</th>
                <th className="px-4 py-3 text-xs font-medium">Role</th>
                <th className="px-4 py-3 text-xs font-medium">Department</th>
                <th className="px-4 py-3 text-xs font-medium">City Access</th>
                <th className="px-4 py-3 text-xs font-medium">Status</th>
                <th className="px-4 py-3 text-xs font-medium">Last Login</th>
                <th className="px-4 py-3 text-xs font-medium">Created</th>
                <th className="px-4 py-3 text-xs font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredStaff.length === 0 ? (
                <tr><td colSpan={8} className="py-16 text-center">
                  <Search className="h-10 w-10 mx-auto mb-3 opacity-20"/>
                  <p className="text-sm text-gray-500 font-medium">No staff members found</p>
                  <p className="text-xs text-gray-400 mt-1">Click "Invite Staff" to add your first admin user.</p>
                </td></tr>
              ) : filteredStaff.map(s => {
                const roleInfo = ROLE_MAP[s.role_name] || { label: s.role_name, department: "Unknown", color: "bg-gray-100 text-gray-600" };
                return (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={()=>setSelectedStaff(s)} style={{height:64}}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-xs font-bold text-green-700">
                          {s.avatar_url ? <img src={s.avatar_url} alt="" className="w-full h-full rounded-full object-cover"/> : (s.full_name || s.email).charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-gray-900">{s.full_name || "Unnamed"}</p>
                          <p className="text-[10px] text-gray-400">{s.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select value={s.role_name} onChange={e=>{e.stopPropagation();handleRoleChange(s.id,e.target.value);}} onClick={e=>e.stopPropagation()} className={`text-[10px] border rounded-lg px-2 py-1 font-medium ${roleInfo.color}`}>
                        {Object.entries(ROLE_MAP).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{roleInfo.department}</td>
                    <td className="px-4 py-3">
                      <select value={s.city || "all"} onChange={e=>{e.stopPropagation();handleCityChange(s.id,e.target.value);}} onClick={e=>e.stopPropagation()} className="text-[10px] border rounded-lg px-2 py-1 bg-white">
                        <option value="all">All Cities</option>
                        {CITIES.filter(c=>c!=="All Cities").map(c=><option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        s.status==="active"?"bg-green-100 text-green-700":s.status==="pending"?"bg-amber-100 text-amber-700":"bg-red-100 text-red-700"
                      }`}>{s.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{s.last_sign_in ? timeAgo(s.last_sign_in) : "Never"}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{new Date(s.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right" onClick={e=>e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {actionLoading===s.id ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-green-600 border-t-transparent"/> : <>
                          <button onClick={()=>setSelectedStaff(s)} className="p-1.5 hover:bg-blue-50 rounded-lg" title="View"><Eye className="h-3.5 w-3.5 text-blue-500"/></button>
                          <button className="p-1.5 hover:bg-amber-50 rounded-lg" title="Edit"><Edit3 className="h-3.5 w-3.5 text-amber-500"/></button>
                          {s.status==="active" ? (
                            <button onClick={()=>handleSuspend(s.id)} className="p-1.5 hover:bg-red-50 rounded-lg" title="Suspend"><ShieldOff className="h-3.5 w-3.5 text-red-500"/></button>
                          ) : (
                            <button onClick={()=>handleActivate(s.id)} className="p-1.5 hover:bg-green-50 rounded-lg" title="Activate"><ShieldCheck className="h-3.5 w-3.5 text-green-500"/></button>
                          )}
                          <button onClick={()=>handleDelete(s.id)} className="p-1.5 hover:bg-red-50 rounded-lg" title="Delete"><Trash2 className="h-3.5 w-3.5 text-red-400"/></button>
                        </>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── INVITE MODAL ─── */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={()=>setShowInvite(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg mx-4 p-6 space-y-5" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Invite Staff Member</h3>
              <button onClick={()=>setShowInvite(false)} className="p-1.5 hover:bg-gray-100 rounded-lg"><X className="h-5 w-5 text-gray-400"/></button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Full Name *</label>
                <input type="text" value={inviteForm.full_name} onChange={e=>setInviteForm({...inviteForm,full_name:e.target.value})} placeholder="e.g. Mary Phiri" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"/>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Email Address *</label>
                <input type="email" value={inviteForm.email} onChange={e=>setInviteForm({...inviteForm,email:e.target.value})} placeholder="mary@weafrica.mw" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"/>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
                <input type="text" value={inviteForm.phone} onChange={e=>setInviteForm({...inviteForm,phone:e.target.value})} placeholder="+265..." className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"/>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">City Access</label>
                <select value={inviteForm.city} onChange={e=>setInviteForm({...inviteForm,city:e.target.value})} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
                  <option value="all">All Cities</option>
                  {CITIES.filter(c=>c!=="All Cities").map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Role *</label>
                <select value={inviteForm.role_name} onChange={e=>setInviteForm({...inviteForm,role_name:e.target.value})} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Select role...</option>
                  {Object.entries(ROLE_MAP).map(([k,v])=><option key={k} value={k}>{v.label} — {v.department}</option>)}
                </select>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={()=>setShowInvite(false)} className="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleInvite} disabled={inviting||!inviteForm.email||!inviteForm.full_name||!inviteForm.role_name}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-40">
                <Mail className="h-4 w-4"/> {inviting ? "Sending..." : "Send Invitation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── DETAIL PANEL ─── */}
      {selectedStaff && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={()=>setSelectedStaff(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md mx-4 p-6 space-y-5" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Staff Details</h3>
              <button onClick={()=>setSelectedStaff(null)} className="p-1.5 hover:bg-gray-100 rounded-lg"><X className="h-5 w-5 text-gray-400"/></button>
            </div>

            {/* Avatar + Name */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center text-xl font-bold text-green-700">
                {(selectedStaff.full_name || selectedStaff.email).charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-900">{selectedStaff.full_name || "Unnamed"}</p>
                <p className="text-sm text-gray-500">{selectedStaff.email}</p>
              </div>
            </div>

            {/* Detail fields */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3 text-sm">
              {[
                { label: "Role", value: ROLE_MAP[selectedStaff.role_name]?.label || selectedStaff.role_name },
                { label: "Department", value: ROLE_MAP[selectedStaff.role_name]?.department || "—" },
                { label: "Status", value: selectedStaff.status },
                { label: "City Access", value: selectedStaff.city || "All Cities" },
                { label: "Phone", value: selectedStaff.phone || "—" },
                { label: "Last Login", value: selectedStaff.last_sign_in ? timeAgo(selectedStaff.last_sign_in) : "Never" },
                { label: "Created", value: new Date(selectedStaff.created_at).toLocaleDateString() },
              ].map(f => (
                <div key={f.label} className="flex justify-between">
                  <span className="text-gray-400 text-xs">{f.label}</span>
                  <span className="text-xs font-medium text-gray-700 text-right">{f.value}</span>
                </div>
              ))}
            </div>

            {/* Permissions */}
            <div>
              <p className="text-xs font-medium text-gray-400 mb-2">Role Permissions</p>
              <div className="flex flex-wrap gap-1">
                {(roles.find(r=>r.name===selectedStaff.role_name)?.permissions || []).map((p,i)=>
                  <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[10px] font-medium">{p}</span>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2 pt-2">
              {selectedStaff.status==="active" ? (
                <button onClick={()=>{handleSuspend(selectedStaff.id);setSelectedStaff(null);}} className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 text-red-700 rounded-xl text-xs font-semibold hover:bg-red-100">
                  <ShieldOff className="h-4 w-4"/> Suspend
                </button>
              ) : (
                <button onClick={()=>{handleActivate(selectedStaff.id);setSelectedStaff(null);}} className="flex items-center justify-center gap-2 px-4 py-2.5 bg-green-50 text-green-700 rounded-xl text-xs font-semibold hover:bg-green-100">
                  <ShieldCheck className="h-4 w-4"/> Activate
                </button>
              )}
              <button className="flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-50 text-amber-700 rounded-xl text-xs font-semibold hover:bg-amber-100">
                <Key className="h-4 w-4"/> Reset Password
              </button>
              <button onClick={()=>{handleDelete(selectedStaff.id);}} className="col-span-2 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 text-red-700 rounded-xl text-xs font-semibold hover:bg-red-100">
                <Trash2 className="h-4 w-4"/> Delete Staff
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}