"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Flag,
  RefreshCw,
  Search,
  ShieldAlert,
  User,
  X,
} from "lucide-react";

type UserSummary = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

type ModerationCase = {
  id: string;
  case_number: string;
  case_type: string;
  city: string | null;
  country: string | null;
  created_at: string | null;
  description: string | null;
  priority: string;
  reason: string;
  reported_user_id: string | null;
  reported_user_role: string | null;
  reporter_id: string | null;
  resolution: string | null;
  resolved_at: string | null;
  source_app: string;
  status: string;
  trip_id: string | null;
  updated_at: string | null;
  reported_user?: UserSummary | null;
  reporter?: UserSummary | null;
};

type ModerationAction = {
  id: string;
  action_type: string;
  action_reason: string | null;
  admin_id: string | null;
  case_id: string;
  created_at: string | null;
  duration_hours: number | null;
  target_user_id: string | null;
};

type Appeal = {
  id: string;
  appeal_reason: string;
  case_id: string | null;
  created_at: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  status: string;
  user_id: string;
};

type Evidence = {
  id: string;
  case_id: string;
  created_at: string | null;
  evidence_type: string;
  file_url: string | null;
  message: string | null;
  metadata: unknown;
};

const badge = (value: string | null | undefined) => {
  const v = String(value || "").toLowerCase();

  if (["critical", "urgent"].includes(v)) {
    return "bg-red-100 text-red-700";
  }

  if (["high"].includes(v)) {
    return "bg-orange-100 text-orange-700";
  }

  if (["pending", "open", "under_review"].includes(v)) {
    return "bg-amber-100 text-amber-700";
  }

  if (["resolved", "closed", "approved"].includes(v)) {
    return "bg-green-100 text-green-700";
  }

  if (["rejected", "dismissed", "banned"].includes(v)) {
    return "bg-red-100 text-red-700";
  }

  return "bg-gray-100 text-gray-700";
};

const formatDate = (value: string | null) => {
  if (!value) return "—";

  return new Date(value).toLocaleString("en-MW", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

export default function ModerationPage() {
  return (
    <PermissionGuard permission="moderate_content">
      <ModerationContent />
    </PermissionGuard>
  );
}

function ModerationContent() {
  const [cases, setCases] = useState<ModerationCase[]>([]);
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [selectedCase, setSelectedCase] = useState<ModerationCase | null>(null);
  const [actions, setActions] = useState<ModerationAction[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<"cases" | "appeals">("cases");
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [
        casesResult,
        appealsResult,
      ] = await Promise.all([
        supabase
          .from("moderation_cases")
          .select(`
            *,
            reported_user:users!moderation_cases_reported_user_id_fkey(
              id,
              full_name,
              email,
              phone
            ),
            reporter:users!moderation_cases_reporter_id_fkey(
              id,
              full_name,
              email,
              phone
            )
          `)
          .order("created_at", { ascending: false })
          .limit(200),

        supabase
          .from("moderation_appeals")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      if (casesResult.error) throw casesResult.error;
      if (appealsResult.error) throw appealsResult.error;

      setCases((casesResult.data || []) as ModerationCase[]);
      setAppeals((appealsResult.data || []) as Appeal[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load moderation data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCase = async (item: ModerationCase) => {
    setSelectedCase(item);
    setDetailLoading(true);

    try {
      const [actionsResult, evidenceResult] = await Promise.all([
        supabase
          .from("moderation_actions")
          .select("*")
          .eq("case_id", item.id)
          .order("created_at", { ascending: false }),

        supabase
          .from("moderation_evidence")
          .select("*")
          .eq("case_id", item.id)
          .order("created_at", { ascending: false }),
      ]);

      if (actionsResult.error) throw actionsResult.error;
      if (evidenceResult.error) throw evidenceResult.error;

      setActions((actionsResult.data || []) as ModerationAction[]);
      setEvidence((evidenceResult.data || []) as Evidence[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load case details");
    } finally {
      setDetailLoading(false);
    }
  };

  const updateCase = async (
    id: string,
    values: {
      status?: string;
      priority?: string;
      resolution?: string | null;
      resolved_at?: string | null;
    },
  ) => {
    setSaving(true);
    setError(null);

    try {
      const { data, error: updateError } = await supabase
        .from("moderation_cases")
        .update({
          ...values,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("*")
        .single();

      if (updateError) throw updateError;

      const updated = data as ModerationCase;

      setCases((current) =>
        current.map((item) => (item.id === id ? { ...item, ...updated } : item)),
      );

      setSelectedCase((current) =>
        current?.id === id ? { ...current, ...updated } : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update case");
    } finally {
      setSaving(false);
    }
  };

  const reviewAppeal = async (appeal: Appeal, status: "approved" | "rejected") => {
    setSaving(true);
    setError(null);

    try {
      const { error: updateError } = await supabase
        .from("moderation_appeals")
        .update({
          status,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", appeal.id);

      if (updateError) throw updateError;

      setAppeals((current) =>
        current.map((item) =>
          item.id === appeal.id
            ? {
                ...item,
                status,
                reviewed_at: new Date().toISOString(),
              }
            : item,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review appeal");
    } finally {
      setSaving(false);
    }
  };

  const filteredCases = useMemo(() => {
    const q = search.trim().toLowerCase();

    return cases.filter((item) => {
      const matchesSearch =
        !q ||
        item.case_number.toLowerCase().includes(q) ||
        item.reason.toLowerCase().includes(q) ||
        item.case_type.toLowerCase().includes(q) ||
        item.reported_user?.full_name?.toLowerCase().includes(q) ||
        item.reported_user?.email?.toLowerCase().includes(q) ||
        item.city?.toLowerCase().includes(q);

      const matchesStatus =
        statusFilter === "all" ||
        item.status.toLowerCase() === statusFilter.toLowerCase();

      const matchesPriority =
        priorityFilter === "all" ||
        item.priority.toLowerCase() === priorityFilter.toLowerCase();

      return matchesSearch && matchesStatus && matchesPriority;
    });
  }, [cases, search, statusFilter, priorityFilter]);

  const stats = useMemo(() => {
    const pending = cases.filter((item) =>
      ["pending", "open", "under_review"].includes(item.status.toLowerCase()),
    ).length;

    const critical = cases.filter((item) =>
      ["critical", "high"].includes(item.priority.toLowerCase()),
    ).length;

    const resolved = cases.filter((item) =>
      ["resolved", "closed"].includes(item.status.toLowerCase()),
    ).length;

    const pendingAppeals = appeals.filter((item) =>
      ["pending", "open", "under_review"].includes(item.status.toLowerCase()),
    ).length;

    return {
      total: cases.length,
      pending,
      critical,
      resolved,
      pendingAppeals,
    };
  }, [cases, appeals]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Content Moderation
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Review reported users, safety cases, evidence and appeals.
          </p>
        </div>

        <button
          onClick={fetchData}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          icon={<FileText className="h-5 w-5" />}
          label="Total Cases"
          value={stats.total}
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="Pending Review"
          value={stats.pending}
        />
        <StatCard
          icon={<ShieldAlert className="h-5 w-5" />}
          label="High / Critical"
          value={stats.critical}
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Resolved"
          value={stats.resolved}
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Pending Appeals"
          value={stats.pendingAppeals}
        />
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab("cases")}
          className={`border-b-2 px-4 py-3 text-sm font-medium ${
            activeTab === "cases"
              ? "border-green-600 text-green-700"
              : "border-transparent text-gray-500"
          }`}
        >
          Cases ({cases.length})
        </button>

        <button
          onClick={() => setActiveTab("appeals")}
          className={`border-b-2 px-4 py-3 text-sm font-medium ${
            activeTab === "appeals"
              ? "border-green-600 text-green-700"
              : "border-transparent text-gray-500"
          }`}
        >
          Appeals ({appeals.length})
        </button>
      </div>

      {activeTab === "cases" ? (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-gray-200 p-4 lg:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search case, reason, user or city..."
                className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-green-500"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="open">Open</option>
              <option value="under_review">Under review</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>

            <select
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="all">All priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm text-gray-500">
              Loading moderation cases...
            </div>
          ) : filteredCases.length === 0 ? (
            <div className="p-12 text-center">
              <Flag className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 font-medium text-gray-700">
                No moderation cases found
              </p>
              <p className="mt-1 text-sm text-gray-500">
                The live moderation queue currently has no matching cases.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-5 py-3">Case</th>
                    <th className="px-5 py-3">Reported User</th>
                    <th className="px-5 py-3">Reason</th>
                    <th className="px-5 py-3">Priority</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Created</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-100">
                  {filteredCases.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-5 py-4">
                        <div className="font-semibold text-gray-900">
                          {item.case_number}
                        </div>
                        <div className="text-xs text-gray-500">
                          {item.case_type}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <div className="font-medium text-gray-900">
                          {item.reported_user?.full_name || "Unknown user"}
                        </div>
                        <div className="text-xs text-gray-500">
                          {item.reported_user_role || "—"}
                        </div>
                      </td>

                      <td className="max-w-xs px-5 py-4">
                        <div className="truncate text-gray-700">
                          {item.reason}
                        </div>
                        <div className="text-xs text-gray-400">
                          {item.city || item.country || "—"}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge(item.priority)}`}>
                          {item.priority}
                        </span>
                      </td>

                      <td className="px-5 py-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge(item.status)}`}>
                          {item.status}
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-gray-500">
                        {formatDate(item.created_at)}
                      </td>

                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => openCase(item)}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          <Eye className="h-4 w-4" />
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {appeals.length === 0 ? (
            <div className="p-12 text-center">
              <AlertTriangle className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 font-medium text-gray-700">
                No appeals found
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {appeals.map((appeal) => (
                <div
                  key={appeal.id}
                  className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge(appeal.status)}`}>
                        {appeal.status}
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatDate(appeal.created_at)}
                      </span>
                    </div>

                    <p className="mt-2 text-sm font-medium text-gray-900">
                      {appeal.appeal_reason}
                    </p>

                    <p className="mt-1 text-xs text-gray-500">
                      User: {appeal.user_id}
                      {appeal.case_id ? ` · Case: ${appeal.case_id}` : ""}
                    </p>
                  </div>

                  {["pending", "open", "under_review"].includes(
                    appeal.status.toLowerCase(),
                  ) && (
                    <div className="flex gap-2">
                      <button
                        disabled={saving}
                        onClick={() => reviewAppeal(appeal, "approved")}
                        className="rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        Approve
                      </button>

                      <button
                        disabled={saving}
                        onClick={() => reviewAppeal(appeal, "rejected")}
                        className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-gray-900">
                    {selectedCase.case_number}
                  </h2>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge(selectedCase.priority)}`}>
                    {selectedCase.priority}
                  </span>
                </div>
                <p className="text-sm text-gray-500">
                  {selectedCase.case_type} · {selectedCase.source_app}
                </p>
              </div>

              <button
                onClick={() => setSelectedCase(null)}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-6">
              {detailLoading ? (
                <div className="p-10 text-center text-sm text-gray-500">
                  Loading case details...
                </div>
              ) : (
                <div className="grid gap-6 lg:grid-cols-3">
                  <div className="space-y-5 lg:col-span-2">
                    <section className="rounded-xl border border-gray-200 p-5">
                      <h3 className="font-semibold text-gray-900">
                        Case information
                      </h3>

                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <Info label="Reason" value={selectedCase.reason} />
                        <Info label="Status" value={selectedCase.status} />
                        <Info label="Reported role" value={selectedCase.reported_user_role || "—"} />
                        <Info label="City" value={selectedCase.city || "—"} />
                        <Info label="Country" value={selectedCase.country || "—"} />
                        <Info label="Trip" value={selectedCase.trip_id || "—"} />
                        <Info label="Created" value={formatDate(selectedCase.created_at)} />
                        <Info label="Resolved" value={formatDate(selectedCase.resolved_at)} />
                      </div>

                      {selectedCase.description && (
                        <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
                          {selectedCase.description}
                        </div>
                      )}
                    </section>

                    <section className="rounded-xl border border-gray-200 p-5">
                      <h3 className="font-semibold text-gray-900">
                        Reported user
                      </h3>

                      <div className="mt-3 flex items-center gap-3">
                        <div className="rounded-full bg-gray-100 p-2">
                          <User className="h-5 w-5 text-gray-500" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">
                            {selectedCase.reported_user?.full_name || "Unknown user"}
                          </div>
                          <div className="text-sm text-gray-500">
                            {selectedCase.reported_user?.email || selectedCase.reported_user?.phone || selectedCase.reported_user_id || "—"}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-xl border border-gray-200 p-5">
                      <h3 className="font-semibold text-gray-900">
                        Evidence
                      </h3>

                      {evidence.length === 0 ? (
                        <p className="mt-3 text-sm text-gray-500">
                          No evidence attached to this case.
                        </p>
                      ) : (
                        <div className="mt-3 space-y-3">
                          {evidence.map((item) => (
                            <div key={item.id} className="rounded-lg bg-gray-50 p-3">
                              <div className="text-xs font-medium uppercase text-gray-500">
                                {item.evidence_type}
                              </div>
                              {item.message && (
                                <p className="mt-1 text-sm text-gray-700">
                                  {item.message}
                                </p>
                              )}
                              {item.file_url && (
                                <a
                                  href={item.file_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 inline-block text-sm font-medium text-green-700 hover:underline"
                                >
                                  View evidence
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="rounded-xl border border-gray-200 p-5">
                      <h3 className="font-semibold text-gray-900">
                        Moderation actions
                      </h3>

                      {actions.length === 0 ? (
                        <p className="mt-3 text-sm text-gray-500">
                          No moderation actions recorded.
                        </p>
                      ) : (
                        <div className="mt-3 space-y-3">
                          {actions.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-start justify-between gap-4 rounded-lg bg-gray-50 p-3"
                            >
                              <div>
                                <div className="font-medium text-gray-900">
                                  {item.action_type}
                                </div>
                                <div className="text-sm text-gray-500">
                                  {item.action_reason || "No reason recorded"}
                                </div>
                              </div>
                              <div className="whitespace-nowrap text-xs text-gray-400">
                                {formatDate(item.created_at)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>

                  <aside className="space-y-4">
                    <div className="rounded-xl border border-gray-200 p-5">
                      <h3 className="font-semibold text-gray-900">
                        Case actions
                      </h3>

                      <div className="mt-4 space-y-2">
                        <button
                          disabled={saving}
                          onClick={() =>
                            updateCase(selectedCase.id, {
                              status: "under_review",
                            })
                          }
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Mark Under Review
                        </button>

                        <button
                          disabled={saving}
                          onClick={() =>
                            updateCase(selectedCase.id, {
                              status: "resolved",
                              resolved_at: new Date().toISOString(),
                            })
                          }
                          className="w-full rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          Resolve Case
                        </button>

                        <button
                          disabled={saving}
                          onClick={() =>
                            updateCase(selectedCase.id, {
                              status: "closed",
                              resolved_at: new Date().toISOString(),
                            })
                          }
                          className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
                        >
                          Close Case
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-200 p-5">
                      <h3 className="font-semibold text-gray-900">
                        Reporter
                      </h3>

                      <div className="mt-3 text-sm">
                        <div className="font-medium text-gray-900">
                          {selectedCase.reporter?.full_name || "Unknown reporter"}
                        </div>
                        <div className="mt-1 text-gray-500">
                          {selectedCase.reporter?.email ||
                            selectedCase.reporter?.phone ||
                            selectedCase.reporter_id ||
                            "—"}
                        </div>
                      </div>
                    </div>

                    {selectedCase.resolution && (
                      <div className="rounded-xl border border-green-200 bg-green-50 p-5">
                        <h3 className="font-semibold text-green-900">
                          Resolution
                        </h3>
                        <p className="mt-2 text-sm text-green-800">
                          {selectedCase.resolution}
                        </p>
                      </div>
                    )}
                  </aside>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="rounded-lg bg-green-50 p-2 text-green-700">
          {icon}
        </div>
      </div>
      <div className="mt-4 text-2xl font-bold text-gray-900">{value}</div>
      <div className="mt-1 text-sm text-gray-500">{label}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase text-gray-400">{label}</div>
      <div className="mt-1 break-words text-sm text-gray-800">{value}</div>
    </div>
  );
}
