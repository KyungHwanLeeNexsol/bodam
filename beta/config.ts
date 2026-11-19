// 베타 설정 (손해사정사 1인용 비공개 키오스크 베타). 환경 변수에서만 읽고, 잘못되면 시작하지 않는다(조용히 기본값으로 대신하지 않는다).
//  - 초대 토큰: BODAM_BETA_INVITE_TOKENS (쉼표로 구분, 각 32~128자 [A-Za-z0-9_-]). 없으면 시작하지 않는다: 초대 없는 열린 서버가 되는 길이 없다.
//  - 공개 출처: BODAM_BETA_PUBLIC_ORIGIN (예: https://beta.example.com). 없으면 Render 가 넣어 주는 RENDER_EXTERNAL_URL 을 쓴다. http 는 루프백(127.0.0.1·localhost)에서만 받는다: 토큰과 세션 쿠키가 평문으로 다니지 않게 한다.
//    허용 Host 는 이 출처의 host(:port) 하나이고, 쓰기 요청의 Origin 은 이 출처와 정확히 같아야 한다.
//  - 바인딩: BODAM_BETA_HOST(기본 127.0.0.1), PORT 또는 BODAM_BETA_PORT(기본 3401). 컨테이너·PaaS 에서는 0.0.0.0 으로 열고 앞단이 TLS 를 맡는다.
//  - 접속 종료일: BODAM_BETA_EXPIRES_ON(YYYY-MM-DD). 그 날의 한국 시간 23:59:59.999 까지 열리고, 이후에는 /healthz 말고 모든 요청이 410 이다. 없으면 기한이 없다.
//  - 판정 기준일: BODAM_BETA_TODAY(YYYY-MM-DD)로 고정할 수 있고, 없으면 시스템 날짜(한국 표준시)다. 합성 규칙의 유효 기간은 2026-01-01 ~ 2026-12-31 이다.

export class BetaConfigError extends Error {}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
export const MAX_INVITES = 10;
export const MIN_DISTINCT_CHARS = 12;
export const DEFAULT_PORT = 3401;
export const DEFAULT_SESSION_HOURS = 8;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost']);

export interface BetaConfig {
  /** 바인딩 주소. */
  host: string;
  port: number;
  /** 브라우저가 보는 출처(스킴+호스트+포트). 끝에 슬래시 없음. */
  publicOrigin: string;
  /** 허용하는 Host 헤더 값(소문자). */
  allowedHost: string;
  /** 공개 출처가 https 이면 true: 세션 쿠키에 Secure 를 붙인다. */
  secureCookie: boolean;
  inviteTokens: readonly string[];
  sessionTtlMs: number;
  todayOverride: string | null;
  /** 접속 종료일(YYYY-MM-DD, 한국 시간). 없으면 null. */
  expiresOn: string | null;
  /** 종료 시각(그 날 한국 시간 23:59:59.999 의 epoch 밀리초). 없으면 null. */
  expiresAtMs: number | null;
}

export function parseConfig(env: Readonly<Record<string, string | undefined>>): BetaConfig {
  const rawOrigin = (env['BODAM_BETA_PUBLIC_ORIGIN'] ?? '').trim() || (env['RENDER_EXTERNAL_URL'] ?? '').trim();
  if (rawOrigin === '') {
    throw new BetaConfigError('BODAM_BETA_PUBLIC_ORIGIN 이 필요하다 (예: https://beta.example.com. Render 에서는 RENDER_EXTERNAL_URL 을 대신 쓴다)');
  }
  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new BetaConfigError(`BODAM_BETA_PUBLIC_ORIGIN 을 해석할 수 없다: ${rawOrigin}`);
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== rawOrigin.replace(/\/$/, '')) {
    throw new BetaConfigError('BODAM_BETA_PUBLIC_ORIGIN 은 스킴+호스트(+포트)만 담은 http(s) 출처여야 한다 (경로·쿼리·사용자 정보 없음)');
  }
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new BetaConfigError('http 출처는 루프백(127.0.0.1·localhost)에서만 쓴다. 공개 주소는 https 여야 한다');
  }

  const tokens = (env['BODAM_BETA_INVITE_TOKENS'] ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '');
  if (tokens.length === 0) {
    throw new BetaConfigError('BODAM_BETA_INVITE_TOKENS 가 필요하다 (초대 토큰 1개 이상). `npm run beta:invite` 로 만든다');
  }
  if (tokens.length > MAX_INVITES) {
    throw new BetaConfigError(`초대 토큰은 최대 ${MAX_INVITES}개다`);
  }
  if (new Set(tokens).size !== tokens.length) {
    throw new BetaConfigError('초대 토큰이 겹친다');
  }
  for (const token of tokens) {
    if (new Set(token).size < MIN_DISTINCT_CHARS) {
      throw new BetaConfigError(`초대 토큰은 서로 다른 글자가 ${MIN_DISTINCT_CHARS}종 이상이어야 한다 (반복·단순한 값 거절, 토큰 값은 출력하지 않는다). npm run beta:invite 로 만든다`);
    }
    if (!TOKEN_PATTERN.test(token)) {
      throw new BetaConfigError('초대 토큰은 32~128자의 [A-Za-z0-9_-] 여야 한다 (토큰 값은 출력하지 않는다)');
    }
  }

  const host = (env['BODAM_BETA_HOST'] ?? '127.0.0.1').trim();
  if (host === '') {
    throw new BetaConfigError('BODAM_BETA_HOST 가 비어 있다');
  }
  const portText = (env['PORT'] ?? env['BODAM_BETA_PORT'] ?? String(DEFAULT_PORT)).trim();
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new BetaConfigError(`포트가 올바르지 않다: ${portText}`);
  }

  const hoursText = (env['BODAM_BETA_SESSION_HOURS'] ?? String(DEFAULT_SESSION_HOURS)).trim();
  const hours = Number(hoursText);
  if (!Number.isInteger(hours) || hours < 1 || hours > 72) {
    throw new BetaConfigError(`BODAM_BETA_SESSION_HOURS 는 1~72 의 정수여야 한다: ${hoursText}`);
  }

  const today = (env['BODAM_BETA_TODAY'] ?? '').trim();
  if (today !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new BetaConfigError('BODAM_BETA_TODAY 는 YYYY-MM-DD 여야 한다');
  }

  const expires = (env['BODAM_BETA_EXPIRES_ON'] ?? '').trim();
  let expiresAtMs: number | null = null;
  if (expires !== '') {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(expires) ? Date.parse(`${expires}T23:59:59.999+09:00`) : Number.NaN;
    // 달력에 없는 날(2026-02-30 등)은 날짜가 밀리므로 한국 시간 날짜로 되돌려 같은지 본다.
    if (Number.isNaN(parsed) || new Date(parsed + 9 * 3_600_000).toISOString().slice(0, 10) !== expires) {
      throw new BetaConfigError('BODAM_BETA_EXPIRES_ON 은 실제 날짜 YYYY-MM-DD 여야 한다');
    }
    expiresAtMs = parsed;
  }

  return {
    host,
    port,
    publicOrigin: url.origin,
    allowedHost: url.host.toLowerCase(),
    secureCookie: url.protocol === 'https:',
    inviteTokens: tokens,
    sessionTtlMs: hours * 3_600_000,
    todayOverride: today === '' ? null : today,
    expiresOn: expires === '' ? null : expires,
    expiresAtMs,
  };
}
