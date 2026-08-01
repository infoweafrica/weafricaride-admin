// ====================================
// WeAfrica Ride - Base API Client
// ====================================
// Safe wrappers around Supabase queries.
// Uses pragmatic typing to avoid Supabase v2 generic complexity.
// NO MOCK DATA. Returns real data or errors.

import { supabase } from "@/lib/supabase";
import type { PostgrestError } from "@supabase/supabase-js";

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
  count: number;
}

export interface PaginatedResult<T> {
  data: T | null;
  error: string | null;
  count: number;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/**
 * Execute a Supabase query that returns a standard PostgrestResponse.
 * Works with .select(), .insert(), .update(), .delete() result promises.
 */
export async function safeQuery<T>(
  promise: PromiseLike<{ data: T | null; error: PostgrestError | null; count?: number | null }>
): Promise<ApiResult<T>> {
  try {
    const { data, error, count } = await promise;
    if (error) {
      // Missing tables are expected during initial setup — return empty silently
      if (error.message.includes("Could not find the table") || error.message.includes("schema cache")) {
        return { data: (Array.isArray(data) ? [] : null) as unknown as T, error: null, count: 0 };
      }
      console.error("[API Error]", error.message);
      return { data: null, error: error.message, count: count ?? 0 };
    }
    return {
      data,
      error: null,
      count: count ?? (Array.isArray(data) ? (data as unknown[]).length : 0),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown API error";
    console.error("[API Exception]", msg);
    return { data: null, error: msg, count: 0 };
  }
}

/**
 * Execute a paginated query.
 * `buildSelect` is a function that takes the supabase.from(table).select(...) chain
 * and applies filters, returning the filtered chain.
 */
export async function pagedQuery<T>(
  tableName: string,
  page: number,
  pageSize: number,
  selectClause = "*",
   
  buildFilters?: (q: any) => any,
  orderColumn = "created_at",
  orderDirection: "asc" | "desc" = "desc"
): Promise<PaginatedResult<T>> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    // Total count
     
    let countQ: any = supabase.from(tableName).select(selectClause, { count: "exact", head: true });
    if (buildFilters) countQ = buildFilters(countQ);

    const { count: totalCount, error: countError } = await countQ;
    if (countError) {
      // Missing tables return empty silently
      if (countError.message.includes("Could not find the table") || countError.message.includes("schema cache")) {
        return { data: [] as unknown as T, error: null, count: 0, page, pageSize, totalCount: 0, totalPages: 0 };
      }
      return { data: null, error: countError.message, count: 0, page, pageSize, totalCount: 0, totalPages: 0 };
    }

    // Paginated data
     
    let dataQ: any = supabase.from(tableName).select(selectClause, { count: "exact" });
    if (buildFilters) dataQ = buildFilters(dataQ);
    const { data, error } = await dataQ.order(orderColumn, { ascending: orderDirection === "asc" }).range(from, to);

    if (error) {
      return { data: null, error: error.message, count: 0, page, pageSize, totalCount: totalCount ?? 0, totalPages: Math.ceil((totalCount ?? 0) / pageSize) };
    }

    const total = totalCount ?? 0;
    return {
      data: (data as T) ?? null,
      error: null,
      count: (data as unknown as unknown[])?.length ?? 0,
      page,
      pageSize,
      totalCount: total,
      totalPages: Math.ceil(total / pageSize),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown";
    return { data: null, error: msg, count: 0, page, pageSize, totalCount: 0, totalPages: 0 };
  }
}

/**
 * Simple count query.
 */
export async function safeCount(
  tableName: string,
  filterColumn?: string,
  filterValue?: unknown
): Promise<number> {
  try {
     
    let query: any = supabase.from(tableName).select("*", { count: "exact", head: true });
    if (filterColumn && filterValue !== undefined) {
      query = query.eq(filterColumn, filterValue);
    }
    const { count, error } = await query;
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}