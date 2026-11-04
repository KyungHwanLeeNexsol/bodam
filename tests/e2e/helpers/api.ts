import type { Page, Route } from '@playwright/test';
import type { CatalogDto, OptionsDto } from '../../../src/app/kiosk/state/api-types';
import { makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';

// 시험 자료(TEST_FIXTURE). 계산 요청이 돌려받는 오류 응답(계약 모양). 시험이 409·422 뒤의 자료 갱신을 일으킬 때 쓴다.
// 이 파일은 vitest 를 가져오는 transport.fixture 를 쓸 수 없어(Playwright 가 부른다) 같은 모양을 여기에 둔다.
export const MISMATCH_409 = {
  error: 'VERSION_MISMATCH',
  latest: { catalogVersion: 'TEST_FIXTURE_CATALOG_V2', ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V1', ruleBundleStatus: 'ACTIVE' },
  changes: { priceChanged: true, ruleChanged: false, treatmentsUnpublished: [] },
};
export const NOT_PUBLISHED_422 = { error: 'TREATMENT_NOT_PUBLISHED' };

// 시험 자료(TEST_FIXTURE). 브라우저 시험의 "가로채기" 층 도구 (BRIEF D12): page.route 로 /api/clinics/** 를 시험 자료로 응답한다.
// 응답을 정확히 통제한다: 정해진 응답·끝내 오지 않는 응답(hang)·연결 실패(abort)·시험이 풀어 줄 때까지 붙잡아 두는 응답(hold).
// 운영 코드는 이 파일을 가져오지 않는다. 이 층의 시험은 "가로챈 응답으로 화면을 시험"한 것이며 운영 자료나 실제 핸들러의 증거가 아니다.

export type Endpoint = 'catalog' | 'options' | 'estimate';

export type Behavior =
  | { readonly kind: 'reply'; readonly status: number; readonly body: unknown; readonly rawBody?: string }
  | { readonly kind: 'hang' }
  | { readonly kind: 'abort' };

export const reply = (status: number, body: unknown): Behavior => ({ kind: 'reply', status, body });
/** JSON 이 아닌 본문(깨진 응답). */
export const replyRaw = (status: number, rawBody: string): Behavior => ({ kind: 'reply', status, body: null, rawBody });
export const HANG: Behavior = { kind: 'hang' };
export const ABORT: Behavior = { kind: 'abort' };

export interface RecordedCall {
  readonly endpoint: Endpoint;
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly postData: string | null;
}

export interface Held {
  /** 붙잡힌 요청이 실제로 도착했는가. */
  arrived(): Promise<void>;
  release(behavior: Behavior): void;
}

export interface ApiMock {
  readonly calls: RecordedCall[];
  callsTo(endpoint: Endpoint): RecordedCall[];
  /** 그 끝점의 기본 응답을 바꾼다. */
  setDefault(endpoint: Endpoint, behavior: Behavior): void;
  /** 그 끝점의 다음 요청들에 차례로 쓸 응답(한 번씩). 다 쓰면 기본 응답으로 돌아간다. */
  queue(endpoint: Endpoint, ...behaviors: Behavior[]): void;
  /** 그 끝점의 다음 요청 하나를 붙잡아 두었다가 시험이 정한 응답으로 풀어 준다. */
  hold(endpoint: Endpoint): Held;
}

const PATTERN = /\/api\/clinics\/[^/]+\/(catalog|insurance\/options|estimate)(\?.*)?$/;

export interface MockOptions {
  readonly catalog?: CatalogDto;
  readonly options?: OptionsDto;
}

function endpointOf(url: string): Endpoint {
  const match = PATTERN.exec(url);
  if (match === null) throw new Error(`알 수 없는 API 주소: ${url}`);
  return match[1] === 'insurance/options' ? 'options' : (match[1] as Endpoint);
}

async function perform(route: Route, behavior: Behavior): Promise<void> {
  switch (behavior.kind) {
    case 'reply':
      await route.fulfill({ status: behavior.status, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: behavior.rawBody ?? JSON.stringify(behavior.body) });
      return;
    case 'abort':
      await route.abort('failed');
      return;
    case 'hang':
      // 끝내 응답하지 않는다. 페이지가 닫히면 요청도 사라진다.
      return;
  }
}

/** /api/clinics/** 를 가로챈다. 기본 응답은 시험 병원 자료(catalog·options 200)다. 계산 요청(estimate)의 기본 응답은 없다(시험이 정한다). */
export async function mockClinicApi(page: Page, mock: MockOptions = {}): Promise<ApiMock> {
  const defaults: Record<Endpoint, Behavior> = {
    catalog: reply(200, mock.catalog ?? makeCatalog()),
    options: reply(200, mock.options ?? makeOptions()),
    estimate: HANG,
  };
  const queues: Record<Endpoint, Behavior[]> = { catalog: [], options: [], estimate: [] };
  const holds: Record<Endpoint, Array<{ arrive: () => void; decision: Promise<Behavior> }>> = { catalog: [], options: [], estimate: [] };
  const calls: RecordedCall[] = [];

  await page.route(PATTERN, async (route) => {
    const request = route.request();
    const endpoint = endpointOf(request.url());
    calls.push({ endpoint, method: request.method(), url: request.url(), headers: request.headers(), postData: request.postData() });
    const hold = holds[endpoint].shift();
    if (hold !== undefined) {
      hold.arrive();
      await perform(route, await hold.decision);
      return;
    }
    await perform(route, queues[endpoint].shift() ?? defaults[endpoint]);
  });

  return {
    calls,
    callsTo: (endpoint) => calls.filter((call) => call.endpoint === endpoint),
    setDefault(endpoint, behavior) {
      defaults[endpoint] = behavior;
    },
    queue(endpoint, ...behaviors) {
      queues[endpoint].push(...behaviors);
    },
    hold(endpoint) {
      let arrive: () => void = () => undefined;
      let release: (behavior: Behavior) => void = () => undefined;
      const arrived = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const decision = new Promise<Behavior>((resolve) => {
        release = resolve;
      });
      holds[endpoint].push({ arrive, decision });
      return { arrived: () => arrived, release: (behavior) => release(behavior) };
    },
  };
}
