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
import { PRESENTATION_NOTICE, previewFrameHtml, TEST_NOTICE } from '../../tests/e2e/harness/notice';
import { buildHarness, HARNESS_CLINIC_SLUG } from '../../tests/e2e/harness/world';
import { TEST_TODAY } from '../../tests/fixtures/server/api-composition.fixture';

// Sample-data demonstration. No upstream, test mutation routes, or operating services.
// Public hosting requires both Render's runtime marker and the explicit demo flag.
const hosted = process.env.BODAM_DEMO_RENDER === '1';
if (hosted && process.env.RENDER !== 'true') throw new Error('Hosted demonstration is only allowed on Render.');
const token = process.env.BODAM_DEMO_ADMIN_TOKEN;
const tokenPattern = hosted ? /^[A-Za-z0-9+/]{43}=$/ : /^[A-Za-z0-9_-]{43}$/;
if (token === undefined || !tokenPattern.test(token) || new Set(token).size < 12) {
  throw new Error('Set BODAM_DEMO_ADMIN_TOKEN to a fresh 32-byte token. See demo/admin-kiosk/README.md.');
}
const portText = hosted ? (process.env.PORT ?? '10000') : (process.env.BODAM_DEMO_PORT ?? '3419');
const port = Number(portText);
if (!/^[0-9]{1,5}$/.test(portText) || port < 1024 || port > 65535) throw new Error('Invalid BODAM_DEMO_PORT');
const host = hosted ? '0.0.0.0' : '127.0.0.1';
const origin = hosted ? (process.env.RENDER_EXTERNAL_URL ?? '') : `http://${host}:${port}`;
if (hosted && !/^https:\/\/[a-z0-9][a-z0-9-]*\.onrender\.com$/.test(origin)) throw new Error('Hosted demo requires its Render HTTPS URL.');
const approvedHost = new URL(origin).host;
const clinic = 'TEST_FIXTURE_CLINIC_1';
const kioskPath = `/kiosk/${HARNESS_CLINIC_SLUG}`;
const adminPath = `/admin/${clinic}/treatments`;
const historyPath = `/admin/${clinic}/change-history`;
const loginPath = '/demo/login';
const presenterPath = '/demo/present';
const presenterLogin = `${loginPath}?next=present`;
const presenterHeader = 'x-bodam-presenter-view';
const gate = createGate({ tokens: [token], ttlMs: 60 * 60_000, secure: hosted, now: Date.now });

const { world } = buildHarness(hosted ? {
  treatmentPresentation: {
    first: { name: '물리치료', description: '기본 물리치료' },
    second: { name: '근골격계 초음파 검사', description: '관절 및 주변 조직을 확인하는 검사' },
  },
} : {});
if (hosted) {
  const demoClinic = world.repo.getClinic(clinic);
  if (demoClinic === null) throw new Error('Demo clinic is missing');
  world.repo.saveClinic({ ...demoClinic, name: '보담의원' });
}
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

// Restartable hosted baseline: publish one price edit through the same draft,
// preview, and publish services before accepting traffic. The seed identity is
// private to this startup block, never a header, account, or HTTP endpoint.
if (hosted) {
  const seedAdmin: typeof admin = { ...admin, authenticator: { async authenticate() {
    return { userId: 'demo-seed', memberships: [{ clinicId: clinic, role: 'HA' }] };
  } } };
  const read = await handleCatalog(api, HARNESS_CLINIC_SLUG);
  const { treatments } = (await read.json()) as { treatments?: { treatmentId: string; patientAmount: number }[] };
  const first = treatments?.[0];
  if (!read.ok || first === undefined || first.patientAmount !== 10_000) throw new Error('Demo seed catalog is not the expected fixture');
  async function seed(method: 'PUT' | 'POST', action: string, body: unknown): Promise<Response> {
    const path = ['clinics', clinic, 'catalog', action];
    const result = await handleAdmin(seedAdmin, new Request(`${origin}/api/admin/${path.join('/')}`, {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }), path);
    if (!result.ok) throw new Error(`Demo seed ${action} failed with status ${result.status}`);
    return result;
  }
  await seed('PUT', 'draft', { priceEdits: [{ treatmentId: first.treatmentId, patientAmount: 12_000 }] });
  const preview = await seed('POST', 'preview', {
    generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds: [first.treatmentId],
  });
  const result = (await preview.json()) as { publishConfirmation?: string; after?: { result?: { amounts?: { hospitalPayment?: number } } } };
  if (typeof result.publishConfirmation !== 'string' || result.after?.result?.amounts?.hospitalPayment !== 17_000) {
    throw new Error('Demo seed did not produce the expected preview');
  }
  await seed('POST', 'publish', { publishConfirmation: result.publishConfirmation });
}

Object.assign(process.env, { NODE_ENV: 'production' });
const { default: next } = await import('next');
const app = next({ dev: false, dir: fileURLToPath(new URL('../../', import.meta.url)), hostname: host, port });
await app.prepare();
const nextHandler = app.getRequestHandler();

const publicApi = /^\/api\/clinics\/test-fixture-clinic-1\/(catalog|insurance\/options|estimate)$/;
const catalogAdmin = /^\/api\/admin\/clinics\/TEST_FIXTURE_CLINIC_1\/(treatments|catalog\/(draft|preview|publish))$/;
const staticAsset = /^\/_next\/static\/[A-Za-z0-9_./%~-]+$/;
const accessHeaders = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN', 'referrer-policy': 'same-origin' };
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
  reply(res, 200, content, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; frame-ancestors 'self'; form-action 'self'; base-uri 'none'" });
}

function menu(body: string): string {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>보담 관리자·키오스크 검증</title><body><main><h1>보담 관리자·키오스크 검증</h1><p role="note">${hosted ? PRESENTATION_NOTICE : TEST_NOTICE}</p>${body}</main></body></html>`;
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
  const raw = req.url ?? '';
  const method = req.method ?? 'GET';
  // Only the fixed probe path can answer a health request with a different Host.
  if (raw === '/demo/health' && method === 'GET') return reply(res, 200, 'ok');
  if (req.headers.host !== approvedHost) return json(res, 403, 'HOST_NOT_ALLOWED');
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.split('?')[0]?.includes('\\')) return json(res, 400, 'INVALID_PATH');
  const url = new URL(raw, origin);
  const path = url.pathname;
  // This marker is set only below, after checking the presenter session.
  delete req.headers[presenterHeader];
  if (method !== 'GET' && method !== 'HEAD' && req.headers.origin !== origin) return json(res, 403, 'ORIGIN_NOT_ALLOWED');

  if (hosted && path === '/' && method === 'GET') return redirect(res, kioskPath);
  if ((path === '/' || path === '/demo') && method === 'GET') {
    const signedIn = gate.check(req.headers.cookie) !== null;
    const action = signedIn ? adminPath : loginPath;
    const logout = signedIn ? '<form method="post" action="/demo/logout"><button>시험 관리자 로그아웃</button></form>' : '';
    const presenterLink = hosted ? `<li><a href="${presenterPath}">발표 화면 열기</a></li>` : '';
    return html(res, menu(`<ul><li><a href="${kioskPath}">시험 환자 키오스크 열기</a></li><li><a href="${action}">시험 관리자 화면 열기</a></li>${presenterLink}</ul>${logout}`));
  }
  if (path === loginPath) {
    const presenting = hosted && url.searchParams.get('next') === 'present';
    const loginAction = presenting ? presenterLogin : loginPath;
    if (method === 'GET') return html(res, menu(`<form method="post" action="${loginAction}"><label>시험 관리자 코드 <input type="password" name="code" required autocomplete="off"></label><button type="submit">${presenting ? '발표 화면 열기' : '관리자 로그인'}</button></form><p><a href="/demo">검증 메뉴로</a></p>`));
    if (method !== 'POST') return json(res, 405, 'METHOD_NOT_ALLOWED');
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/x-www-form-urlencoded')) return json(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    const code = new URLSearchParams((await readBody(req, 2048)).toString('utf8')).get('code');
    if (code === null || !tokenPattern.test(code)) return json(res, 400, 'INVALID_REQUEST');
    const exchange = gate.exchange(code);
    if (!exchange.ok) return json(res, exchange.reason === 'THROTTLED' ? 429 : 401, 'LOGIN_REJECTED');
    return redirect(res, presenting ? presenterPath : adminPath, exchange.setCookie);
  }
  if (path === '/demo/logout' && method === 'POST') return redirect(res, '/demo', gate.leave(req.headers.cookie));

  if (hosted && path === presenterPath) {
    if (method !== 'GET') return json(res, 405, 'METHOD_NOT_ALLOWED');
    if (gate.check(req.headers.cookie) === null) return redirect(res, presenterLogin);
    for (const [key, value] of Object.entries(accessHeaders)) res.setHeader(key, value);
    res.setHeader('vary', 'Cookie');
    req.url = kioskPath;
    stripInternalHeaders(req);
    req.headers[presenterHeader] = '1';
    return nextHandler(req, res);
  }

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
      if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return json(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
      const bytes = await readBody(req, 65_536);
      return send(res, await handleEstimate(api, HARNESS_CLINIC_SLUG, async () => JSON.parse(bytes.toString('utf8')) as unknown));
    }
    return json(res, 405, 'METHOD_NOT_ALLOWED');
  }

  if (path === adminPath || path === historyPath || path === kioskPath) {
    if (method !== 'GET') return json(res, 405, 'METHOD_NOT_ALLOWED');
    if (path !== kioskPath && gate.check(req.headers.cookie) === null) return redirect(res, loginPath);
    if (req.headers['sec-fetch-dest'] !== 'iframe') return html(res, previewFrameHtml(path, hosted));
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
