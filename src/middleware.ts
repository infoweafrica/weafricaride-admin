import { NextResponse, type NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Admin route protection exists in each page layout via Supabase client-side auth
  // This middleware handles basic redirects only

  const { pathname } = request.nextUrl

  // Redirect /admin to /admin/dashboard
  if (pathname === '/admin') {
    return NextResponse.redirect(new URL('/admin/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}