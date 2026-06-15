"use client";

import { useAuth } from "@/lib/auth-context";
import type { Permission } from "@/lib/types";

interface PermissionGuardProps {
  /** Permission required to view the children */
  permission?: Permission;
  /** Require ALL of these permissions */
  all?: Permission[];
  /** Require ANY of these permissions */
  any?: Permission[];
  /** Content shown when the user lacks permission */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Conditionally renders children based on the current admin user's permissions.
 *
 * Usage:
 *   <PermissionGuard permission="manage_drivers">
 *     <DriversPage />
 *   </PermissionGuard>
 *
 *   <PermissionGuard any={["manage_drivers", "manage_users"]}>
 *     <SharedContent />
 *   </PermissionGuard>
 *
 *   <PermissionGuard all={["manage_finance", "approve_payouts"]}>
 *     <PayoutApprovalButton />
 *   </PermissionGuard>
 */
export default function PermissionGuard({
  permission,
  all,
  any,
  fallback = <AccessDenied />,
  children,
}: PermissionGuardProps) {
  const { hasPermission, hasAllPermissions, hasAnyPermission, loading } = useAuth();

  // Show nothing while loading
  if (loading) return null;

  let allowed = false;

  if (permission) {
    allowed = hasPermission(permission);
  } else if (all) {
    allowed = hasAllPermissions(...all);
  } else if (any) {
    allowed = hasAnyPermission(...any);
  } else {
    // No permission check = allow
    allowed = true;
  }

  if (!allowed) return <>{fallback}</>;

  return <>{children}</>;
}

/** Default fallback component for unauthorized access */
function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-6">
        <svg
          className="w-10 h-10 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15v2m0 0v2m0-2h2m-2 0H9m3-3V3m0 0L9 6m3-3l3 3m-9 6h.01M6 15h.01M21 15h.01"
          />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
      <p className="text-gray-500 max-w-md">
        You do not have the required permissions to access this section.
        Contact your superadmin if you believe this is an error.
      </p>
    </div>
  );
}