import { NextRequest, NextResponse } from 'next/server';

// Per-request CSP nonce + admin route gate (cookie presence only; the API enforces real auth, RBAC and MFA).
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== 'production';
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' https://accounts.google.com`,
    `frame-src https://accounts.google.com https://oauth.telegram.org`,
    `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`,
  ].join('; ');

  const p = req.nextUrl.pathname;
  if (p.startsWith('/admin') && p !== '/admin/login' && !req.cookies.has('adm')) {
    return NextResponse.redirect(new URL('/admin/login', req.url));
  }
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  if (p.startsWith('/admin')) res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|games/).*)'] };
