import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const sessionId = request.cookies.get('copiloto_session')?.value
  
  const isLoginPage = request.nextUrl.pathname.startsWith('/login')
  
  if (!sessionId && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  
  if (sessionId && isLoginPage) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
