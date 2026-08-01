"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { ErrorBoundary, ApiErrorDisplay, EmptyState } from "@/components/ErrorBoundary";
import Pagination from "@/components/Pagination";
import {
  Search, Eye, Ban, CheckCircle, X, Mail, Phone, Shield,
  Users as UsersIcon, Wallet, Star, TrendingUp, UserPlus,
  BadgeCheck, Ticket, ChartBar, Activity, MapPin, CreditCard,
  Trash2, RefreshCw,
} from "lucide-react";
import { formatCurrency, timeAgo } from "@/lib/utils";
import {
  fetchRiders, fetchRiderStats, suspendRider, activateRider,
  deleteRider, verifyRiderPhone, verifyRiderEmail, verifyRiderId,
} from "@/lib/api/riders";
import type { Rider } from "@/lib/types";

type RiderTab = "overview" | "all" | "active" | "suspended" | "wallets" | "verification" | "support" | "analytics";

export default function RidersPage() {
  return <ErrorBoundary><RidersContent /></ErrorBoundary>;
}

function RidersContent() {
  const [activeTab, setActiveTab] = useState<RiderTab>("overview");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [riders, setRiders] = useState<Rider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [stats, setStats] = useState({ total: 0, active: 0, suspended: 0, verified: 0, newThisWeek: 0 });

  const [selectedRider, setSelectedRider] = useState<Rider | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsResult, ridersResult] = await Promise.all([
        fetchRiderStats(),
        fetchRiders(page, pageSize, search, statusFilter),
      ]);
      setStats(statsResult);
      if (ridersResult.error) {
        setError(ridersResult.error);
        setRiders([]);
        setTotalCount(0);
      } else {
        setRiders(ridersResult.data);
        setTotalCount(ridersResult.totalCount);
        setTotalPages(Math.ceil(ridersResult.totalCount / pageSize));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load riders");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, statusFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSuspend = async (id: string) => {
    setActionLoading(id);
    if (await suspendRider(id)) loadData();
    setActionLoading(null);
  };
  const handleActivate = async (id: string) => {
    setActionLoading(id);
    if (await activateRider(id)) loadData();
    setActionLoading(null);
  };
  const handleDelete = async (id: string) => {
    setActionLoading(id);
    if (await deleteRider(id)) {
      loadData();
      setShowDelete(false);
      setSelectedRider(null);
    }
    setActionLoading(null);
  };
  const handleVerifyPhone = async (id: string) => {
    setActionLoading(id);
    if (await verifyRiderPhone(id)) loadData();
    setActionLoading(null);
  };
  const handleVerifyEmail = async (id: string) => {
    setActionLoading(id);
    if (await verifyRiderEmail(id)) loadData();
    setActionLoading(null);
  };
  const handleVerifyId = async (id: string) => {
    setActionLoading(id);
    if (await verifyRiderId(id)) loadData();
    setActionLoading(null);
  };

  const filteredRiders = statusFilter === "active"
    ? riders.filter(r => r.status === "active")
    : statusFilter === "suspended"
      ? riders.filter(r => r.status === "suspended")
      : riders;

  const tabs: { id: RiderTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "overview", label: "Overview", icon: ChartBar },
    { id: "all", label: "All Riders", icon: UsersIcon },
    { id: "active", label: "Active Riders", icon: CheckCircle },
    { id: "suspended", label: "Suspended Riders", icon: Ban },
    { id: "wallets", label: "Wallets", icon: Wallet },
    { id: "verification", label: "Verification", icon: BadgeCheck },
    { id: "support", label: "Support", icon: Ticket },
    { id: "analytics", label: "Analytics", icon: TrendingUp },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Riders</h1>
          <p className="text-gray-500 mt-1">{stats.total} riders — passenger management</p>
        </div>
      </div>
      <ApiErrorDisplay error={error} onRetry={loadData} />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { setActiveTab(id); setPage(1); }}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === id ? "border-green-600 text-green-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* ===== OVERVIEW ===== */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <RiderStatBox icon={UsersIcon} label="Total Riders" value={stats.total} color="text-blue-600" bg="bg-blue-50" />
            <RiderStatBox icon={CheckCircle} label="Active" value={stats.active} color="text-green-600" bg="bg-green-50" />
            <RiderStatBox icon={Ban} label="Suspended" value={stats.suspended} color="text-amber-600" bg="bg-amber-50" />
            <RiderStatBox icon={BadgeCheck} label="Verified" value={stats.verified} color="text-purple-600" bg="bg-purple-50" />
            <RiderStatBox icon={UserPlus} label="New This Week" value={stats.newThisWeek} color="text-cyan-600" bg="bg-cyan-50" />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
            <Activity className="h-10 w-10 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500 font-medium">Rider Analytics</p>
            <p className="text-sm text-gray-400 mt-1">Visit the <span className="font-medium">Analytics</span> tab for growth and retention metrics</p>
          </div>
        </div>
      )}

      {/* ===== ALL RIDERS ===== */}
      {(activeTab === "all" || activeTab === "active" || activeTab === "suspended") && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by name, phone, email..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Phone</th>
                      <th className="px-4 py-3 font-medium">Email</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Total Trips</th>
                      <th className="px-4 py-3 font-medium text-right">Rating</th>
                      <th className="px-4 py-3 font-medium">Joined</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeTab === "all" ? filteredRiders : riders.filter(r => activeTab === "active" ? r.status === "active" : r.status === "suspended")).map((rider) => (
                      <tr key={rider.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-medium text-xs">
                              {(rider.full_name || "R").charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900 text-xs">{rider.full_name || "Unknown"}</p>
                              <p className="text-xs text-gray-400">ID: {rider.id?.slice(0, 8)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{rider.phone || (rider.user as Record<string, unknown>)?.phone as string || "—"}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{rider.email || (rider.user as Record<string, unknown>)?.email as string || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${rider.status === "active" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                            {rider.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-medium">{rider.total_rides ?? 0}</td>
                        <td className="px-4 py-3 text-right text-xs">
                          <span className="flex items-center justify-end gap-1">
                            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                            {rider.rating?.toFixed(1) ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{timeAgo(rider.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => { setSelectedRider(rider); setShowDetail(true); }} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500" title="View"><Eye className="h-4 w-4" /></button>
                            {rider.status === "active" ? (
                              <button onClick={() => handleSuspend(rider.id)} disabled={actionLoading === rider.id} className="p-1.5 hover:bg-red-50 rounded-lg text-red-600" title="Suspend"><Ban className="h-4 w-4" /></button>
                            ) : (
                              <button onClick={() => handleActivate(rider.id)} disabled={actionLoading === rider.id} className="p-1.5 hover:bg-green-50 rounded-lg text-green-600" title="Activate"><CheckCircle className="h-4 w-4" /></button>
                            )}
                            <button onClick={() => { setSelectedRider(rider); setShowDelete(true); }} className="p-1.5 hover:bg-red-50 rounded-lg text-red-500" title="Delete"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredRiders.length === 0 && (
                      <tr><td colSpan={8} className="px-6 py-12"><EmptyState icon={UsersIcon} title="No riders found" description={statusFilter === "all" ? "Riders will appear here once they register" : `No ${statusFilter} riders found`} /></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(ps) => { setPageSize(ps); setPage(1); }} />
          </div>
        </>
      )}

      {/* ===== WALLETS ===== */}
      {activeTab === "wallets" && (
        <RiderWalletsTab />
      )}

      {/* ===== VERIFICATION ===== */}
      {activeTab === "verification" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 bg-gray-50 border-b">
                  <th className="px-4 py-3 font-medium">Rider</th>
                  <th className="px-4 py-3 font-medium">Phone Verified</th>
                  <th className="px-4 py-3 font-medium">Email Verified</th>
                  <th className="px-4 py-3 font-medium">ID Verified</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {riders.slice(0, 20).map((rider) => (
                  <tr key={rider.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-medium text-xs">
                          {(rider.full_name || "R").charAt(0).toUpperCase()}
                        </div>
                        <span className="text-xs font-medium">{rider.full_name || "Unknown"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${rider.is_phone_verified ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                        {rider.is_phone_verified ? "Verified" : "Not Verified"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${rider.is_email_verified ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                        {rider.is_email_verified ? "Verified" : "Not Verified"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${rider.is_id_verified ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                        {rider.is_id_verified ? "Verified" : "Not Verified"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!rider.is_phone_verified && (
                          <button onClick={() => handleVerifyPhone(rider.id)} disabled={actionLoading === rider.id} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">Verify Phone</button>
                        )}
                        {!rider.is_email_verified && (
                          <button onClick={() => handleVerifyEmail(rider.id)} disabled={actionLoading === rider.id} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Verify Email</button>
                        )}
                        {!rider.is_id_verified && (
                          <button onClick={() => handleVerifyId(rider.id)} disabled={actionLoading === rider.id} className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200">Verify ID</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {riders.length === 0 && (
                  <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400">No riders to verify</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== SUPPORT ===== */}
      {activeTab === "support" && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <Ticket className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Rider Support</p>
          <p className="text-sm text-gray-400 mt-1">Support tickets and complaints — coming soon</p>
        </div>
      )}

      {/* ===== ANALYTICS ===== */}
      {activeTab === "analytics" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-400">Most Active</p><p className="text-lg font-bold text-blue-600 mt-1">Coming soon</p></div>
            <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-400">Highest Spenders</p><p className="text-lg font-bold text-green-600 mt-1">Coming soon</p></div>
            <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-400">Rider Growth</p><p className="text-lg font-bold text-purple-600 mt-1">Coming soon</p></div>
            <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-400">Retention Rate</p><p className="text-lg font-bold text-amber-600 mt-1">Coming soon</p></div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <TrendingUp className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Rider Analytics</p>
            <p className="text-sm text-gray-400 mt-1">Detailed analytics — coming soon</p>
          </div>
        </div>
      )}

      {/* ===== RIDER DETAIL MODAL ===== */}
      {showDetail && selectedRider && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 bg-emerald-600 rounded-full flex items-center justify-center text-white text-lg font-medium">
                  {(selectedRider.full_name || "R").charAt(0).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-lg font-semibold">{selectedRider.full_name || "Unknown"}</h2>
                  <p className="text-xs text-gray-500">ID: {selectedRider.id?.slice(0, 8)}</p>
                </div>
              </div>
              <button onClick={() => setShowDetail(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-xs font-semibold mb-2 text-gray-500">Personal Info</h4>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs"><span className="text-gray-400">Phone</span><span className="font-medium">{selectedRider.phone || (selectedRider.user as Record<string, unknown>)?.phone as string || "—"}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-gray-400">Email</span><span className="font-medium">{selectedRider.email || (selectedRider.user as Record<string, unknown>)?.email as string || "—"}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-gray-400">Status</span><span className={`font-medium ${selectedRider.status === "active" ? "text-green-600" : "text-red-600"}`}>{selectedRider.status}</span></div>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-xs font-semibold mb-2 text-gray-500">Trip Stats</h4>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs"><span className="text-gray-400">Total Trips</span><span className="font-medium">{selectedRider.total_rides ?? 0}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-gray-400">Total Spent</span><span className="font-medium">{formatCurrency(selectedRider.total_spent ?? 0)}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-gray-400">Rating</span><span className="font-medium flex items-center gap-1"><Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />{selectedRider.rating?.toFixed(1) ?? "—"}</span></div>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-xs font-semibold mb-2 text-gray-500">Verification</h4>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs"><span className="text-gray-400">Phone</span><span>{selectedRider.is_phone_verified ? "✅" : "❌"}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-gray-400">Email</span><span>{selectedRider.is_email_verified ? "✅" : "❌"}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-gray-400">Identity</span><span>{selectedRider.is_id_verified ? "✅" : "❌"}</span></div>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-xs font-semibold mb-2 text-gray-500">Locations</h4>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-1 text-gray-500"><MapPin className="h-3 w-3" />{selectedRider.home_address || "No home address"}</div>
                    <div className="flex items-center gap-1 text-gray-500"><MapPin className="h-3 w-3" />{selectedRider.work_address || "No work address"}</div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 pt-4 border-t">
                {selectedRider.status === "active" ? (
                  <button onClick={() => { handleSuspend(selectedRider.id); setShowDetail(false); }} disabled={actionLoading === selectedRider.id} className="flex-1 px-4 py-2 bg-red-50 hover:bg-red-100 rounded-lg text-sm font-medium text-red-700">Suspend Rider</button>
                ) : (
                  <button onClick={() => { handleActivate(selectedRider.id); setShowDetail(false); }} disabled={actionLoading === selectedRider.id} className="flex-1 px-4 py-2 bg-green-50 hover:bg-green-100 rounded-lg text-sm font-medium text-green-700">Activate Rider</button>
                )}
                <button onClick={() => { setShowDetail(false); setShowDelete(true); }} className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700">Delete Rider</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDelete && selectedRider && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-red-600 flex items-center gap-2"><Trash2 className="h-5 w-5" /> Delete Rider</h2>
            <p className="text-sm text-gray-600">Permanently delete <strong>{selectedRider.full_name || "this rider"}</strong>? This action cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowDelete(false)} className="flex-1 px-4 py-2 border rounded-lg text-sm font-medium">Cancel</button>
              <button onClick={() => handleDelete(selectedRider.id)} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RiderWalletsTab() {
  const [wallets, setWallets] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedWallet, setSelectedWallet] = useState<Record<string, unknown> | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [transactions, setTransactions] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const { data } = await supabase.from("wallets").select("*, user:users(full_name, phone, email)").order("created_at", { ascending: false });
        setWallets((data as Record<string, unknown>[]) || []);
      } catch { setWallets([]); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const viewDetail = async (w: Record<string, unknown>) => {
    setSelectedWallet(w);
    setShowDetail(true);
    try {
      const { data } = await supabase.from("wallet_transactions").select("*").eq("wallet_id", w.id as string).order("created_at", { ascending: false }).limit(20);
      setTransactions((data as Record<string, unknown>[]) || []);
    } catch { setTransactions([]); }
  };

  const filtered = wallets.filter(w => {
    if (!search) return true;
    const s = search.toLowerCase();
    const user = w.user as Record<string, unknown> | undefined;
    return (user?.full_name as string || "").toLowerCase().includes(s) || (user?.phone as string || "").includes(s);
  });

  const totalBalance = wallets.reduce((sum, w) => sum + (w.balance as number || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-400">Total Balance</p><p className="text-xl font-bold">{formatCurrency(totalBalance)}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-400">Total Wallets</p><p className="text-xl font-bold">{wallets.length}</p></div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input type="text" placeholder="Search by name or phone..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 font-medium">Rider</th><th className="px-4 py-3 font-medium">Phone</th><th className="px-4 py-3 font-medium text-right">Balance</th><th className="px-4 py-3 font-medium text-right">Ride Credits</th><th className="px-4 py-3 font-medium text-right">Promo</th><th className="px-4 py-3 font-medium text-right">Refunds</th><th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr></thead>
              <tbody>
                {filtered.map(w => {
                  const user = w.user as Record<string, unknown> | undefined;
                  return (
                    <tr key={w.id as string} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-xs">{user?.full_name as string || "N/A"}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{user?.phone as string || "N/A"}</td>
                      <td className="px-4 py-3 text-right font-medium text-xs">{formatCurrency(w.balance as number)}</td>
                      <td className="px-4 py-3 text-right text-xs">{formatCurrency(w.ride_credits as number || 0)}</td>
                      <td className="px-4 py-3 text-right text-xs">{formatCurrency(w.promo_balance as number || 0)}</td>
                      <td className="px-4 py-3 text-right text-xs">{formatCurrency(w.refund_balance as number || 0)}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => viewDetail(w)} className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">View</button>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">No wallets found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showDetail && selectedWallet && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto">
            <div className="p-6 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">Wallet: {(selectedWallet.user as Record<string, unknown>)?.full_name as string || "N/A"}</h2>
              <button onClick={() => setShowDetail(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-green-50 rounded-lg p-3 text-center"><p className="text-xs text-gray-400">Balance</p><p className="text-lg font-bold text-green-700">{formatCurrency(selectedWallet.balance as number)}</p></div>
                <div className="bg-blue-50 rounded-lg p-3 text-center"><p className="text-xs text-gray-400">Ride Credits</p><p className="text-lg font-bold text-blue-700">{formatCurrency(selectedWallet.ride_credits as number || 0)}</p></div>
                <div className="bg-purple-50 rounded-lg p-3 text-center"><p className="text-xs text-gray-400">Promo</p><p className="text-lg font-bold text-purple-700">{formatCurrency(selectedWallet.promo_balance as number || 0)}</p></div>
                <div className="bg-amber-50 rounded-lg p-3 text-center"><p className="text-xs text-gray-400">Refunds</p><p className="text-lg font-bold text-amber-700">{formatCurrency(selectedWallet.refund_balance as number || 0)}</p></div>
              </div>
              <h3 className="text-sm font-semibold mt-4">Transaction History</h3>
              <div className="space-y-2">
                {transactions.map(t => (
                  <div key={t.id as string} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="text-xs font-medium capitalize">{((t.transaction_type || t.type) as string)?.replace(/_/g, " ") || "Transaction"}</p>
                      <p className="text-xs text-gray-400">{t.description as string || t.reference_type as string || ""}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-medium ${(t.amount as number) >= 0 ? "text-green-600" : "text-red-600"}`}>{(t.amount as number) >= 0 ? "+" : ""}{formatCurrency(Math.abs(t.amount as number))}</p>
                      <p className="text-xs text-gray-400">{t.created_at ? timeAgo(t.created_at as string) : ""}</p>
                    </div>
                  </div>
                ))}
                {transactions.length === 0 && <p className="text-center text-gray-400 py-4 text-sm">No transactions</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RiderStatBox({ icon: Icon, label, value, color, bg }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`${bg} rounded-xl p-4`}>
      <Icon className={`h-4 w-4 ${color}`} />
      <p className="text-xl font-bold mt-2 text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}