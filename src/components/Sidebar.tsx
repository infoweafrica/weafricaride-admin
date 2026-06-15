"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Car } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import {
  DEPARTMENT_GROUPS,
  DEPARTMENT_NAV,
  SUPADMIN_ONLY_NAV,
  type Department,
  type NavItem,
} from "@/lib/types";

/**
 * Production-grade sidebar with permission-filtered navigation.
 * Only shows navigation items the current admin user can actually access.
 * Department groups are collapsed when they contain no visible items.
 */
export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { hasPermission, adminProfile } = useAuth();

  // Check if user has a loaded profile with permissions
  const hasLoadedPermissions = adminProfile?.permissions && adminProfile.permissions.length > 0;

  // Decide which nav items this user can see
  const visibleNav = useMemo(() => {
    // If permissions haven't loaded yet (e.g. old session), show everything as fallback
    if (!hasLoadedPermissions && adminProfile) {
      return DEPARTMENT_NAV;
    }
    return DEPARTMENT_NAV.filter((item) => {
      if (!item.permission) return true;
      return hasPermission(item.permission);
    });
  }, [hasPermission, hasLoadedPermissions, adminProfile]);

  // Re-check on each render (permissions are in-memory)
  const visibleSuperAdminNav = useMemo(() => {
    if (!hasLoadedPermissions && adminProfile) {
      return SUPADMIN_ONLY_NAV;
    }
    return SUPADMIN_ONLY_NAV.filter((item) => {
      if (!item.permission) return true;
      return hasPermission(item.permission);
    });
  }, [hasPermission, hasLoadedPermissions, adminProfile]);

  // Group visible items by department
  const groupedNav = useMemo(() => {
    const map = new Map<Department, NavItem[]>();

    // Group standard department nav
    for (const item of visibleNav) {
      const list = map.get(item.department) || [];
      list.push(item);
      map.set(item.department, list);
    }

    // Add superadmin items to appropriate departments
    for (const item of visibleSuperAdminNav) {
      const list = map.get(item.department) || [];
      list.push(item);
      map.set(item.department, list);
    }

    return map;
  }, [visibleNav, visibleSuperAdminNav]);

  // Get department label from DEPARTMENT_GROUPS
  const getDeptLabel = (dept: Department): string => {
    return DEPARTMENT_GROUPS.find((g) => g.department === dept)?.label || dept;
  };

  return (
    <aside
      className={cn(
        "bg-gray-900 text-white flex flex-col transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Car className="h-8 w-8 text-green-400" />
            <div>
              <h1 className="text-sm font-bold">WeAfrica Ride</h1>
              <p className="text-xs text-gray-400">
                {adminProfile?.role
                  ? adminProfile.role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
                  : "Admin Panel"}
              </p>
            </div>
          </div>
        )}
        {collapsed && <Car className="h-8 w-8 text-green-400 mx-auto" />}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-gray-400 hover:text-white ml-2"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation — department-grouped, permission-filtered */}
      <nav className="flex-1 overflow-y-auto py-4">
        {Array.from(groupedNav.entries()).map(([department, items]) => (
          <div key={department} className="mb-4">
            {!collapsed && (
              <h3 className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                {getDeptLabel(department)}
              </h3>
            )}
            <ul className="space-y-1 px-2">
              {items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                        isActive
                          ? "bg-green-600 text-white"
                          : "text-gray-300 hover:bg-gray-800 hover:text-white",
                        collapsed && "justify-center px-2"
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-base">
                        {item.icon}
                      </span>
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-800">
        {!collapsed && (
          <p className="text-xs text-gray-500 text-center">WeAfrica Ride v1.0</p>
        )}
      </div>
    </aside>
  );
}