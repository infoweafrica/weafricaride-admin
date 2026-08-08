"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { fetchStaff, fetchRoles, suspendStaff, activateStaff, changeStaffRole, inviteStaffByEmail, roleLabel } from "@/lib/api/admin";
import { RefreshCw, UserPlus, ShieldOff, ShieldCheck, Mail, X, ChevronDown } from "lucide-react";
import type { AdminUser, AdminRole } from "@/lib/types";

export default function StaffManagementPage() {
  return (
    <PermissionGuard permission="manage_staff">
      <StaffContent />
    </PermissionGuard>
  );
}

function StaffContent() {
  const [staff, setStaff] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", full_name: "", role_id: "" });
  const [inviting, setInviting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchStaff(1, 100);
      if (result.error) throw new Error(result.error);
      setStaff(result.data || []);

      const roles = await fetchRoles();
      setRoles(roles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load staff");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSuspend = async (id: string) => {
    await suspendStaff(id);
    loadData();
  };

  const handleActivate = async (id: string) => {
    await activateStaff(id);
    loadData();
  };

  const handleRoleChange = async (id: string, newRole: string) => {
    await changeStaffRole(id, newRole);
    loadData();
  };

  const handleInvite = async () => {
    if (!inviteForm.email || !inviteForm.full_name || !inviteForm.role_id) return;
    setInviting(true);
    const result = await inviteStaffByEmail(inviteForm.email, inviteForm.full_name, inviteForm.role_id);
    alert(result.message);
    if (result.success) {
      setShowInvite(false);
      setInviteForm({ email: "", full_name: "", role_id: "" });
    }
    setInviting(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Management</h1>
          <p className="text-sm text-gray-500 mt-1">Manage admin users, roles, and permissions</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadData} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button onClick={() => setShowInvite(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
            <UserPlus className="h-4 w-4" /> Invite Staff
          </button>
        </div>
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Invite Staff Member</h3>
            <button onClick={() => setShowInvite(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input type="text" value={inviteForm.full_name} onChange={(e) => setInviteForm({ ...inviteForm, full_name: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select value={inviteForm.role_id} onChange={(e) => setInviteForm({ ...inviteForm, role_id: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none">
                <option value="">Select role...</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{roleLabel(r.name)}</option>)}
              </select>
            </div>
            <button onClick={handleInvite} disabled={inviting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50">
              <Mail className="h-4 w-4" /> {inviting ? "Sending..." : "Send Invitation"}
            </button>
          </div>
        </div>
      )}

      {/* Staff table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Role</th>
                <th className="text-center px-4 py-3 font-medium text-gray-700">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">City</th>
                <th className="text-center px-4 py-3 font-medium text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="p-6 text-center text-gray-400">Loading staff...</td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="p-6 text-center text-red-500">{error}</td></tr>
              ) : staff.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-gray-400">No staff members found</td></tr>
              ) : (
                staff.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{s.full_name || s.email}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{s.email}</td>
                    <td className="px-4 py-3">
                      <div className="relative">
                        <select
                          value={roles.find((r) => r.name === s.role_name)?.id || ""}
                          onChange={(e) => handleRoleChange(s.id, e.target.value)}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white appearance-none pr-6"
                        >
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>{roleLabel(r.name)}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${s.status === "active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{s.city || "All"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-center">
                        {s.status === "active" ? (
                          <button onClick={() => handleSuspend(s.id)} className="flex items-center gap-1 px-2 py-1 bg-red-50 text-red-600 rounded text-xs hover:bg-red-100">
                            <ShieldOff className="h-3 w-3" /> Suspend
                          </button>
                        ) : (
                          <button onClick={() => handleActivate(s.id)} className="flex items-center gap-1 px-2 py-1 bg-green-50 text-green-600 rounded text-xs hover:bg-green-100">
                            <ShieldCheck className="h-3 w-3" /> Activate
                          </button>
                        )}
                      </div>
                    </td>
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