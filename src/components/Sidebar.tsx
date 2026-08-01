"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Car } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import {
  DEPARTMENT_GROUPS,
  DEPARTMENT_NAV,
  SUPADMIN_ONLY_NAV,
  type Department,
  type NavItem,
} from "@/lib/types";

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<Department>>(new Set());
  const { hasPermission, adminProfile } = useAuth();

  const hasLoadedPermissions = adminProfile?.permissions && adminProfile.permissions.length > 0;

  const visibleNav = useMemo(() => {
    if (!hasLoadedPermissions && adminProfile) return DEPARTMENT_NAV;
    return DEPARTMENT_NAV.filter((item) => {
      if (!item.permission) return true;
      return hasPermission(item.permission);
    });
  }, [hasPermission, hasLoadedPermissions, adminProfile]);

  const visibleSuperAdminNav = useMemo(() => {
    if (!hasLoadedPermissions && adminProfile) return SUPADMIN_ONLY_NAV;
    return SUPADMIN_ONLY_NAV.filter((item) => {
      if (!item.permission) return true;
      return hasPermission(item.permission);
    });
  }, [hasPermission, hasLoadedPermissions, adminProfile]);

  const groupedNav = useMemo(() => {
    const map = new Map<Department, NavItem[]>();
    for (const item of visibleNav) {
      const list = map.get(item.department) || [];
      list.push(item);
      map.set(item.department, list);
    }
    for (const item of visibleSuperAdminNav) {
      const list = map.get(item.department) || [];
      list.push(item);
      map.set(item.department, list);
    }
    return map;
  }, [visibleNav, visibleSuperAdminNav]);

  const getDeptLabel = (dept: Department): string => {
    return DEPARTMENT_GROUPS.find((g) => g.department === dept)?.label || dept;
  };

  // Auto-open the group containing the active page
  useMemo(() => {
    for (const [dept, items] of groupedNav.entries()) {
      const isActive = items.some(
        (item) => pathname === item.href || pathname.startsWith(item.href + "/")
      );
      if (isActive) {
        setOpenGroups((prev) => new Set([...prev, dept]));
      }
    }
  }, [pathname, groupedNav]);

  const toggleGroup = (dept: Department) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) {
        next.delete(dept);
      } else {
        next.add(dept);
      }
      return next;
    });
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
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        {Array.from(groupedNav.entries()).map(([department, items]) => {
          const isOpen = collapsed || openGroups.has(department);
          const hasActive = items.some(
            (item) => pathname === item.href || pathname.startsWith(item.href + "/")
          );

          return (
            <div key={department} className="mb-1">
              {/* Group header — clickable to expand/collapse */}
              {!collapsed && (
                <button
                  onClick={() => toggleGroup(department)}
                  className={cn(
                    "w-full flex items-center justify-between px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors",
                    hasActive ? "text-green-400" : "text-gray-400 hover:text-gray-200"
                  )}
                >
                  <span>{getDeptLabel(department)}</span>
                  {isOpen ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </button>
              )}

              {/* Group items */}
              {isOpen && (
                <ul className="space-y-0.5 px-2 mt-1">
                  {items.map((item) => {
                    const isActive =
                      pathname === item.href || pathname.startsWith(item.href + "/");
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
              )}
            </div>
          );
        })}
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
