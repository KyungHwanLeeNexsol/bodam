import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleCatalog } from '../src/server/api/catalog';
import { handleEstimate } from '../src/server/api/estimate';
import { handleOptions } from '../src/server/api/options';
import type { ApiServices } from '../src/server/api/services';
import type { BetaConfig } from './config';
import type { Gate } from './gate';
import { ENTER_SCRIPT, blockedPage, endedPage, enterPage, indexPage, kioskFramePage, notFoundPage } from './pages';
import type { Page, ScenarioLink } from './pages';

// 베타 요청 처리. 키오스크 화면(Next)과 공개 계산 API 세 경로만 열고, 나머지는 모두 막는다.
//  순서: /healthz(Host 와 상관없이 ok) → Host 허용(틀리면 403) → 종료일(지나면 410) → (공개: /beta/enter · /beta/enter.js) → 초대 세션 확인(없으면 화면은 HTML 401 · /api/ 는 JSON 401, 메서드·경로가 있는지는 알려 주지 않는다)
//        → 지원하지 않는 메서드 405 → 허용 목록(/ · /kiosk/{병원} · /_next/static/** · 공개 API 세 경로 · /beta/leave) → 그 밖의 모든 경로 404.
//  - 관리자 화면·관리자 API·로그인(V0)·쓰기 API 는 이 처리기에 길이 없다. Next 로 넘기는 것은 /kiosk/{병원}(허용 병원만)과 /_next/static/** 뿐이다(빌드에도 관리자 라우트가 없다: beta/build.mjs).
//  - 병원 주소는 BETA 시나리오의 두 값만 받는다. 알 수 없는 병원은 Next 나 핸들러까지 가지 않고 404 다.
//  - 두 모드: 환자 모드(기본, config.reviewMode=false)는 `/` 가 첫 병원의 키오스크 시작 화면으로 302 이고, 키오스크 문서는 틀 없이 앱을 그대로 내보내며(X-Frame-Options DENY), 서버가 만드는 화면에 띠가 없다.
//    검토 모드(reviewMode=true)는 아래 설명대로 목록·띠·틀을 보여 준다. 두 모드 모두 초대 검사·허용 목록·메서드·종료일 규칙은 같다(초대 없으면 401).
//  - (검토 모드) 키오스크 문서는 "최상위 이동이면 시험 데이터 띠가 든 틀, iframe 안의 요청이면 앱"이다. iframe 여부는 Sec-Fetch-Dest 로 보고, 그 헤더가 없는 브라우저는 Referer 가 같은 출처의 같은 경로일 때만 앱으로 본다.
//    어느 쪽도 아니면 틀이다. 이것은 브라우저 수준의 보장이다: 초대받은 클라이언트가 Sec-Fetch-Dest: iframe 헤더를 직접 보내면 띠 없는 앱 문서를 받을 수 있다(띠는 보안 통제가 아니라 표시 장치다).
//  - 쓰기(POST) 요청은 Origin 이 공개 출처와 정확히 같아야 한다(쿠키만 믿지 않는다). 본문은 64KiB(입장은 2KiB)까지만 읽는다.
//  - 로그에는 메서드·경로(쿼리 제외)·상태·검토자 이름만 남긴다. 토큰·쿠키·본문·쿼리는 남기지 않는다.

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_ENTER_BODY_BYTES = 2 * 1024;

const SUPPORTED_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']);
const KIOSK = /^\/kiosk\/([A-Za-z0-9._~-]{1,64})$/;
const STATIC = /^\/_next\/static\/[A-Za-z0-9_\-./@]+$/;
const PUBLIC_API = /^\/api\/clinics\/([A-Za-z0-9._~-]{1,64})\/(catalog|insurance\/options|estimate)$/;

export type NextHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

export interface BetaHandlerOptions {
  config: Pick<BetaConfig, 'publicOrigin' | 'allowedHost'> & Partial<Pick<BetaConfig, 'expiresOn' | 'expiresAtMs' | 'reviewMode'>>;
  /** 현재 시각(epoch 밀리초). 기본은 시스템 시계이고 시험이 바꾼다. */
  now?: () => number;
  gate: Gate;
  services: ApiServices;
  scenarios: readonly ScenarioLink[];
  nextHandler: NextHandler;
  log?: (line: string) => void;
}

function writePage(response: ServerResponse, page: Page): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(page.status, page.headers);
  response.end(page.body);
}

function finish(response: ServerResponse, status: number, headers: Record<string, string | string[]>, body: string): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(status, headers);
  response.end(body);
}

const NO_STORE = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

function plain(response: ServerResponse, status: number, text: string): void {
  finish(response, status, { ...NO_STORE, 'content-type': 'text/plain; charset=utf-8' }, text);
}

function json(response: ServerResponse, status: number, body: unknown, extra: Record<string, string | string[]> = {}): void {
  finish(response, status, { ...NO_STORE, 'content-type': 'application/json', ...extra }, JSON.stringify(body));
}

async function send(response: ServerResponse, result: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  result.headers.forEach((value, key) => {
    // 본문은 fetch 가 이미 풀어 준 것이라 길이·압축·연결 헤더는 다시 쓰지 않는다.
    if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'].includes(key)) headers[key] = value;
  });
  headers['x-content-type-options'] = 'nosniff';
  response.writeHead(result.status, headers);
  response.end(Buffer.from(await result.arrayBuffer()));
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw new Error('BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** iframe 안의 요청(앱 문서)인가. 확신할 수 없으면 false(틀을 돌려준다). */
export function isInnerDocument(headers: IncomingMessage['headers'], publicOrigin: string, path: string): boolean {
  const dest = headers['sec-fetch-dest'];
  if (typeof dest === 'string') return dest === 'iframe';
  const referer = headers['referer'];
  if (typeof referer !== 'string') return false;
  try {
    const url = new URL(referer);
    return url.origin === publicOrigin && url.pathname === path;
  } catch {
    return false;
  }
}

/** Next 가 내부 전달용으로 읽는 헤더(미들웨어·호출·경로 일치 값)는 바깥 요청에서 온 것을 지운다. 초대받은 사람만 보낼 수 있지만, 앱 처리기가 그 값을 믿게 두지 않는다. */
export function stripInternalHeaders(request: IncomingMessage): void {
  for (const key of Object.keys(request.headers)) {
    if (/^(x-middleware-|x-invoke-)/.test(key) || key === 'x-matched-path' || key === 'x-now-route-matches') delete request.headers[key];
  }
}

export const STATIC_CACHE_CONTROL = 'private, max-age=31536000, immutable';

/**
 * Next 가 쓰는 응답 헤더를 다듬는다. X-Powered-By 는 내보내지 않고, 정적 파일의 Cache-Control 은 공유 캐시(CDN·프록시)가 저장하지 못하게 private 로 바꾼다:
 * 앞단에 캐시가 있어도 세션 없이 캐시된 파일이 나가는 길을 막는다(브라우저 캐시는 그대로 쓴다). 오류 응답(404 등)은 no-store 다. Next 가 setHeader 로 쓰는 헤더만 가로챈다.
 */
export function shieldNextResponse(response: ServerResponse, staticAsset: boolean): void {
  const original = response.setHeader.bind(response);
  response.setHeader = ((name: string, value: number | string | readonly string[]): ServerResponse => {
    const key = name.toLowerCase();
    if (key === 'x-powered-by') return response;
    // 정적 파일의 Cache-Control 은 아래 writeHead 가 상태 코드를 보고 정한다(Next 가 쓴 값은 버린다).
    if (staticAsset && key === 'cache-control') return response;
    return original(name, value);
  }) as ServerResponse['setHeader'];
  if (staticAsset) {
    original('vary', 'Cookie');
    const originalWriteHead = response.writeHead.bind(response) as (...args: unknown[]) => ServerResponse;
    response.writeHead = ((status: number, ...rest: unknown[]): ServerResponse => {
      // 성공(2xx)·변경 없음(304)만 1년 private 캐시. 없는 파일(404) 같은 오류 응답은 브라우저가 저장하지 못하게 no-store 다.
      original('cache-control', (status >= 200 && status < 300) || status === 304 ? STATIC_CACHE_CONTROL : 'no-store');
      return originalWriteHead(status, ...rest);
    }) as ServerResponse['writeHead'];
  }
}

function printable(path: string): string {
  return path.replace(/[^\x20-\x7e]/g, '?').slice(0, 200);
}

export function createBetaHandler(options: BetaHandlerOptions): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const { gate, services, nextHandler } = options;
  const publicOrigin = options.config.publicOrigin;
  const allowedHost = options.config.allowedHost;
  const slugs: ReadonlySet<string> = new Set(options.scenarios.map((scenario) => scenario.slug));
  const log = options.log ?? ((): void => undefined);
  const now = options.now ?? ((): number => Date.now());
  const expiresAtMs = options.config.expiresAtMs ?? null;
  const expiresOn = options.config.expiresOn ?? null;
  const review = options.config.reviewMode === true;
  const startSlug = (options.scenarios[0] as ScenarioLink).slug;

  return async (request, response) => {
    const method = request.method ?? 'GET';
    const rawPath = (request.url ?? '').split('?')[0] ?? '';
    let reviewer = '-';
    response.on('finish', () => log(`${method} ${printable(rawPath)} ${response.statusCode} ${reviewer}`));
    try {
      // /healthz 는 Host·종료일과 상관없이 답한다: 호스팅의 상태 확인 요청이 공개 주소를 Host 로 싣지 않을 수 있다. "ok" 한 줄뿐이라 노출되는 것이 없다.
      if (rawPath === '/healthz') {
        if (method === 'GET' || method === 'HEAD') plain(response, 200, method === 'HEAD' ? '' : 'ok');
        else json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
        return;
      }
      if ((request.headers.host ?? '').toLowerCase() !== allowedHost) {
        plain(response, 403, 'host not allowed');
        return;
      }
      // 접속 종료일이 지나면 /healthz(호스팅의 상태 확인) 말고는 모든 요청이 410 이다. 입장·화면·API·정적 파일 모두 같다.
      if (expiresAtMs !== null && now() > expiresAtMs && rawPath !== '/healthz') {
        if (rawPath.startsWith('/api/')) json(response, 410, { error: 'BETA_ENDED' });
        else writePage(response, endedPage(expiresOn, review));
        return;
      }
      const originOk = request.headers.origin === publicOrigin;

      // --- 공개 경로(초대 없이): 상태 확인, 입장 화면·스크립트, 토큰 교환. 병원 자료를 담지 않는다. ---
      if (rawPath === '/beta/enter.js') {
        if (method !== 'GET') {
          json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
          return;
        }
        finish(response, 200, { ...NO_STORE, 'content-type': 'text/javascript; charset=utf-8' }, ENTER_SCRIPT);
        return;
      }
      if (rawPath === '/beta/enter') {
        if (method === 'GET') {
          writePage(response, enterPage(review));
          return;
        }
        if (method !== 'POST') {
          json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
          return;
        }
        if (!originOk) {
          json(response, 403, { error: 'ORIGIN_NOT_ALLOWED' });
          return;
        }
        let token: unknown;
        try {
          token = (JSON.parse((await readBody(request, MAX_ENTER_BODY_BYTES)).toString('utf8')) as { token?: unknown }).token;
        } catch {
          json(response, 400, { error: 'INVALID_REQUEST' });
          return;
        }
        if (typeof token !== 'string' || token.length === 0 || token.length > 200) {
          json(response, 400, { error: 'INVALID_REQUEST' });
          return;
        }
        const result = gate.exchange(token);
        if (result.ok) {
          reviewer = result.reviewer;
          finish(response, 204, { ...NO_STORE, 'set-cookie': result.setCookie }, '');
        } else if (result.reason === 'THROTTLED') {
          json(response, 429, { error: 'TOO_MANY_ATTEMPTS' });
        } else {
          json(response, 401, { error: 'INVALID_INVITE' });
        }
        return;
      }

      // --- 초대 세션 확인: 이 아래의 모든 경로(화면·정적 파일·API·없는 경로 포함)는 세션이 있어야 한다. ---
      const who = gate.check(request.headers.cookie);
      if (who === null) {
        if (rawPath.startsWith('/api/')) json(response, 401, { error: 'INVITE_REQUIRED' });
        else writePage(response, blockedPage(review));
        return;
      }
      reviewer = who;
      // 지원하지 않는 메서드(TRACE 등)는 초대 확인 뒤에 거절한다: 초대 없는 요청은 메서드와 상관없이 같은 401 이다.
      if (!SUPPORTED_METHODS.has(method)) {
        json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
        return;
      }

      if (rawPath === '/') {
        if (method !== 'GET') json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
        else if (review) writePage(response, indexPage(options.scenarios));
        else finish(response, 302, { ...NO_STORE, location: `/kiosk/${encodeURIComponent(startSlug)}` }, '');
        return;
      }
      if (rawPath === '/beta/leave') {
        if (method !== 'POST') {
          json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
          return;
        }
        if (!originOk) {
          json(response, 403, { error: 'ORIGIN_NOT_ALLOWED' });
          return;
        }
        finish(response, 303, { ...NO_STORE, location: '/beta/enter', 'set-cookie': gate.leave(request.headers.cookie) }, '');
        return;
      }

      const kiosk = KIOSK.exec(rawPath);
      if (kiosk !== null) {
        if (!slugs.has(kiosk[1] as string)) {
          writePage(response, notFoundPage(review));
          return;
        }
        if (method !== 'GET') {
          json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
          return;
        }
        if (review && !isInnerDocument(request.headers, publicOrigin, rawPath)) {
          writePage(response, kioskFramePage(rawPath));
          return;
        }
        response.setHeader('x-frame-options', review ? 'SAMEORIGIN' : 'DENY');
        response.setHeader('referrer-policy', 'same-origin');
        response.setHeader('x-content-type-options', 'nosniff');
        response.setHeader('x-robots-tag', 'noindex, nofollow');
        stripInternalHeaders(request);
        shieldNextResponse(response, false);
        await nextHandler(request, response);
        return;
      }

      if (STATIC.test(rawPath) && !rawPath.includes('..') && !rawPath.includes('//')) {
        if (method !== 'GET') {
          json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
          return;
        }
        response.setHeader('x-content-type-options', 'nosniff');
        stripInternalHeaders(request);
        shieldNextResponse(response, true);
        await nextHandler(request, response);
        return;
      }

      const api = PUBLIC_API.exec(rawPath);
      if (api !== null) {
        const slug = api[1] as string;
        const kind = api[2];
        if (!slugs.has(slug)) {
          json(response, 404, { error: 'NOT_FOUND' });
          return;
        }
        if (kind === 'catalog' && method === 'GET') {
          await send(response, await handleCatalog(services, slug));
          return;
        }
        if (kind === 'insurance/options' && method === 'GET') {
          await send(response, await handleOptions(services, slug));
          return;
        }
        if (kind === 'estimate' && method === 'POST') {
          if (!originOk) {
            json(response, 403, { error: 'ORIGIN_NOT_ALLOWED' });
            return;
          }
          await send(
            response,
            await handleEstimate(services, slug, async () => JSON.parse((await readBody(request, MAX_BODY_BYTES)).toString('utf8')) as unknown),
          );
          return;
        }
        json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
        return;
      }

      if (rawPath.startsWith('/api/')) json(response, 404, { error: 'NOT_FOUND' });
      else writePage(response, notFoundPage(review));
    } catch {
      json(response, 500, { error: 'INTERNAL_ERROR' });
    }
  };
}
