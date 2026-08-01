"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGuard from "@/components/guards/PermissionGuard";
import { supabase } from "@/lib/supabase";
import { RefreshCw, ToggleLeft, ToggleRight } from "lucide-react";
import type { FeatureFlag } from "@/lib/types";

export default function FeatureFlagsPage() {
  return (
    <PermissionGuard permission="system_settings">
      <FeatureFlagsContent />
    </PermissionGuard>
  );
}

function FeatureFlagsContent() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from("feature_flags").select("*").order("key");
      setFlags((data as FeatureFlag[]) || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchFlags(); }, [fetchFlags]);

  const toggleFlag = async (flag: FeatureFlag) => {
    const newVal = !flag.enabled;
    try {
      await supabase.from("feature_flags").update({ enabled: newVal }).eq("id", flag.id);
      setFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, enabled: newVal } : f)));
    } catch { alert("Toggle failed"); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Feature Flags</h1>
          <p className="text-sm text-gray-500 mt-1">Toggle platform features on/off</p>
        </div>
        <button onClick={fetchFlags} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {loading ? <div className="p-6 text-gray-400">Loading...</div>
        : flags.length === 0 ? <div className="p-6 text-gray-400">No feature flags defined</div>
        : flags.map((flag) => (
            <div key={flag.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between hover:bg-gray-50">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{flag.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{flag.description || flag.key}</p>
                {flag.rollout_percentage > 0 && flag.rollout_percentage < 100 && (
                  <span className="inline-flex mt-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{flag.rollout_percentage}% rollout</span>
                )}
              </div>
              <button onClick={() => toggleFlag(flag)} className={`ml-4 ${flag.enabled ? "text-green-600" : "text-gray-400"} hover:scale-110 transition-transform`}>
                {flag.enabled ? <ToggleRight className="h-8 w-8" /> : <ToggleLeft className="h-8 w-8" />}
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}