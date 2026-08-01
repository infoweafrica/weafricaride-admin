"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import { RefreshCw, UserX, Image, Flag } from "lucide-react";

interface FlaggedUser {
  id: string;
  full_name: string;
  email: string;
  flag_reason: string;
  flagged_at: string;
  is_banned: boolean;
}

export default function ModerationPage() {
  return (
    <PermissionGuard permission="moderate_content">
      <ModerationContent />
    </PermissionGuard>
  );
}

function ModerationContent() {
  const [flagged, setFlagged] = useState<FlaggedUser[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFlagged = useCallback(async () => {
    setLoading(true);
    try {
      // Try safety_flags table first, fallback to banned_accounts
      const { data } = await supabase.from("safety_flags").select("*").order("flagged_at", { ascending: false }).limit(100);
      setFlagged((data as FlaggedUser[]) || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchFlagged(); }, [fetchFlagged]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Content Moderation</h1>
          <p className="text-sm text-gray-500 mt-1">Review flagged content, fake accounts, and inappropriate material</p>
        </div>
        <button onClick={fetchFlagged} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <Flag className="h-5 w-5 text-red-500 mb-2" />
          <p className="text-xs text-gray-500">Flagged Users</p>
          <p className="text-2xl font-bold">{flagged.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <UserX className="h-5 w-5 text-orange-500 mb-2" />
          <p className="text-xs text-gray-500">Banned</p>
          <p className="text-2xl font-bold">{flagged.filter((f) => f.is_banned).length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <Image className="h-5 w-5 text-blue-500 mb-2" />
          <p className="text-xs text-gray-500">Pending Review</p>
          <p className="text-2xl font-bold">{flagged.filter((f) => !f.is_banned).length}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100"><h3 className="font-semibold text-gray-900">Flagged Items</h3></div>
        <div className="divide-y divide-gray-100">
          {loading ? <div className="p-6 text-center text-sm text-gray-400">Loading...</div>
          : flagged.length === 0 ? <div className="p-6 text-center text-sm text-gray-400">No flagged content</div>
          : flagged.map((f) => (
            <div key={f.id} className="px-6 py-4 hover:bg-gray-50">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{f.full_name}</p>
                  <p className="text-xs text-gray-500">{f.email}</p>
                  <p className="text-xs text-red-600 mt-1">{f.flag_reason}</p>
                  <p className="text-xs text-gray-400">{new Date(f.flagged_at).toLocaleDateString()}</p>
                </div>
                <div className="flex gap-2">
                  {f.is_banned ? (
                    <button className="px-3 py-1 bg-gray-100 text-gray-600 rounded-lg text-xs">Banned</button>
                  ) : (
                    <button className="px-3 py-1 bg-red-600 text-white rounded-lg text-xs hover:bg-red-700">Ban User</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}