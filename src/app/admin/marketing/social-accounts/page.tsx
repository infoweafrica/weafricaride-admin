"use client";

import { useEffect, useState } from "react";

type SocialAccount = {
  id: string;
  platform: string;
  account_name: string | null;
  account_handle: string | null;
  is_active: boolean;
  token_expires_at: string | null;
  token_expired: boolean;
  last_validated_at: string | null;
  created_at: string;
};

const platformLabels: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  x: "X",
};

export default function SocialAccountsPage() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadAccounts() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch("/api/admin/marketing/accounts", {
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to load social accounts");
      }

      setAccounts(result.data ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load social accounts"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccounts();
  }, []);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Social Accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect and manage the social channels used by WeAfrica Ride
            marketing.
          </p>
        </div>

        <button
          type="button"
          onClick={loadAccounts}
          disabled={loading}
          className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <div className="rounded-xl border p-6 text-sm text-muted-foreground">
            Loading social accounts...
          </div>
        ) : (
          Object.entries(platformLabels).map(([platform, label]) => {
            const account = accounts.find(
              (item) => item.platform === platform
            );

            return (
              <div
                key={platform}
                className="rounded-xl border bg-background p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-semibold">{label}</h2>

                    {account ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {account.account_name ||
                          account.account_handle ||
                          "Connected account"}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">
                        No account connected
                      </p>
                    )}
                  </div>

                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      account?.is_active
                        ? "bg-green-100 text-green-700"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {account?.is_active ? "Connected" : "Not connected"}
                  </span>
                </div>

                {account?.account_handle && (
                  <p className="mt-4 text-sm">{account.account_handle}</p>
                )}

                {account?.token_expired && (
                  <p className="mt-3 text-sm text-red-600">
                    Access token expired.
                  </p>
                )}

                {account?.last_validated_at && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    Last validated{" "}
                    {new Date(account.last_validated_at).toLocaleString()}
                  </p>
                )}

                <div className="mt-5">
                  {platform === "x" ? (
                    <button
                      type="button"
                      onClick={() => {
                        window.location.href =
                          "/api/admin/marketing/oauth/x";
                      }}
                      className="w-full rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
                    >
                      {account ? "Manage connection" : "Connect account"}
                    </button>
                  ) : platform === "youtube" ? (
                    <button
                      type="button"
                      onClick={() => {
                        window.location.href =
                          "/api/admin/marketing/oauth/youtube";
                      }}
                      className="w-full rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
                    >
                      {account ? "Manage connection" : "Connect YouTube"}
                    </button>
                  ) : platform === "tiktok" ? (
                    <button
                      type="button"
                      onClick={() => {
                        window.location.href =
                          "/api/admin/marketing/oauth/tiktok";
                      }}
                      className="w-full rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
                    >
                      {account ? "Manage connection" : "Connect account"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="w-full rounded-lg border px-4 py-2 text-sm font-medium opacity-60"
                    >
                      {account ? "Manage connection" : "Connect account"}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
