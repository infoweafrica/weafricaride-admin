import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Auth is handled client-side via localStorage.
// Middleware just passes through — redirects handled by auth-context on the client.
export function middleware(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/"],
};
