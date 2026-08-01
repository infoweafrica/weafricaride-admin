/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import {
  adminSignIn,
  saveSession,
  loadSession,
  clearSession,
} from "./admin-auth";
import type { Permission } from "./types";

export interface AdminProfile {
  id: string;
  email: string;
  display_name: string;
  role: string;
  role_id: string;
  permissions: Permission[];
  phone_number?: string | null;
  is_active?: boolean | null;
}

interface AuthContextType {
  adminProfile: AdminProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => void;
  /** Check if the current user has a specific permission */
  hasPermission: (perm: Permission) => boolean;
  /** Check if the current user has ALL of the given permissions */
  hasAllPermissions: (...perms: Permission[]) => boolean;
  /** Check if the current user has ANY of the given permissions */
  hasAnyPermission: (...perms: Permission[]) => boolean;
}

const AuthContext = createContext<AuthContextType>({
  adminProfile: null,
  loading: true,
  signIn: async () => ({ error: "Not initialized" }),
  signOut: () => {},
  hasPermission: () => false,
  hasAllPermissions: () => false,
  hasAnyPermission: () => false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [adminProfile, setAdminProfile] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session from localStorage on mount
  useEffect(() => {
    const session = loadSession();
    if (session) {
      setAdminProfile({
        id: session.id,
        email: session.email,
        display_name: session.display_name,
        role: session.role,
        role_id: session.role_id,
        permissions: session.permissions || [],
      });
    }
    setLoading(false);
  }, []);

  const signIn = async (
    email: string,
    password: string
  ): Promise<{ error: string | null }> => {
    const { session, error } = await adminSignIn(email, password);

    if (error || !session) {
      return { error };
    }

    saveSession(session);
    setAdminProfile({
      id: session.id,
      email: session.email,
      display_name: session.display_name,
      role: session.role,
      role_id: session.role_id,
      permissions: session.permissions || [],
    });
    return { error: null };
  };

  const signOut = () => {
    clearSession();
    setAdminProfile(null);
  };

  // ─── Permission check helpers ──────────────────────────────

  /** Check if user is superadmin (old session backwards compat) */
  const isSuperAdmin = adminProfile?.role === "superadmin";

  /** superadmin's `all_access` grants everything.
   *  Old sessions without the permissions array treat superadmin role as all_access. */
  const hasPermission = (perm: Permission): boolean => {
    if (!adminProfile) return false;
    // If the session has no permissions array (old session, pre-permission-system):
    if (!adminProfile.permissions || adminProfile.permissions.length === 0) {
      // Treat superadmin role as having all access, others as nothing
      return isSuperAdmin;
    }
    if (adminProfile.permissions.includes("all_access")) return true;
    return adminProfile.permissions.includes(perm);
  };

  const hasAllPermissions = (...perms: Permission[]): boolean => {
    if (!adminProfile) return false;
    if (!adminProfile.permissions || adminProfile.permissions.length === 0) return isSuperAdmin;
    if (adminProfile.permissions.includes("all_access")) return true;
    return perms.every((p) => adminProfile.permissions.includes(p));
  };

  const hasAnyPermission = (...perms: Permission[]): boolean => {
    if (!adminProfile) return false;
    if (!adminProfile.permissions || adminProfile.permissions.length === 0) return isSuperAdmin;
    if (adminProfile.permissions.includes("all_access")) return true;
    return perms.some((p) => adminProfile.permissions.includes(p));
  };

  return (
    <AuthContext.Provider
      value={{
        adminProfile,
        loading,
        signIn,
        signOut,
        hasPermission,
        hasAllPermissions,
        hasAnyPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);