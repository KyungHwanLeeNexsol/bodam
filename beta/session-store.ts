import { createHash, randomBytes } from 'node:crypto';

// 서버 세션 저장소 (베타). 개발 브랜치의 validation/auth/session-store.ts(V0 로그인)의 복사본이다: 배포본이 validation/ 폴더에 기대지 않게 beta/ 안에 둔다.
// 메모리에만 둔다: 서버를 다시 띄우거나 호스팅이 인스턴스를 재시작·중지하면 모든 세션이 사라져 초대 링크로 다시 입장해야 한다.
//  - 토큰은 32 바이트 난수(CSPRNG)를 base64url 로 쓴 43자다. 예측할 수 없다.
//  - 저장소에는 토큰이 아니라 토큰의 SHA-256 만 둔다(메모리 덤프·진단 출력에 쓸 수 있는 토큰이 없다). 토큰 원문은 만든 직후 호출한 쪽에만 돌려준다.
//  - 수명은 절대 만료(발급 시각 + ttl)다. 조회할 때 만료를 확인하고, 만료된 세션은 그 자리에서 지운다. 요청이 수명을 늘리지 않는다.
//  - 신원은 세션에 담지 않는다(userId 만 담는다). 베타에서는 "reviewer-N"(초대 순번)이다.
//  - 한도: 세션은 최대 MAX_SESSIONS 개다. 가득 차면 만료된 것을 먼저 지우고, 그래도 가득 차면 가장 오래된 것을 지운다(메모리가 무한히 늘지 않는다).

export const MAX_SESSIONS = 64;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionLookup {
  readonly userId: string;
  readonly expiresAt: number;
}

export interface IssuedSession {
  /** 쿠키로 나가는 토큰 원문. 저장소에는 남지 않는다. */
  readonly token: string;
  readonly expiresAt: number;
}

export interface SessionStore {
  create(userId: string): IssuedSession;
  lookup(token: string): SessionLookup | null;
  revoke(token: string): boolean;
  /** 만료되지 않은 세션 수(진단·시험용). */
  count(): number;
}

export interface SessionStoreOptions {
  /** 세션 수명(밀리초). */
  ttlMs: number;
  now: () => number;
  /** 시험이 토큰 원문을 정할 때만 쓴다. 기본은 CSPRNG. */
  randomToken?: () => string;
}

const digestOf = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

export function createSessionStore(options: SessionStoreOptions): SessionStore {
  if (!Number.isInteger(options.ttlMs) || options.ttlMs < 1) {
    throw new Error('세션 수명은 1 밀리초 이상의 정수여야 한다');
  }
  const sessions = new Map<string, { userId: string; expiresAt: number }>();
  const mint = options.randomToken ?? ((): string => randomBytes(32).toString('base64url'));

  const purgeExpired = (at: number): void => {
    for (const [key, session] of sessions) {
      if (session.expiresAt <= at) {
        sessions.delete(key);
      }
    }
  };

  return {
    create(userId) {
      const at = options.now();
      purgeExpired(at);
      while (sessions.size >= MAX_SESSIONS) {
        const oldest = sessions.keys().next();
        if (oldest.done === true) break;
        sessions.delete(oldest.value);
      }
      const token = mint();
      if (!TOKEN_PATTERN.test(token)) {
        throw new Error('세션 토큰 모양이 올바르지 않다');
      }
      const expiresAt = at + options.ttlMs;
      sessions.set(digestOf(token), { userId, expiresAt });
      return { token, expiresAt };
    },
    lookup(token) {
      if (!TOKEN_PATTERN.test(token)) {
        return null;
      }
      const key = digestOf(token);
      const found = sessions.get(key);
      if (found === undefined) {
        return null;
      }
      if (found.expiresAt <= options.now()) {
        sessions.delete(key);
        return null;
      }
      return { userId: found.userId, expiresAt: found.expiresAt };
    },
    revoke(token) {
      return TOKEN_PATTERN.test(token) ? sessions.delete(digestOf(token)) : false;
    },
    count() {
      purgeExpired(options.now());
      return sessions.size;
    },
  };
}
