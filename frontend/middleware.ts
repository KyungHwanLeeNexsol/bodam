/**
 * Next.js 미들웨어 - 인증 보호 라우트 (SPEC-AUTH-001 Module 5)
 *
 * /chat 경로는 인증이 필요함.
 * localStorage는 서버에서 접근 불가하므로 쿠키 기반 체크 사용.
 * 클라이언트 사이드에서 추가 보호는 AuthContext에서 처리.
 */

import { type NextRequest, NextResponse } from 'next/server'

// 인증이 필요한 경로 패턴
const PROTECTED_PATHS = ['/chat', '/pdf']

// 인증 없이 접근 가능한 경로 패턴
const PUBLIC_PATHS = ['/login', '/register', '/']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 보호된 경로 확인
  const isProtectedPath = PROTECTED_PATHS.some((path) => pathname.startsWith(path))

  if (!isProtectedPath) {
    return NextResponse.next()
  }

  // Authorization 헤더 또는 쿠키에서 토큰 확인
  // (localStorage는 서버에서 접근 불가 - 클라이언트 컴포넌트에서 추가 처리)
  const authCookie = request.cookies.get('auth_token')
  const authHeader = request.headers.get('authorization')

  const hasToken = authCookie?.value || authHeader?.startsWith('Bearer ')

  if (!hasToken) {
    // 미인증 사용자를 로그인 페이지로 리다이렉트
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  // 미들웨어 적용 경로 (정적 파일 제외)
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}
