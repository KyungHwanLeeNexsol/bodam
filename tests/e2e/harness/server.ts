import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleAdmin } from '../../../src/server/admin/router';
import { handleCatalog } from '../../../src/server/api/catalog';
import { handleEstimate } from '../../../src/server/api/estimate';
import { handleOptions } from '../../../src/server/api/options';
import { TEST_ACCOUNTS, TEST_SESSION_COOKIE } from '../../fixtures/server/admin.fixture';
import type { TestAccountKey } from '../../fixtures/server/admin.fixture';
import { ACCOUNT_KEYS, loginPageHtml } from './login';
import { previewFrameHtml } from './notice';
import { buildHarness } from './world';

// 브라우저 시험의 "실제 핸들러" 층 (SPEC-REIMBURSEMENT-001 M6, BRIEF D12). M7 첫 기능부터 /api/admin/* 도 같은 앞단이 실제 관리자 핸들러(handleAdmin)로 처리하고(시험 인증기·시험 로그인은 tests/ 에만 있다) 공개 API 와 같은 저장소를 쓴다.
// 앞단 HTTP 서버: /api/clinics/* 는 src/server/api 의 실제 핸들러(handleCatalog·handleOptions·handleEstimate)가 시험 자료 서비스(TEST_FIXTURE)로 응답하고,
// 나머지(화면·정적 파일)는 운영 빌드한 Next 앱(next start)으로 그대로 넘긴다. 실제 핸들러의 논리를 시험 자료로 돌리는 것이며 운영 자료가 아니다.
// `node --import tests/fixtures/engine/ts-resolve-register.mjs tests/e2e/harness/server.ts --port 3102 --upstream http://127.0.0.1:3101` 로 띄운다.

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? (process.argv[index + 1] as string) : fallback;
}

const port = Number(argument('port', '3102'));
const upstream = argument('upstream', 'http://127.0.0.1:3101');
// --test-notice: 사람이 보는 미리보기 전용. 브라우저가 키오스크 문서(/kiosk/…)를 화면으로 열 때만 고정 안내 띠 + 앱 틀을 돌려준다(notice.ts).
// 이 옵션이 없으면(자동 시험의 실제 핸들러 층 포함) 앞단은 문서를 손대지 않고 그대로 넘긴다.
const testNotice = process.argv.includes('--test-notice');
const { services, admin, authenticator } = buildHarness();

const API_PATH = /^\/api\/clinics\/([^/]+)\/(catalog|insurance\/options|estimate)$/;

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function send(response: ServerResponse, result: Response): Promise<void> {
  const headers: Record<string, string> = {};
  result.headers.forEach((value, key) => {
    // fetch 가 이미 풀어 준 본문이라 압축·길이·연결 관련 헤더는 다시 쓰지 않는다.
    if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) headers[key] = value;
  });
  response.writeHead(result.status, headers);
  response.end(Buffer.from(await result.arrayBuffer()));
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://harness.local');
  if (url.pathname === '/__harness/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }
  // 시험 로그인(시험 앞단 전용): 계정을 고르면 서버의 세션 표에 세션을 만들고 HttpOnly 쿠키로 토큰을 내려 준다. 관리자 API 는 이 쿠키가 가리키는 세션의 신원으로만 판정한다.
  if (url.pathname === '/__harness/login' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(loginPageHtml());
    return;
  }
  if (url.pathname === '/__harness/login' && request.method === 'POST') {
    const account = new URLSearchParams((await readBody(request)).toString('utf8')).get('account') ?? '';
    if (!(ACCOUNT_KEYS as string[]).includes(account)) {
      response.writeHead(400, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      response.end('unknown test account');
      return;
    }
    const token = authenticator.login(account as TestAccountKey);
    response.writeHead(303, {
      location: `/admin/${encodeURIComponent(TEST_ACCOUNTS[account as TestAccountKey].home)}/treatments`,
      'set-cookie': `${TEST_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`,
      'cache-control': 'no-store',
    });
    response.end();
    return;
  }
  if (url.pathname === '/__harness/logout' && request.method === 'POST') {
    const cookie = request.headers.cookie ?? '';
    const token = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${TEST_SESSION_COOKIE}=`))?.slice(TEST_SESSION_COOKIE.length + 1);
    if (token !== undefined) authenticator.logout(token);
    response.writeHead(303, { location: '/__harness/login', 'set-cookie': `${TEST_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`, 'cache-control': 'no-store' });
    response.end();
    return;
  }
  // 관리자 API: 실제 핸들러(handleAdmin)가 시험 인증기·시험 자료 서비스로 응답한다. 공개 API 와 같은 저장소를 쓴다.
  if (url.pathname.startsWith('/api/admin/')) {
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const webRequest = new Request(new URL(url.pathname + url.search, 'http://harness.local'), {
      method: request.method ?? 'GET',
      headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, String(value)])),
      ...(hasBody ? { body: new Uint8Array(await readBody(request)) } : {}),
    });
    const segments = url.pathname.slice('/api/admin/'.length).split('/').filter((part) => part !== '').map(decodeURIComponent);
    return send(response, await handleAdmin(admin, webRequest, segments));
  }
  const api = API_PATH.exec(url.pathname);
  if (api !== null) {
    const slug = decodeURIComponent(api[1] as string);
    const kind = api[2];
    if (kind === 'catalog' && request.method === 'GET') return send(response, await handleCatalog(services, slug));
    if (kind === 'insurance/options' && request.method === 'GET') return send(response, await handleOptions(services, slug));
    if (kind === 'estimate' && request.method === 'POST') {
      const raw = await readBody(request);
      return send(response, await handleEstimate(services, slug, () => Promise.resolve(JSON.parse(raw.toString('utf8')) as unknown)));
    }
    response.writeHead(405, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end('{"error":"METHOD_NOT_ALLOWED"}');
    return;
  }
  // 최상위 문서로 열 때(Sec-Fetch-Dest: document)만 틀을 돌려준다. 틀 안 iframe 의 요청은 'iframe', API·스크립트·curl 은 헤더가 없거나 다르므로 앱 문서가 그대로 간다.
  if (testNotice && request.method === 'GET' && (url.pathname.startsWith('/kiosk/') || url.pathname === '/admin' || url.pathname.startsWith('/admin/')) && request.headers['sec-fetch-dest'] === 'document') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(previewFrameHtml(url.pathname + url.search));
    return;
  }
  const forwarded = await fetch(new URL(url.pathname + url.search, upstream), {
    method: request.method ?? 'GET',
    headers: Object.fromEntries(Object.entries(request.headers).filter(([key]) => !['host', 'connection', 'accept-encoding'].includes(key)).map(([key, value]) => [key, String(value)])),
    ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: new Uint8Array(await readBody(request)) }),
    redirect: 'manual',
  });
  return send(response, forwarded);
}

createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    response.writeHead(502, { 'content-type': 'text/plain' });
    response.end(`harness error: ${String(error)}`);
  });
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`harness listening on ${port} -> ${upstream}\n`);
});
