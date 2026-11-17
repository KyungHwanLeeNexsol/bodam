import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../../src/app/api/clinics/[slug]/estimate/route';
import { GET as getCatalog } from '../../../src/app/api/clinics/[slug]/catalog/route';
import { GET as getOptions } from '../../../src/app/api/clinics/[slug]/insurance/options/route';
import type { CatalogDto, OptionsDto } from '../../../src/app/kiosk/state/api-types';
import { createKioskController } from '../../../src/app/kiosk/state/controller';
import type { KioskController } from '../../../src/app/kiosk/state/controller';
import type { Transport } from '../../../src/app/kiosk/state/deps';
import { selectTotals } from '../../../src/app/kiosk/state/selectors';
import type { KioskInit } from '../../../src/app/kiosk/state/session-store';
import { callGet } from '../../api/helpers';
import { serve } from '../../api/estimate-helpers';
import { useTestServices } from '../../fixtures/server/api-composition.fixture';
import { FULL_HOSPITAL_PAYMENT, buildWorld } from '../../fixtures/server/estimate-world.fixture';
import type { EstimateWorld } from '../../fixtures/server/estimate-world.fixture';
import { markerIds, sequenceIds } from '../../fixtures/kiosk/state.fixture';

// 키오스크 계산 요청을 실제 Route Handler(src/app/api/clinics/[slug]/estimate/route.ts)에 연결해 본다 (design.md DD-19, AC-016k·AC-020b 의 응답 모양 쪽).
// 전송은 요청을 그대로 실제 POST 에 넘기는 함수이고, 응답은 실제 핸들러가 낸 것이다. 병원 자료(catalog·options)도 실제 GET 이 낸 것이다.
// 서버는 TEST_FIXTURE 메모리 저장소와 시험 구성(서비스 주입)이다. 키오스크 쪽 코드는 src/server 를 가져오지 않고 응답 본문만 받는다.
// 시험은 실제 타이머를 쓴다(실제 핸들러가 약속만 쓰므로 가짜 시계가 필요 없다). 컨트롤러는 끝에 dispose 한다.

vi.mock('../../../src/app/services', async () => {
  const { activeTestServices } = await import('../../fixtures/server/api-composition.fixture');
  return { getApiServices: () => activeTestServices() };
});

interface Recorded {
  readonly url: string;
  readonly body: Record<string, unknown>;
  readonly headers: Readonly<Record<string, string>>;
}

let world: EstimateWorld;
let recorded: Recorded[];
let controllers: KioskController[];

beforeEach(() => {
  world = buildWorld();
  serve(world);
  recorded = [];
  controllers = [];
});

afterEach(() => {
  for (const controller of controllers) controller.dispose();
  useTestServices(null);
});

/** 요청을 기록하고 그대로 실제 POST 핸들러에 넘기는 전송. */
const realTransport: Transport = (url, init) => {
  recorded.push({ url, body: JSON.parse(init.body ?? 'null') as Record<string, unknown>, headers: init.headers });
  const slug = decodeURIComponent(/^\/api\/clinics\/([^/]+)\/estimate$/.exec(url)?.[1] ?? '');
  return POST(new Request(`http://localhost${url}`, { method: init.method, headers: init.headers, body: init.body ?? null, signal: init.signal }), { params: Promise.resolve({ slug }) });
};

async function loadInit(): Promise<KioskInit & { catalog: CatalogDto; options: OptionsDto }> {
  const catalog = (await callGet(getCatalog, 'test-fixture-clinic-1', 'catalog')).body as CatalogDto;
  const options = (await callGet(getOptions, 'test-fixture-clinic-1', 'insurance/options')).body as OptionsDto;
  return { catalog, options };
}

/** 실제 응답으로 연 키오스크를 4단계까지 진행시킨다. 치료는 병원 카탈로그의 치료를 모두 고른다. */
function atTreatments(init: KioskInit, extraTreatmentIds: readonly string[] = []): KioskController {
  const controller = createKioskController({ transport: realTransport, newRequestId: markerIds('RID-TEST'), newSessionId: sequenceIds('NEW') }, init);
  controllers.push(controller);
  const ids = [...init.catalog.treatments.map((treatment) => treatment.treatmentId), ...extraTreatmentIds];
  for (const event of [
    { type: 'START' },
    { type: 'SELECT_GENERATION', code: 'GEN4_C4' },
    { type: 'NEXT' },
    { type: 'SELECT_INSURER_TYPE', code: 'NON_LIFE' },
    { type: 'NEXT' },
    { type: 'SELECT_CAUSE', code: 'UNKNOWN' },
    { type: 'NEXT' },
    ...ids.map((treatmentId) => ({ type: 'TOGGLE_TREATMENT', treatmentId }) as const),
  ] as const) {
    expect(controller.dispatch(event), JSON.stringify(event)).toBe('APPLIED');
  }
  return controller;
}

const settled = async (controller: KioskController): Promise<void> => {
  await vi.waitFor(() => expect(controller.getState().screen).not.toBe('Calculating'));
};

describe('실제 계산 요청 핸들러와 연결한 키오스크', () => {
  it('200: 여섯 필드 본문을 서버가 받아들이고, 응답이 클라이언트 형식으로 읽혀 결과 화면과 서류가 저장된다. 선택 요약의 총액이 서버의 병원 결제액과 같다', async () => {
    const controller = atTreatments(await loadInit());
    const total = selectTotals(controller.getState()).total;
    expect(controller.dispatch({ type: 'REQUEST_ESTIMATE' })).toBe('APPLIED');
    await settled(controller);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.url).toBe('/api/clinics/test-fixture-clinic-1/estimate');
    expect(Object.keys(recorded[0]?.body ?? {})).toEqual(['catalogVersion', 'ruleBundleVersion', 'generation', 'insurerType', 'cause', 'treatmentIds']);
    expect(recorded[0]?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.stringify(recorded[0])).not.toMatch(/RID-TEST/);

    const state = controller.getState();
    expect(['K04_Result', 'K04_Result_NotCovered', 'K04_Result_Hold']).toContain(state.screen);
    const response = state.derived.estimate?.response;
    expect(response?.versions.catalogVersion).toBe(world.catalog.id);
    expect(response?.versions.ruleBundleVersion).toBe(world.bundle?.id);
    expect(response?.result.state).toBe(state.derived.estimate?.state);
    expect(response?.result.amounts.hospitalPayment).toBe(FULL_HOSPITAL_PAYMENT);
    expect(response?.result.amounts.hospitalPayment).toBe(total);
    expect(state.derived.documents).toBe(response?.documents);
    expect(state.activeRequest).toBeNull();
  });

  it('404: 없는 병원이면 통신 오류 화면이다 (0원이나 빈 결과를 만들지 않는다)', async () => {
    const init = await loadInit();
    const lost: KioskInit = { catalog: { ...init.catalog, clinic: { ...init.catalog.clinic, slug: 'nope' } }, options: init.options };
    const controller = atTreatments(lost);
    controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    await settled(controller);

    const state = controller.getState();
    expect(state.screen).toBe('KXX_Error_Network');
    expect(state.derived.estimate).toBeNull();
    expect(recorded[0]?.url).toBe('/api/clinics/nope/estimate');
  });

  it('통신 오류 뒤 "다시 시도"는 같은 본문으로 새 요청을 보낸다 (새 시도라서 식별자는 새로 발급된다)', async () => {
    const init = await loadInit();
    const lost: KioskInit = { catalog: { ...init.catalog, clinic: { ...init.catalog.clinic, slug: 'nope' } }, options: init.options };
    const controller = atTreatments(lost);
    controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    await settled(controller);
    expect(controller.getState().screen).toBe('KXX_Error_Network');
    expect(controller.dispatch({ type: 'REQUEST_ESTIMATE' })).toBe('APPLIED');
    await settled(controller);
    expect(recorded).toHaveLength(2);
    expect(recorded[1]?.body).toEqual(recorded[0]?.body);
  });
});
