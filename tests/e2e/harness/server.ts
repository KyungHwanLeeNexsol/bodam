import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleCatalog } from '../../../src/server/api/catalog';
import { handleEstimate } from '../../../src/server/api/estimate';
import { handleOptions } from '../../../src/server/api/options';
import { buildHarnessServices } from './world';

// 브라우저 시험의 "실제 핸들러" 층 (SPEC-REIMBURSEMENT-001 M6, BRIEF D12).
// 앞단 HTTP 서버: /api/clinics/* 는 src/server/api 의 실제 핸들러(handleCatalog·handleOptions·handleEstimate)가 시험 자료 서비스(TEST_FIXTURE)로 응답하고,
// 나머지(화면·정적 파일)는 운영 빌드한 Next 앱(next start)으로 그대로 넘긴다. 실제 핸들러의 논리를 시험 자료로 돌리는 것이며 운영 자료가 아니다.
// `node --import tests/fixtures/engine/ts-resolve-register.mjs tests/e2e/harness/server.ts --port 3102 --upstream http://127.0.0.1:3101` 로 띄운다.

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? (process.argv[index + 1] as string) : fallback;
}

const port = Number(argument('port', '3102'));
const upstream = argument('upstream', 'http://127.0.0.1:3101');
const services = buildHarnessServices();

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
