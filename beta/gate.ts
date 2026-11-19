import { createHash, timingSafeEqual } from 'node:crypto';
import { createSessionStore } from './session-store';
import type { SessionStore } from './session-store';

// 초대 게이트 (베타). 초대 토큰을 한 번 내면 서버 세션(메모리)이 생기고, 그 세션 쿠키가 있어야 화면·정적 파일·계산 API 모두 열린다.
//  - 토큰 비교: 저장된 토큰의 SHA-256 과 입력의 SHA-256 을 timingSafeEqual 로 모두 비교한다(일찍 끝내지 않는다). 토큰 원문은 로그·응답에 쓰지 않는다.
//  - 세션: beta/session-store.ts(V0 세션 저장소의 복사본)를 쓴다(32바이트 난수, 저장은 해시, 절대 만료). 신원은 "reviewer-N"(초대 순번)뿐이다. 서버를 다시 띄우면 모든 세션이 사라진다.
//  - 쿠키: HttpOnly · SameSite=Lax(초대 링크·메신저에서 연 최상위 이동이 막히지 않게) · Path=/ · Max-Age. https 이면 Secure + __Host- 접두어.
//    쓰기 요청은 쿠키만 믿지 않고 정확한 출처도 본다(handler.ts). 키오스크 화면의 API 요청이 쿠키를 싣는 것은 beta/build.mjs 가 베타 빌드에만 고친 한 줄 덕분이다.
//  - 실패 한도: 10분 동안 틀린 토큰이 30번을 넘으면 그 창이 지나기 전까지 "틀린 토큰"에는 429 를 돌려준다. 맞는 토큰은 한도와 상관없이 통과한다(익명 사용자가 정당한 검토자를 잠글 수 없다).
//    토큰이 256비트(beta:invite)라 추측은 현실적이지 않고, 이 한도는 틀린 시도가 쌓이는 것을 멈추는 용도다.

export const FAILURE_WINDOW_MS = 10 * 60_000;
export const MAX_FAILURES_PER_WINDOW = 30;

export type ExchangeResult = { ok: true; setCookie: string; reviewer: string } | { ok: false; reason: 'INVALID' | 'THROTTLED' };

export interface Gate {
  readonly cookieName: string;
  /** 초대 토큰을 세션으로 바꾼다. */
  exchange(token: string): ExchangeResult;
  /** Cookie 헤더가 유효한 세션이면 검토자 이름, 아니면 null. */
  check(cookieHeader: string | string[] | undefined): string | null;
  /** 세션을 끝내고 쿠키를 지우는 헤더를 돌려준다. */
  leave(cookieHeader: string | string[] | undefined): string;
  /** 진단·시험용: 만료되지 않은 세션 수. */
  sessionCount(): number;
}

export interface GateOptions {
  tokens: readonly string[];
  ttlMs: number;
  secure: boolean;
  now: () => number;
  /** 시험이 세션 토큰을 정할 때만 쓴다. */
  randomToken?: () => string;
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

export function createGate(options: GateOptions): Gate {
  const cookieName = options.secure ? '__Host-bodam_beta' : 'bodam_beta';
  const tokenDigests = options.tokens.map(sha256);
  const sessions: SessionStore = createSessionStore({ ttlMs: options.ttlMs, now: options.now, ...(options.randomToken === undefined ? {} : { randomToken: options.randomToken }) });
  let failures: number[] = [];

  const attributes = (maxAge: number): string => `HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}${options.secure ? '; Secure' : ''}`;

  const readCookie = (header: string | string[] | undefined): string | null => {
    if (typeof header !== 'string' || header === '') return null;
    const values: string[] = [];
    for (const part of header.split(';')) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf('=');
      if (eq > 0 && trimmed.slice(0, eq) === cookieName) values.push(trimmed.slice(eq + 1));
    }
    // 같은 이름이 둘 이상이면 어느 것도 믿지 않는다(쿠키 덮어쓰기 시도).
    return values.length === 1 ? (values[0] as string) : null;
  };

  return {
    cookieName,
    exchange(token) {
      const at = options.now();
      failures = failures.filter((time) => at - time < FAILURE_WINDOW_MS);
      const given = sha256(token);
      let matched = -1;
      tokenDigests.forEach((digest, index) => {
        if (timingSafeEqual(digest, given)) matched = index;
      });
      if (matched < 0) {
        // 한도는 "틀린 시도"만 막는다. 맞는 토큰은 한도와 상관없이 통과한다: 익명 사용자가 틀린 토큰을 채워 정당한 검토자를 막는 길이 없다.
        if (failures.length >= MAX_FAILURES_PER_WINDOW) return { ok: false, reason: 'THROTTLED' };
        failures.push(at);
        return { ok: false, reason: 'INVALID' };
      }
      const reviewer = `reviewer-${matched + 1}`;
      const issued = sessions.create(reviewer);
      return { ok: true, reviewer, setCookie: `${cookieName}=${issued.token}; ${attributes((issued.expiresAt - at) / 1000)}` };
    },
    check(cookieHeader) {
      const token = readCookie(cookieHeader);
      if (token === null) return null;
      const found = sessions.lookup(token);
      return found === null ? null : found.userId;
    },
    leave(cookieHeader) {
      const token = readCookie(cookieHeader);
      if (token !== null) sessions.revoke(token);
      return `${cookieName}=; ${attributes(0)}`;
    },
    sessionCount: () => sessions.count(),
  };
}
