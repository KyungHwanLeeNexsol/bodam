import { afterAll, describe, expect, it, vi } from 'vitest';
import { GET as getCatalog } from '../../../src/app/api/clinics/[slug]/catalog/route';
import { GET as getOptions } from '../../../src/app/api/clinics/[slug]/insurance/options/route';
import { POST as postEstimate } from '../../../src/app/api/clinics/[slug]/estimate/route';
import { K04Result, K04ResultHold, K04ResultNotCovered } from '../../../src/app/kiosk/screens/ResultScreens';
import type { CatalogDto, EstimateResponseDto, OptionsDto } from '../../../src/app/kiosk/state/api-types';
import { selectTotals } from '../../../src/app/kiosk/state/selectors';
import { createInitialState } from '../../../src/app/kiosk/state/session-store';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { buildResultView } from '../../../src/app/kiosk/view/result-view';
import { callGet } from '../../api/helpers';
import { callPost } from '../../api/post-helpers';
import { serve } from '../../api/estimate-helpers';
import { useTestServices, CLINIC_1_SLUG } from '../../fixtures/server/api-composition.fixture';
import { BASE_FEE_ID, T1, T2 } from '../../fixtures/server/base-fee.fixture';
import { buildWorld, requestBody, specOf } from '../../fixtures/server/estimate-world.fixture';
import type { EstimateWorld } from '../../fixtures/server/estimate-world.fixture';
import { makeEnv } from '../../fixtures/kiosk/state.fixture';
import { renderWithState, textOf } from '../screens/render';

// 실제 estimate 핸들러가 낸 응답을 결과 화면이 읽는다 (SPEC-REIMBURSEMENT-001 M6 S3a, AC-013a·b·c, AC-019c — 단위 층, 시험 자료 TEST_FIXTURE).
// 시험용 응답 본문(tests/fixtures/kiosk/estimate.fixture.ts)이 실제 핸들러의 모양을 따르는지, 그리고 세 결과 종류가 실제 응답으로 그려지는지를 본다.
// 운영 자료가 아니다: 실제 핸들러 논리를 시험 자료의 세계로 돌린 것이다. 브라우저에서 같은 일을 하는 것은 tests/e2e 의 real 층이다.

vi.mock('../../../src/app/services', async () => {
  const { activeTestServices } = await import('../../fixtures/server/api-composition.fixture');
  return { getApiServices: () => activeTestServices() };
});

afterAll(() => {
  useTestServices(null);
});

interface Served {
  readonly catalog: CatalogDto;
  readonly options: OptionsDto;
  readonly response: EstimateResponseDto;
  readonly state: KioskState;
}

/** 세계를 서비스로 열고, 키오스크가 하는 대로 catalog·options 를 받아 두 치료를 고르고 계산한다. */
async function serveAndEstimate(world: EstimateWorld): Promise<Served> {
  serve(world);
  const catalog = (await callGet(getCatalog, CLINIC_1_SLUG, 'catalog')).body as CatalogDto;
  const options = (await callGet(getOptions, CLINIC_1_SLUG, 'insurance/options')).body as OptionsDto;
  const called = await callPost(postEstimate, CLINIC_1_SLUG, requestBody(world, { cause: 'INJURY' }));
  expect(called.status).toBe(200);
  const response = called.body as EstimateResponseDto;
  const base = createInitialState({ catalog, options }, makeEnv());
  const state: KioskState = {
    ...base,
    screen: response.result.state === 'ESTIMATED' ? 'K04_Result' : response.result.state === 'ESTIMATED_WITH_EXCLUSIONS' ? 'K04_Result_NotCovered' : 'K04_Result_Hold',
    inputs: { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'INJURY', treatmentIds: [T1, T2] },
    derived: { estimate: { state: response.result.state, response }, documents: null, basis: null, returnContext: null },
  };
  return { catalog, options, response, state };
}

describe('정상 결과: 실제 핸들러 응답', () => {
  it('세 금액은 응답 그대로이고, 병원 결제액의 내역은 선택 요약과 같다 (AC-019c: 기본비용 포함 25,000)', async () => {
    const { response, state } = await serveAndEstimate(buildWorld());
    expect(response.result.state).toBe('ESTIMATED');
    const view = buildResultView(state, 'NORMAL');
    expect(view?.hospital.text).toBe('25,000원');
    expect(view?.payout.text).toBe('24,000원');
    expect(view?.afterPayout.text).toBe('1,000원');
    // 키오스크 선택 요약(selectTotals, 엔진 sumLineAmounts)이 서버가 센 병원 결제액과 같다.
    expect(selectTotals(state).total).toBe(response.result.amounts.hospitalPayment);
    // 시험 병원 자료: 치료 1 급여 10,000 + 기본비용(급여) 5,000 + 치료 2 비급여 10,000.
    expect(view?.hospital.split).toBe('급여 15,000원 + 비급여 10,000원');
    const html = renderWithState(state, <K04Result />).html;
    expect(textOf(html)).toContain('예상 병원 결제액 25,000원');
    expect(html).toContain('data-kiosk-test-data');
  });

  it('실제 응답의 모든 문자열이 환자 화면에 내부 코드 없이 그려진다', async () => {
    const { state } = await serveAndEstimate(buildWorld());
    const html = renderWithState(state, <K04Result />).html;
    expect(html).not.toMatch(/PROFILE_|MAPPING_|LINE_|GEN\d_|NON_LIFE|requestId|refreshId/);
  });
});

describe('보장 제외 결과: 실제 핸들러 응답', () => {
  it('제외 항목의 이름·금액·사유가 응답에서 오고 보험금은 나머지 항목 기준이다', async () => {
    const world = buildWorld({
      spec: specOf({
        mappings: [
          { target: T1, kind: 'COVERED' },
          { target: T2, kind: 'EXCLUDED' },
          { target: BASE_FEE_ID, kind: 'COVERED' },
        ],
      }),
    });
    const { response, state } = await serveAndEstimate(world);
    expect(response.result.state).toBe('ESTIMATED_WITH_EXCLUSIONS');
    const view = buildResultView(state, 'NOT_COVERED');
    expect(view?.exclusions).toHaveLength(1);
    expect(view?.exclusions[0]?.reason).toBe(response.result.excludedItems[0]?.reason);
    expect(view?.exclusions[0]?.amount).toBe('10,000원');
    expect(view?.payout.known).toBe(true);
    expect(view?.exclusionNotes).toContain('나머지 항목은 보장 대상이고 한도가 남아 있다고 가정합니다.');
    const html = renderWithState(state, <K04ResultNotCovered />).html;
    const text = textOf(html);
    expect(html).toContain('aria-label="보장 제외 항목"');
    expect(text).toContain('보장 제외');
    expect(text).not.toContain('모두 보장 대상');
  });
});

describe('보류 결과: 실제 핸들러 응답', () => {
  it('규칙 묶음이 없는 병원: 병원 결제액만 숫자이고 보험금 둘은 "확인 필요", 분류 문구만 보이고 내부 코드가 없다', async () => {
    const { response, state } = await serveAndEstimate(buildWorld({ spec: null }));
    expect(response.result.state).toBe('ON_HOLD');
    expect(response.result.amounts.expectedInsurancePayout).toBeNull();
    const view = buildResultView(state, 'HOLD');
    expect(view?.hospital.text).toBe('25,000원');
    expect(view?.payout.text).toBe('확인 필요');
    expect(view?.afterPayout.text).toBe('확인 필요');
    expect(view?.holdGroups.map((group) => group.phrase)).toEqual(['표준 가정 자료가 아직 준비되지 않았습니다']);
    const html = renderWithState(state, <K04ResultHold />).html;
    expect(html).not.toMatch(/PROFILE_|MAPPING_|LINE_|CLINIC_RULE|RULE_BUNDLE|referenceGroups/);
    expect(textOf(html)).not.toMatch(/(?<![\d,])0원/);
  });
});
