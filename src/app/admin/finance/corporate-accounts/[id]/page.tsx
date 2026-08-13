"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import PermissionGuard from "@/components/guards/PermissionGuard";
import {
  fetchCorporateAccount,
  updateCorporateAccount,
  suspendCorporateAccount,
  activateCorporateAccount,
  topUpCorporateWallet,
  fetchCorporateMembers,
  inviteCorporateMember,
  updateCorporateMember,
  fetchCorporateInvoices,
  generateCorporateInvoice,
  corporateRoleLabel,
} from "@/lib/api/corporate";
import { ArrowLeft, ShieldOff, ShieldCheck, Wallet, UserPlus, X, Mail, FileText } from "lucide-react";
import type { CorporateAccount, CorporateAccountMember, CorporateInvitation, CorporateInvoice, CorporateMemberRole } from "@/lib/types";

function formatMwk(n: number) {
  return `MWK ${Math.round(n).toLocaleString()}`;
}

export default function CorporateAccountDetailPage() {
  const params = useParams();
  const id = params.id as string;
  return (
    <PermissionGuard permission="manage_finance">
      <CorporateAccountDetail id={id} />
    </PermissionGuard>
  );
}

function CorporateAccountDetail({ id }: { id: string }) {
  const [account, setAccount] = useState<CorporateAccount | null>(null);
  const [members, setMembers] = useState<CorporateAccountMember[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<CorporateInvitation[]>([]);
  const [invoices, setInvoices] = useState<CorporateInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState<{ email: string; role: CorporateMemberRole }>({ email: "", role: "employee" });
  const [inviting, setInviting] = useState(false);

  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpBusy, setTopUpBusy] = useState(false);

  const [invoicePeriod, setInvoicePeriod] = useState({ start: "", end: "" });
  const [generating, setGenerating] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const acc = await fetchCorporateAccount(id);
    setAccount(acc);
    const { members, pendingInvitations } = await fetchCorporateMembers(id);
    setMembers(members);
    setPendingInvitations(pendingInvitations);
    if (acc?.billing_method === "monthly_invoice") {
      setInvoices(await fetchCorporateInvoices(id));
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleInvite = async () => {
    if (!inviteForm.email) return;
    setInviting(true);
    const result = await inviteCorporateMember(id, inviteForm.email, inviteForm.role);
    alert(result.message + (result.invite_code ? `\n\nInvite code: ${result.invite_code}` : ""));
    if (result.success) {
      setShowInvite(false);
      setInviteForm({ email: "", role: "employee" });
      loadData();
    }
    setInviting(false);
  };

  const handleTopUp = async () => {
    const amount = Number(topUpAmount);
    if (!amount) return;
    setTopUpBusy(true);
    const ok = await topUpCorporateWallet(id, amount);
    if (ok) { setTopUpAmount(""); loadData(); } else { alert("Failed to update wallet balance"); }
    setTopUpBusy(false);
  };

  const handleGenerateInvoice = async () => {
    if (!invoicePeriod.start || !invoicePeriod.end) return;
    setGenerating(true);
    const result = await generateCorporateInvoice(id, invoicePeriod.start, invoicePeriod.end);
    if (result.success) {
      const emailNote = result.ride_count && result.ride_count > 0
        ? (result.email_sent ? " Emailed to finance." : ` Email not sent${result.email_error ? `: ${result.email_error}` : "."}`)
        : "";
      alert(`Invoice generated: ${result.ride_count} trips, ${formatMwk(result.total_amount || 0)}.${emailNote}`);
    } else {
      alert(result.message);
    }
    if (result.success) loadData();
    setGenerating(false);
  };

  if (loading && !account) {
    return <div className="p-6 text-center text-gray-400">Loading...</div>;
  }
  if (!account) {
    return <div className="p-6 text-center text-red-500">Corporate account not found</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/finance/corporate-accounts" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2">
          <ArrowLeft className="h-4 w-4" /> Corporate Accounts
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{account.name}</h1>
            <p className="text-sm text-gray-500 mt-1">{account.billing_email}</p>
          </div>
          {account.status === "active" ? (
            <button onClick={async () => { await suspendCorporateAccount(id); loadData(); }}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 text-sm">
              <ShieldOff className="h-4 w-4" /> Suspend Account
            </button>
          ) : (
            <button onClick={async () => { await activateCorporateAccount(id); loadData(); }}
              className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 text-sm">
              <ShieldCheck className="h-4 w-4" /> Activate Account
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm bg-white rounded-xl border border-gray-200 p-4">
        <div><span className="text-gray-500">Billing Method</span><div className="font-medium">{account.billing_method === "corporate_wallet" ? "Corporate Wallet" : "Monthly Invoice"}</div></div>
        <div><span className="text-gray-500">Daily Employee Limit</span><div className="font-medium">{account.daily_employee_limit ? formatMwk(account.daily_employee_limit) : "No limit"}</div></div>
        <div><span className="text-gray-500">Monthly Account Limit</span><div className="font-medium">{account.monthly_account_limit ? formatMwk(account.monthly_account_limit) : "No limit"}</div></div>
      </div>

      {account.billing_method === "corporate_wallet" && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Wallet className="h-4 w-4" /> Corporate Wallet</h3>
          <div className="text-2xl font-bold text-gray-900 mb-4">{formatMwk(account.wallet_balance)}</div>
          <div className="flex gap-2 max-w-sm">
            <input type="number" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} placeholder="Amount (MWK)"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none" />
            <button onClick={handleTopUp} disabled={topUpBusy}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50">
              {topUpBusy ? "..." : "Top Up"}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">Negative amounts deduct from the balance.</p>
        </div>
      )}

      {account.billing_method === "monthly_invoice" && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><FileText className="h-4 w-4" /> Invoices</h3>
          <div className="flex gap-2 items-end mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Period start</label>
              <input type="date" value={invoicePeriod.start} onChange={(e) => setInvoicePeriod({ ...invoicePeriod, start: e.target.value })}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Period end</label>
              <input type="date" value={invoicePeriod.end} onChange={(e) => setInvoicePeriod({ ...invoicePeriod, end: e.target.value })}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <button onClick={handleGenerateInvoice} disabled={generating}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50">
              {generating ? "Generating..." : "Generate Invoice"}
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-xs font-medium text-gray-500 uppercase">
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Emailed</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">No invoices yet</td></tr>
              ) : invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-3 py-2">{inv.period_start} — {inv.period_end}</td>
                  <td className="px-3 py-2">{inv.status}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {inv.sent_at ? `Sent to ${inv.sent_to} on ${new Date(inv.sent_at).toLocaleDateString()}` : "Not sent"}
                  </td>
                  <td className="px-3 py-2 text-right">{formatMwk(inv.total_amount)}</td>
                  <td className="px-3 py-2 text-right">
                    <a
                      href={`/api/admin/corporate/${id}/invoices/${inv.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-600 hover:underline text-xs font-medium"
                    >
                      Download PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Employees</h3>
          <button onClick={() => setShowInvite(true)} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-xs">
            <UserPlus className="h-3.5 w-3.5" /> Invite Employee
          </button>
        </div>

        {showInvite && (
          <div className="border border-gray-200 rounded-lg p-4 mb-4 max-w-md">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-900">Invite Employee</span>
              <button onClick={() => setShowInvite(false)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <input type="email" placeholder="Email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value as CorporateMemberRole })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="employee">Employee</option>
                <option value="finance">Finance</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
              <button onClick={handleInvite} disabled={inviting}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50">
                <Mail className="h-4 w-4" /> {inviting ? "Sending..." : "Send Invitation"}
              </button>
            </div>
          </div>
        )}

        {pendingInvitations.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-medium text-gray-500 uppercase mb-2">Pending Invitations</p>
            <div className="space-y-1">
              {pendingInvitations.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between text-sm bg-amber-50 rounded-lg px-3 py-2">
                  <span>{inv.email} · {corporateRoleLabel(inv.role)}</span>
                  <span className="font-mono text-xs text-amber-700">{inv.invite_code}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-xs font-medium text-gray-500 uppercase">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Contact</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {members.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">No employees yet</td></tr>
            ) : members.map((m) => (
              <tr key={m.id}>
                <td className="px-3 py-2">{m.rider?.full_name || m.rider?.phone || m.rider_id}</td>
                <td className="px-3 py-2 text-gray-500 text-xs">{m.rider?.phone || m.rider?.email || "—"}</td>
                <td className="px-3 py-2">
                  <select value={m.role} onChange={async (e) => { await updateCorporateMember(id, m.id, { role: e.target.value }); loadData(); }}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white">
                    <option value="employee">Employee</option>
                    <option value="finance">Finance</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${m.status === "active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                    {m.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {m.status === "active" ? (
                    <button onClick={async () => { await updateCorporateMember(id, m.id, { status: "suspended" }); loadData(); }}
                      className="text-xs text-red-600 hover:underline">Suspend</button>
                  ) : (
                    <button onClick={async () => { await updateCorporateMember(id, m.id, { status: "active" }); loadData(); }}
                      className="text-xs text-green-600 hover:underline">Activate</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
