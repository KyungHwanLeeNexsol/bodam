import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getCatalog } from '../../../src/app/api/clinics/[slug]/catalog/route';
import { POST } from '../../../src/app/api/clinics/[slug]/estimate/route';
import { GET as getOptions } from '../../../src/app/api/clinics/[slug]/insurance/options/route';
import type { CatalogDto, OptionsDto } from '../../../src/app/kiosk/state/api-types';
import { createKioskController } from '../../../src/app/kiosk/state/controller';
import type { KioskController } from '../../../src/app/kiosk/state/controller';
import type { Transport } from '../../../src/app/kiosk/state/deps';
import { canRequestEstimate, selectTotals } from '../../../src/app/kiosk/state/selectors';
import type { KioskInit } from '../../../src/app/kiosk/state/session-store';
import type { TreatmentVersion } from '../../../src/server/domain/entities';
import { serve } from '../../api/estimate-helpers';
import { callGet } from '../../api/helpers';
import { markerIds, sequenceIds } from '../../fixtures/kiosk/state.fixture';
import { useTestServices } from '../../fixtures/server/api-composition.fixture';
import { makeBaseFeeVersion } from '../../fixtures/server/base-fee.fixture';
import { buildWorld } from '../../fixtures/server/estimate-world.fixture';
import type { EstimateWorld } from '../../fixtures/server/estimate-world.fixture';
import { validCatalogRequest } from '../../fixtures/server/publish.fixture';
import { publishCatalogOf } from '../../fixtures/server/versioning.fixture';

// 409·422 뒤 자료 갱신의 왕복을 실제 Route Handler 세 개(estimate POST, catalog GET, options GET)에 연결해 본다 (design.md DD-09 "자료 갱신 생명주기", DD-19, AC-020b·AC-020d 의 응답 모양 쪽).
// 전송은 요청을 그대로 실제 핸들러에 넘기는 함수이고, 응답은 실제 핸들러가 낸 것이다. 서버는 TEST_FIXTURE 메모리 저장소와 시험 구성(서비스 주입)이다.
// 키오스크 쪽 코드는 src/server 를 가져오지 않고 응답 본문만 받는다. 시험은 실제 타이머를 쓰고(핸들러가 약속만 쓴다) 컨트롤러는 끝에 dispose 한다.

vi.mock('../../../src/app/services', async () => {
  const { activeTestServices } = await import('../../fixtures/server/api-composition.fixture');
  return { getApiServices: () => activeTestServices() };
});

const [TV1, TV2] = validCatalogRequest().treatmentVersions as [TreatmentVersion, TreatmentVersion];
const SLUG = 'test-fixture-clinic-1';

let world: EstimateWorld;
let urls: string[];
let controllers: KioskController[];

beforeEach(() => {
  world = buildWorld();
  serve(world);
  urls = [];
  controllers = [];
});

afterEach(() => {
  for (const controller of controllers) controller.dispose();
  useTestServices(null);
});

/** 요청을 기록하고 그대로 실제 핸들러에 넘기는 전송. */
const realTransport: Transport = (url, init) => {
  urls.push(`${init.method} ${url}`);
  const request = new Request(`http://localhost${url}`, { method: init.method, headers: init.headers, body: init.body ?? null, signal: init.signal });
  const slug = decodeURIComponent(/^\/api\/clinics\/([^/]+)\//.exec(url)?.[1] ?? '');
  const context = { params: Promise.resolve({ slug }) };
  if (url.endsWith('/estimate')) return POST(request, context);
  return url.endsWith('/catalog') ? getCatalog(request, context) : getOptions(request, context);
};

async function loadInit(): Promise<KioskInit & { catalog: CatalogDto; options: OptionsDto }> {
  const catalog = (await callGet(getCatalog, SLUG, 'catalog')).body as CatalogDto;
  const options = (await callGet(getOptions, SLUG, 'insurance/options')).body as OptionsDto;
  return { catalog, options };
}

function atTreatments(init: KioskInit, extraTreatmentIds: readonly string[] = []): KioskController {
  const controller = createKioskController({ transport: realTransport, newRequestId: markerIds('RID-TEST'), newRefreshId: markerIds('RFR-TEST'), newSessionId: sequenceIds('NEW') }, init);
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

const untilSettled = (controller: KioskController): Promise<void> => vi.waitFor(() => expect(controller.getState().screen).not.toBe('Calculating'));
const untilRefreshed = (controller: KioskController): Promise<void> => vi.waitFor(() => expect(controller.getState().refreshState).not.toBe('RUNNING'));

describe('실제 핸들러와의 갱신 왕복', () => {
  it('409: 카탈로그가 바뀐 뒤 확인하면 버전 불일치 -> 실제 catalog·options GET 으로 갱신 -> 새 버전·새 합계 -> 환자가 다시 확인하면 새 버전으로 200', async () => {
    const init = await loadInit();
    const controller = atTreatments(init);
    const staleTotal = selectTotals(controller.getState()).total;
    // 서버가 가격을 바꿔 카탈로그를 새로 게시한다 (치료는 그대로)
    const next = publishCatalogOf(world.world, { treatmentVersions: [{ ...TV1, id: 'TEST_FIXTURE_TV_1_NEW_PRICE', patientAmount: 12_000 }, TV2], commonBaseFees: [makeBaseFeeVersion(1)] });

    controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    await untilSettled(controller);
    await untilRefreshed(controller);

    expect(urls).toEqual([`POST /api/clinics/${SLUG}/estimate`, `GET /api/clinics/${SLUG}/catalog`, `GET /api/clinics/${SLUG}/insurance/options`]);
    const refreshed = controller.getState();
    expect(refreshed.screen).toBe('K03_Treatments');
    expect(refreshed.refreshState).toBe('NONE');
    expect(refreshed.derived.estimate).toBeNull();
    expect(refreshed.clinic.versions.catalogVersion).toBe(next.id);
    expect(refreshed.inputs.treatmentIds).toEqual(init.catalog.treatments.map((treatment) => treatment.treatmentId));
    expect(refreshed.refreshNotice).toBeNull();
    expect(selectTotals(refreshed).total).not.toBe(staleTotal);
    expect(canRequestEstimate(refreshed)).toBe(true);

    // 환자가 다시 확인한다: 새 버전으로 200
    controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    await untilSettled(controller);
    const result = controller.getState();
    expect(['K04_Result', 'K04_Result_NotCovered', 'K04_Result_Hold']).toContain(result.screen);
    expect(result.derived.estimate?.response?.versions.catalogVersion).toBe(next.id);
    expect(result.derived.estimate?.response?.result.amounts.hospitalPayment).toBe(selectTotals(result).total);
    expect(urls.filter((entry) => entry.startsWith('POST'))).toHaveLength(2);
  });

  it('422 TREATMENT_NOT_PUBLISHED: 서버 카탈로그에 없는 치료는 갱신에서 선택에서 빠지고 안내가 남는다 -> 다시 확인하면 200', async () => {
    const init = await loadInit();
    const ghost = { treatmentId: 'TEST_FIXTURE_NOT_PUBLISHED', displayName: 'TEST_FIXTURE 유령', description: '', benefitType: 'BENEFIT' as const, patientAmount: 1_000, priceCondition: '', order: 99 };
    const controller = atTreatments({ catalog: { ...init.catalog, treatments: [...init.catalog.treatments, ghost] }, options: init.options });
    const before = controller.getState();
    expect(before.inputs.treatmentIds).toContain(ghost.treatmentId);

    controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    await untilSettled(controller);
    await untilRefreshed(controller);

    const refreshed = controller.getState();
    expect(refreshed.screen).toBe('K03_Treatments');
    expect(refreshed.refreshState).toBe('NONE');
    expect(refreshed.inputs.treatmentIds).not.toContain(ghost.treatmentId);
    expect(refreshed.inputs.treatmentIds).toHaveLength(before.inputs.treatmentIds.length - 1);
    expect(refreshed.inputRevision).toBe(before.inputRevision + 1);
    expect(refreshed.refreshNotice).toEqual({ removed: [{ treatmentId: ghost.treatmentId, displayName: 'TEST_FIXTURE 유령' }] });
    expect(refreshed.clinic.catalog.treatments.map((treatment) => treatment.treatmentId)).not.toContain(ghost.treatmentId);
    expect(canRequestEstimate(refreshed)).toBe(true);

    controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    await untilSettled(controller);
    expect(['K04_Result', 'K04_Result_NotCovered', 'K04_Result_Hold']).toContain(controller.getState().screen);
    expect(controller.getState().derived.estimate?.response?.result.amounts.hospitalPayment).toBe(selectTotals(controller.getState()).total);
  });
});
