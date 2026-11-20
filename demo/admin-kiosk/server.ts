import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createGate } from '../../beta/gate';
import { stripInternalHeaders } from '../../beta/handler';
import { createBetaServices } from '../../beta/world';
import { handleAdmin } from '../../src/server/admin/router';
import { createAdminServices } from '../../src/server/admin/services';
import { handleCatalog } from '../../src/server/api/catalog';
import { handleEstimate } from '../../src/server/api/estimate';
import { silentLog } from '../../src/server/api/log';
import { handleOptions } from '../../src/server/api/options';
import { previewFrameHtml, TEST_NOTICE } from '../../tests/e2e/harness/notice';
import { buildHarness, HARNESS_CLINIC_SLUG } from '../../tests/e2e/harness/world';
import { TEST_TODAY } from '../../tests/fixtures/server/api-composition.fixture';

// Local sample-data demonstration. No upstream, test mutation routes, or operating services.
const token = process.env.BODAM_DEMO_ADMIN_TOKEN;
if (token === undefined || !/^[A-Za-z0-9_-]{43}$/.test(token) || new Set(token).size < 12) {
  throw new Error('Set BODAM_DEMO_ADMIN_TOKEN to a fresh 32-byte base64url token. See demo/admin-kiosk/README.md.');
}
const portText = process.env.BODAM_DEMO_PORT ?? '3419';
const port = Number(portText);
if (!/^[0-9]{1,5}$/.test(portText) || port < 1024 || port > 65535) throw new Error('Invalid BODAM_DEMO_PORT');
const host = '127.0.0.1';
const origin = `http://${host}:${port}`;
const clinic = 'TEST_FIXTURE_CLINIC_1';
const kioskPath = `/kiosk/${HARNESS_CLINIC_SLUG}`;
const adminPath = `/admin/${clinic}/treatments`;
const historyPath = `/admin/${clinic}/change-history`;
const loginPath = '/demo/login';
const gate = createGate({ tokens: [token], ttlMs: 60 * 60_000, secure: false, now: Date.now });

const { world } = buildHarness();
const api = createBetaServices({ repo: world.repo, log: silentLog, today: () => TEST_TODAY });
const admin = createAdminServices({
  api,
  clock: { now: () => new Date().toISOString() },
  ids: { next: (prefix) => `${prefix}_${randomUUID()}` },
  authenticator: {
    async authenticate(request) {
      const userId = gate.check(request.headers.get('cookie') ?? undefined);
      return userId === null ? null : { userId, memberships: [{ clinicId: clinic, role: 'HA' }] };
    },
  },
  newTreatmentOrigin: 'TEST_FIXTURE',
});

Object.assign(process.env, { NODE_ENV: 'production' });
const { default: next } = await import('next');
const app = next({ dev: false, dir: fileURLToPath(new URL('../../', import.meta.url)), hostname: host, port });
await app.prepare();
const nextHandler = app.getRequestHandler();

const publicApi = /^\/api\/clinics\/test-fixture-clinic-1\/(catalog|insurance\/options|estimate)$/;
const catalogAdmin = /^\/api\/admin\/clinics\/TEST_FIXTURE_CLINIC_1\/(treatments|catalog\/(draft|preview|publish))$/;
const staticAsset = /^\/_next\/static\/[A-Za-z0-9_./%~-]+$/;
const accessHeaders = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN' };
const allowedAdmin = new Map<string, readonly string[]>([
  ['treatments', ['GET']], ['catalog/draft', ['PUT', 'DELETE']], ['catalog/preview', ['POST']], ['catalog/publish', ['POST']], ['audit-log', ['GET']],
]);

function reply(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { ...accessHeaders, 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

function json(res: ServerResponse, status: number, error: string): void {
  reply(res, status, JSON.stringify({ error }), { 'content-type': 'application/json; charset=utf-8' });
}

async function send(res: ServerResponse, result: Response): Promise<void> {
  reply(res, result.status, await result.text(), { 'content-type': result.headers.get('content-type') ?? 'application/json' });
}

function html(res: ServerResponse, content: string): void {
  reply(res, 200, content, { 'content-type': 'text/html; charset=utf-8' });
}

function menu(body: string): string {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>보담 관리자·키오스크 검증</title><body><main><h1>보담 관리자·키오스크 검증</h1><p role="note">${TEST_NOTICE}</p>${body}</main></body></html>`;
}

function redirect(res: ServerResponse, to: string, cookie?: string): void {
  reply(res, 303, '', { location: to, ...(cookie === undefined ? {} : { 'set-cookie': cookie }) });
}

class BodyTooLarge extends Error {}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer<ArrayBuffer>> {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = chunk as Buffer;
    length += bytes.length;
    if (length > maxBytes) {
      req.resume();
      throw new BodyTooLarge();
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.headers.host !== `${host}:${port}`) return json(res, 403, 'HOST_NOT_ALLOWED');
  const raw = req.url ?? '';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.split('?')[0]?.includes('\\')) return json(res, 400, 'INVALID_PATH');
  const url = new URL(raw, origin);
  const path = url.pathname;
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD' && req.headers.origin !== origin) return json(res, 403, 'ORIGIN_NOT_ALLOWED');

  if (path === '/demo/health' && method === 'GET') return reply(res, 200, 'ok');
  if (path === '/' && method === 'GET') {
    const signedIn = gate.check(req.headers.cookie) !== null;
    const action = signedIn ? adminPath : loginPath;
    const logout = signedIn ? '<form method="post" action="/demo/logout"><button>시험 관리자 로그아웃</button></form>' : '';
    return html(res, menu(`<ul><li><a href="${kioskPath}">시험 환자 키오스크 열기</a></li><li><a href="${action}">시험 관리자 화면 열기</a></li></ul>${logout}`));
  }
  if (path === loginPath) {
    if (method === 'GET') return html(res, menu(`<form method="post" action="${loginPath}"><label>시험 관리자 코드 <input type="password" name="code" required autocomplete="off"></label><button type="submit">관리자 로그인</button></form><p><a href="/">검증 메뉴로</a></p>`));
    if (method !== 'POST') return json(res, 405, 'METHOD_NOT_ALLOWED');
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/x-www-form-urlencoded')) return json(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    const code = new URLSearchParams((await readBody(req, 2048)).toString('utf8')).get('code');
    if (code === null || code.length !== 43) return json(res, 400, 'INVALID_REQUEST');
    const exchange = gate.exchange(code);
    if (!exchange.ok) return json(res, exchange.reason === 'THROTTLED' ? 429 : 401, 'LOGIN_REJECTED');
    return redirect(res, adminPath, exchange.setCookie);
  }
  if (path === '/demo/logout' && method === 'POST') return redirect(res, '/', gate.leave(req.headers.cookie));

  const adminMatch = catalogAdmin.exec(path);
  if (adminMatch !== null || path === '/api/admin/audit-log') {
    if (gate.check(req.headers.cookie) === null) return json(res, 401, 'UNAUTHENTICATED');
    const action = adminMatch?.[1] ?? 'audit-log';
    if (!allowedAdmin.get(action)?.includes(method)) return json(res, 405, 'METHOD_NOT_ALLOWED');
    const headers = new Headers();
    if (req.headers.cookie !== undefined) headers.set('cookie', req.headers.cookie);
    if (method === 'PUT' || method === 'POST') {
      if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return json(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
      headers.set('content-type', 'application/json');
    }
    const body = method === 'PUT' || method === 'POST' ? await readBody(req, 65_536) : undefined;
    const request = new Request(url, { method, headers, ...(body === undefined ? {} : { body }) });
    return send(res, await handleAdmin(admin, request, path.slice('/api/admin/'.length).split('/')));
  }

  const apiMatch = publicApi.exec(path);
  if (apiMatch !== null) {
    const action = apiMatch[1];
    if (action === 'catalog' && method === 'GET') return send(res, await handleCatalog(api, HARNESS_CLINIC_SLUG));
    if (action === 'insurance/options' && method === 'GET') return send(res, await handleOptions(api, HARNESS_CLINIC_SLUG));
    if (action === 'estimate' && method === 'POST') {
      const bytes = await readBody(req, 65_536);
      return send(res, await handleEstimate(api, HARNESS_CLINIC_SLUG, async () => JSON.parse(bytes.toString('utf8')) as unknown));
    }
    return json(res, 405, 'METHOD_NOT_ALLOWED');
  }

  if (path === adminPath || path === historyPath || path === kioskPath) {
    if (method !== 'GET') return json(res, 405, 'METHOD_NOT_ALLOWED');
    if (path !== kioskPath && gate.check(req.headers.cookie) === null) return redirect(res, loginPath);
    if (req.headers['sec-fetch-dest'] !== 'iframe') return html(res, previewFrameHtml(path));
    for (const [key, value] of Object.entries(accessHeaders)) res.setHeader(key, value);
    req.url = path;
    stripInternalHeaders(req);
    return nextHandler(req, res);
  }
  if ((method === 'GET' || method === 'HEAD') && staticAsset.test(path) && !path.includes('..') && !path.includes('//') && !/%(?:2e|2f|5c)/i.test(path)) {
    req.url = path;
    stripInternalHeaders(req);
    return nextHandler(req, res);
  }
  return json(res, 404, 'NOT_FOUND');
}

const server = createServer((req, res) => {
  void dispatch(req, res).catch((error: unknown) => {
    if (!res.headersSent) json(res, error instanceof BodyTooLarge ? 413 : 500, error instanceof BodyTooLarge ? 'BODY_TOO_LARGE' : 'INTERNAL_ERROR');
    else res.destroy();
  });
});
server.requestTimeout = 30_000;
server.listen(port, host, () => process.stdout.write(`시험용 보담: ${origin}/ (시험 관리자 코드는 출력하지 않습니다)\n`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
