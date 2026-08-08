import { NextResponse, type NextRequest } from 'next/server'
import { verifyAdminSessionToken, ADMIN_SESSION_COOKIE } from '@/lib/admin-session-token'

// Runs in the Node.js runtime (not Edge) because verifyAdminSessionToken uses
// node:crypto (createHmac/timingSafeEqual) to check the signed session
// cookie — the actual server-side trust boundary for the admin dashboard
// (see admin-session-token.ts). This is a defense-in-depth backstop for
// page navigation: API routes already call requireAdminSession() themselves,
// but without this, an unauthenticated visitor could still load an /admin/*
// page shell before the client-side redirect kicked in.
export const runtime = 'nodejs'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === '/admin') {
    return NextResponse.redirect(new URL('/admin/dashboard', request.url))
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value
  const session = verifyAdminSessionToken(token)
  if (!session) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
