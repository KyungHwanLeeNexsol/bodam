import { expect } from '@playwright/test';
import type { Page, Request } from '@playwright/test';
import { writeEvidenceFile } from './evidence';
import { MARKER_PREFIX, findUuids } from './ids';
import type { StorageDump } from './storage';

// 시험 자료(TEST_FIXTURE). 환자 상태 노출 감사 도구 (S4 C, AC-016a·AC-016b·AC-016k·AC-016l·AC-016m): 한 흐름 동안
//  - 브라우저가 내보낸 요청 전부(주소·머리글·본문·종류), 콘솔 메시지 전부, 페이지가 부른 fetch·sendBeacon·XHR·WebSocket·EventSource, 저장소 쓰기 호출을 모으고,
//  - 흐름 전·중·후의 영속 저장소 덤프를 파일로 남기고(환경 변수 KIOSK_E2E_EVIDENCE_DIR 이 있을 때만, 그 폴더의 exposure/),금지된 곳에 환자 선택·결과 값·식별자가 없음을 본다.
// 계산 요청의 본문(여섯 필드)은 환자 선택을 서버에 보내는 정상 경로라 예외로 두고 그 밖의 모든 곳을 본다.

export interface PageSideLog {
  readonly fetches: Array<{ url: string; method: string }>;
  readonly beacons: string[];
  readonly xhr: string[];
  readonly sockets: string[];
  readonly storageWrites: string[];
}

export interface SeenRequest {
  readonly url: string;
  readonly method: string;
  readonly resourceType: string;
  readonly headers: Record<string, string>;
  readonly postData: string | null;
}

export interface Exposure {
  readonly requests: SeenRequest[];
  readonly console: Array<{ type: string; text: string }>;
  pageSide(): Promise<PageSideLog>;
}

/** 페이지에 감시를 건다(goto 전에 부른다): 저장소 쓰기·네트워크 API 호출을 센다. 운영 코드에는 이런 훅이 없다. */
export async function watchExposure(page: Page): Promise<Exposure> {
  await page.addInitScript(() => {
    const log = { fetches: [] as Array<{ url: string; method: string }>, beacons: [] as string[], xhr: [] as string[], sockets: [] as string[], storageWrites: [] as string[] };
    (window as unknown as { __exposure: typeof log }).__exposure = log;

    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      log.fetches.push({ url, method: (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase() });
      return originalFetch(input, init);
    }) as typeof window.fetch;

    const originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = ((url: string | URL, data?: BodyInit | null) => {
      log.beacons.push(String(url));
      return originalBeacon(url, data);
    }) as typeof navigator.sendBeacon;

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      log.xhr.push(`${method} ${String(url)}`);
      return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;

    for (const name of ['WebSocket', 'EventSource'] as const) {
      const Original = window[name] as unknown as new (url: string | URL, ...rest: unknown[]) => object;
      (window as unknown as Record<string, unknown>)[name] = class extends Original {
        constructor(url: string | URL, ...rest: unknown[]) {
          log.sockets.push(`${name} ${String(url)}`);
          super(url, ...rest);
        }
      };
    }

    for (const method of ['setItem', 'removeItem', 'clear'] as const) {
      const original = Storage.prototype[method] as (...args: unknown[]) => unknown;
      Storage.prototype[method] = function (this: Storage, ...args: unknown[]) {
        log.storageWrites.push(`Storage.${method}`);
        return original.apply(this, args);
      } as never;
    }
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (cookie?.set !== undefined) {
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => cookie.get?.call(document) as string,
        set: (value: string) => {
          log.storageWrites.push('document.cookie');
          cookie.set?.call(document, value);
        },
      });
    }
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = ((...args: Parameters<IDBFactory['open']>) => {
      log.storageWrites.push('indexedDB.open');
      return open(...args);
    }) as IDBFactory['open'];
    const cachesOpen = caches.open.bind(caches);
    caches.open = ((name: string) => {
      log.storageWrites.push('caches.open');
      return cachesOpen(name);
    }) as CacheStorage['open'];
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = ((...args: Parameters<ServiceWorkerContainer['register']>) => {
      log.storageWrites.push('serviceWorker.register');
      return register(...args);
    }) as ServiceWorkerContainer['register'];
  });

  const requests: SeenRequest[] = [];
  const consoleMessages: Array<{ type: string; text: string }> = [];
  page.on('request', (request: Request) => {
    requests.push({ url: request.url(), method: request.method(), resourceType: request.resourceType(), headers: request.headers(), postData: request.postData() });
  });
  page.on('console', (message) => {
    consoleMessages.push({ type: message.type(), text: message.text() });
  });
  return {
    requests,
    console: consoleMessages,
    pageSide: () => page.evaluate(() => (window as unknown as { __exposure: PageSideLog }).__exposure),
  };
}

/** 환경 변수 KIOSK_E2E_EVIDENCE_DIR 이 있을 때만 그 폴더의 exposure/ 에 쓴다(없으면 아무것도 쓰지 않는다). */
export function writeEvidence(file: string, data: unknown): void {
  writeEvidenceFile(`exposure/${file}`, data);
}

export const API_PATH = /\/api\/clinics\/[^/]+\/(catalog|insurance\/options|estimate)$/;

/** 환자 선택·결과가 드러나는 값(세대·형태·원인 코드, 치료 id, 시험 자료의 금액). 계산 요청 본문 밖 어디에도 있으면 안 된다. */
export const PATIENT_TOKENS: readonly string[] = ['GEN1_AS', 'GEN2_C1', 'GEN2_5_C2', 'GEN3_C3', 'GEN4_C4', 'NON_LIFE', 'MUTUAL_AID', 'INJURY', 'ILLNESS', 'TEST_FIXTURE_TREATMENT', '124000', '124,000', '114000', '114,000'];

export interface ExposureVerdict {
  readonly nonApiRequests: string[];
  readonly apiRequests: Array<{ method: string; path: string }>;
  readonly consoleCount: number;
  readonly markerUsesAfterFlow: number;
}

/**
 * 흐름이 끝난 뒤의 판정. 모두 실제로 모은 값에 대한 검사다(모은 것이 없으면 대조군에서 실패한다).
 *  - 요청: 같은 출처뿐이고, 환자 값·표지 식별자·requestId/refreshId 이름이 주소·머리글에 없으며, 환자 값이 본문에 있는 요청은 계산 요청 하나뿐이다.
 *  - 페이지가 부른 fetch 는 병원 자료 GET 둘과 계산 POST 뿐이고, sendBeacon·XHR·WebSocket·EventSource 는 0건, 저장소 쓰기 호출은 0건이다.
 *  - 콘솔에 환자 값·표지 식별자가 없다. 주소가 그대로이고 쿼리·해시가 없다.
 */
export async function verifyExposure(page: Page, exposure: Exposure, origin: string, label: string, options: { readonly markers?: boolean } = {}): Promise<ExposureVerdict> {
  const markers = options.markers ?? true;
  const side = await exposure.pageSide();
  const nonApi: string[] = [];
  const api: Array<{ method: string; path: string }> = [];

  expect(exposure.requests.length, `${label}: 요청을 하나도 모으지 못했다(감시가 빈 것이면 통과가 뜻이 없다)`).toBeGreaterThan(0);
  for (const request of exposure.requests) {
    const url = new URL(request.url);
    expect(url.origin, `${label}: 다른 출처로 나간 요청 ${request.url}`).toBe(origin);
    expect(['ping', 'websocket', 'eventsource'], `${label}: 추적용 요청 종류 ${request.resourceType} ${request.url}`).not.toContain(request.resourceType);
    const surface = `${request.url}\n${JSON.stringify(request.headers)}`;
    for (const token of [...PATIENT_TOKENS, MARKER_PREFIX]) expect(surface, `${label}: 주소·머리글에 ${token} 가 있다 (${request.method} ${request.url})`).not.toContain(token);
    expect(`${url.pathname}${url.search}${JSON.stringify(Object.keys(request.headers))}`.toLowerCase(), `${label}: requestid/refreshid 이름이 요청에 있다`).not.toMatch(/request-?id|refresh-?id/);
    expect(findUuids(surface), `${label}: 주소·머리글에 UUID 형식 값이 있다`).toEqual([]);
    if (API_PATH.test(url.pathname)) {
      api.push({ method: request.method, path: url.pathname.replace(/^\/api\/clinics\/[^/]+/, '/api/clinics/{slug}') });
      expect(url.search, `${label}: API 주소에 쿼리가 있다`).toBe('');
      if (request.method === 'GET') expect(request.postData ?? '', `${label}: GET 에 본문이 있다`).toBe('');
      if (request.postData !== null) {
        const keys = Object.keys(JSON.parse(request.postData) as Record<string, unknown>).sort();
        expect(keys, `${label}: 계산 요청 본문은 여섯 필드뿐이다`).toEqual(['catalogVersion', 'cause', 'generation', 'insurerType', 'ruleBundleVersion', 'treatmentIds']);
        expect(request.postData, `${label}: 계산 요청 본문에 표지 식별자가 있다`).not.toContain(MARKER_PREFIX);
      }
    } else {
      nonApi.push(`${request.method} ${url.pathname}${url.search} [${request.resourceType}]`);
      expect(request.method, `${label}: API 가 아닌 요청이 GET 이 아니다 ${request.url}`).toBe('GET');
      expect(request.postData ?? '', `${label}: API 가 아닌 요청에 본문이 있다 ${request.url}`).toBe('');
    }
  }

  // 대조군: 병원 자료 GET 둘과 계산 POST 가 실제로 있었다(아니면 위의 '환자 값이 없다'는 빈 검사다).
  expect(api.filter((entry) => entry.method === 'GET').length, `${label}: 병원 자료 GET 이 없다`).toBeGreaterThanOrEqual(2);

  expect(side.fetches.map((entry) => `${entry.method} ${new URL(entry.url, origin).pathname.replace(/^\/api\/clinics\/[^/]+/, '/api/clinics/{slug}')}`).filter((entry) => !/^(GET \/api\/clinics\/\{slug\}\/(catalog|insurance\/options)|POST \/api\/clinics\/\{slug\}\/estimate)$/.test(entry)), `${label}: 페이지가 병원 API 밖으로 fetch 했다`).toEqual([]);
  expect(side.beacons, `${label}: sendBeacon`).toEqual([]);
  expect(side.xhr, `${label}: XMLHttpRequest`).toEqual([]);
  expect(side.sockets, `${label}: WebSocket/EventSource`).toEqual([]);
  expect(side.storageWrites, `${label}: 저장소 쓰기 호출`).toEqual([]);

  const consoleText = exposure.console.map((entry) => entry.text).join('\n');
  for (const token of [...PATIENT_TOKENS, MARKER_PREFIX, 'requestId', 'refreshId']) expect(consoleText, `${label}: 콘솔에 ${token} 가 있다`).not.toContain(token);

  const url = new URL(page.url());
  expect(url.search + url.hash, `${label}: 주소에 쿼리·해시가 있다`).toBe('');
  for (const token of [...PATIENT_TOKENS, MARKER_PREFIX]) expect(page.url(), `${label}: 주소에 ${token} 가 있다`).not.toContain(token);

  // 표지 발급기가 실제로 쓰였다: 흐름 뒤 다음 값의 번호가 1보다 크다(세션·계산 시도 식별자가 이 함수에서 나왔다). 실제 발급기 구성에서는 쓰인 횟수를 알 수 없어 0 으로 적고 UUID 형식 값이 새지 않음만 본다.
  let used = 0;
  if (markers) {
    const next = await page.evaluate(() => crypto.randomUUID());
    used = Number(/-(\d{4})$/.exec(next)?.[1] ?? '0') - 1;
    expect(used, `${label}: 표지 발급기가 쓰이지 않았다`).toBeGreaterThan(1);
  }
  expect(findUuids(consoleText), `${label}: 콘솔에 UUID 형식 값이 있다`).toEqual([]);
  expect(findUuids(page.url()), `${label}: 주소에 UUID 형식 값이 있다`).toEqual([]);

  return { nonApiRequests: [...new Set(nonApi)].sort(), apiRequests: api, consoleCount: exposure.console.length, markerUsesAfterFlow: used };
}

/** 저장소 덤프가 모두 비어 있고 어떤 환자 값·표지도 없다. */
export function expectEmptyDump(dump: StorageDump, label: string): void {
  expect(dump.localStorage, `${label} localStorage`).toEqual({});
  expect(dump.sessionStorage, `${label} sessionStorage`).toEqual({});
  expect(dump.indexedDb, `${label} indexedDB`).toEqual({});
  expect(dump.cacheStorage, `${label} Cache Storage`).toEqual({});
  expect(dump.serviceWorkers, `${label} service workers`).toEqual([]);
  expect(dump.cookie, `${label} document.cookie`).toBe('');
  expect(dump.contextCookies, `${label} 쿠키 저장소`).toEqual([]);
  const text = JSON.stringify(dump);
  for (const token of [...PATIENT_TOKENS, MARKER_PREFIX]) expect(text, `${label}: 덤프에 ${token} 가 있다`).not.toContain(token);
  expect(findUuids(text), `${label}: 덤프에 UUID 형식 값이 있다`).toEqual([]);
}

/** DOM 전체에 식별자 이름·표지가 없다: 속성 이름·값·글 모두. */
export async function expectDomClean(page: Page, label: string): Promise<void> {
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  expect(html, `${label}: DOM 에 표지 식별자`).not.toContain(MARKER_PREFIX);
  expect(html.toLowerCase(), `${label}: DOM 에 requestid/refreshid`).not.toMatch(/requestid|refreshid|request-id|refresh-id/);
  expect(findUuids(html), `${label}: DOM 에 UUID 형식 값`).toEqual([]);
}
