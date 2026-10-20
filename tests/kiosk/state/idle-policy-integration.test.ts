import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getCatalog } from '../../../src/app/api/clinics/[slug]/catalog/route';
import { GET as getOptions } from '../../../src/app/api/clinics/[slug]/insurance/options/route';
import type { CatalogDto, OptionsDto } from '../../../src/app/kiosk/state/api-types';
import { createKioskController, createKioskControllerFromState } from '../../../src/app/kiosk/state/controller';
import type { KioskController } from '../../../src/app/kiosk/state/controller';
import type { KioskInit, KioskState, ScreenState } from '../../../src/app/kiosk/state/session-store';
import { saveClinicIdlePolicy } from '../../../src/server/idle-policy';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1 } from '../../fixtures/server/actors.fixture';
import { CLINIC_1_SLUG, CLINIC_2_SLUG, createTestServices, publishSecondClinicCatalog, publishedCatalogWorld, useTestServices } from '../../fixtures/server/api-composition.fixture';
import { callGet } from '../../api/helpers';
import { makeEnv, resultSessionAt, sequenceIds, stateAt } from '../../fixtures/kiosk/state.fixture';

// AC-015i (integration): 도메인 서비스와 메모리 저장소로 병원 A 의 무조작 정책을 바꾸고 병원 B 는 정책을 저장하지 않은 채,
// 키오스크 상태 기계가 각 병원의 실제 `GET /api/clinics/{slug}/catalog` Route Handler 응답의 `idlePolicy` 로 타이머 임계값을 구성한다.
// 응답은 실제 route.ts 의 GET 이 낸 것(시험 구성 서비스를 vi.mock 으로 주입)이고, 상태 기계는 그 본문만 받는다. 관리자 HTTP 경로는 쓰지 않는다(AC-023d 는 M7).
// 시계는 가짜 시계다. 판정: A 는 입력 단계 90/110, 저장하지 않은 화면 종류는 DD-10 표의 값, B 는 DD-10 표의 값, completionHoldSeconds 는 저장된 때만 그 값이다.

vi.mock('../../../src/app/services', async () => {
  const { activeTestServices } = await import('../../fixtures/server/api-composition.fixture');
  return { getApiServices: () => activeTestServices() };
});

const SECOND = 1_000;
const INPUT_A = { warnSeconds: 90, resetSeconds: 110 };
const HOLD_A = 30;

let clinicA: KioskInit;
let clinicB: KioskInit;
let bodyA: CatalogDto;
let bodyB: CatalogDto;

async function load(slug: string): Promise<{ init: KioskInit; catalog: CatalogDto }> {
  const catalog = (await callGet(getCatalog, slug, 'catalog')).body as CatalogDto;
  const options = (await callGet(getOptions, slug, 'insurance/options')).body as OptionsDto;
  return { init: { catalog, options }, catalog };
}

beforeAll(async () => {
  const { world } = publishedCatalogWorld();
  publishSecondClinicCatalog(world);
  // 병원 A 만 입력 단계 값과 이용 완료 대기를 저장한다. 병원 B 는 정책을 저장하지 않는다.
  saveClinicIdlePolicy(world.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, { screens: { INPUT: INPUT_A }, completionHoldSeconds: HOLD_A });
  useTestServices(createTestServices({ repo: world.repo }));
  const a = await load(CLINIC_1_SLUG);
  const b = await load(CLINIC_2_SLUG);
  clinicA = a.init;
  bodyA = a.catalog;
  clinicB = b.init;
  bodyB = b.catalog;
});

afterAll(() => {
  useTestServices(null);
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** 입력 단계는 실제 사건(시작하기)으로, 나머지 화면 종류는 그 병원의 실제 응답 위에 구성한 상태로 시작한다. */
function controllerAt(init: KioskInit, screen: ScreenState): KioskController {
  if (screen === 'K01_Generation') {
    const controller = createKioskController({ newSessionId: sequenceIds('NEW') }, init);
    controller.dispatch({ type: 'START' });
    return controller;
  }
  const env = makeEnv(performance.now());
  const state: KioskState = screen === 'K04_Result' || screen === 'K04_Result_Hold' || screen === 'K04_Basis_Calculation' || screen === 'K07_Documents'
    ? resultSessionAt(screen, {}, { ...init, env })
    : stateAt(screen, {}, { ...init, env });
  return createKioskControllerFromState({ newSessionId: sequenceIds('NEW') }, state);
}

function expectCycle(controller: KioskController, warnSeconds: number, resetSeconds: number): void {
  vi.advanceTimersByTime(warnSeconds * SECOND - 1);
  expect(controller.getState().overlay.kind).toBe('NONE');
  vi.advanceTimersByTime(1);
  expect(controller.getState().overlay.kind).toBe('TIMEOUT_DIALOG');
  vi.advanceTimersByTime((resetSeconds - warnSeconds) * SECOND - 1);
  expect(controller.getState().overlay.kind).toBe('TIMEOUT_DIALOG');
  vi.advanceTimersByTime(1);
  expect(controller.getState().screen).toBe('K00_Start');
  expect(controller.getState().overlay.kind).toBe('NONE');
}

describe('AC-015i: 실제 catalog 응답의 idlePolicy 로 키오스크 타이머가 구성된다', () => {
  it('구성 전제: 두 병원의 응답은 실제 Route Handler 가 낸 것이다 — A 는 입력 단계 값과 이용 완료 대기를 저장했고, B 는 정책이 없어 DD-10 표의 값이다', () => {
    expect(bodyA.clinic.slug).toBe(CLINIC_1_SLUG);
    expect(bodyB.clinic.slug).toBe(CLINIC_2_SLUG);
    expect(bodyA.idlePolicy?.screens?.INPUT).toEqual(INPUT_A);
    expect(bodyA.idlePolicy?.completionHoldSeconds).toBe(HOLD_A);
    expect(bodyB.idlePolicy?.screens?.INPUT).toEqual({ warnSeconds: 100, resetSeconds: 120 });
    expect(bodyB.idlePolicy?.completionHoldSeconds).toBeNull();
  });

  it('병원 A 의 입력 단계: 90초에 TimeoutDialog, 110초에 초기화되어 K00_Start 로 간다 (바뀐 값)', () => {
    const controller = controllerAt(clinicA, 'K01_Generation');
    expect(controller.getState().clinic.idle.screens.INPUT).toEqual(INPUT_A);
    expectCycle(controller, 90, 110);
  });

  it.each([
    ['K04_Result', 160, 180],
    ['K04_Result_Hold', 160, 180],
    ['K04_Basis_Calculation', 160, 180],
    ['K07_Documents', 160, 180],
    ['K01_Generation_Unknown', 100, 120],
    ['Calculating', 100, 120],
    ['KXX_Error_Network', 100, 120],
  ] as const)('병원 A 가 저장하지 않은 화면 종류(%s)는 DD-10 표의 값 %i/%i 초다', (screen, warn, reset) => {
    expectCycle(controllerAt(clinicA, screen), warn, reset);
  });

  it('정책이 없는 병원 B 의 입력 단계: 100초에 TimeoutDialog, 120초에 초기화 (DD-10 표의 값)', () => {
    const controller = controllerAt(clinicB, 'K01_Generation');
    expect(controller.getState().clinic.idle.screens.INPUT).toEqual({ warnSeconds: 100, resetSeconds: 120 });
    expectCycle(controller, 100, 120);
  });

  it.each([
    ['K04_Result', 160, 180],
    ['K04_Result_Hold', 160, 180],
    ['K07_Documents', 160, 180],
    ['Calculating', 100, 120],
  ] as const)('병원 B 의 %s: DD-10 표의 값 %i/%i 초다', (screen, warn, reset) => {
    expectCycle(controllerAt(clinicB, screen), warn, reset);
  });

  it('completionHoldSeconds: 병원 A 는 저장한 30초 뒤 K06_Complete 에서 K00_Start 로 돌아가고, 저장하지 않은 병원 B 는 null 이라 자동 복귀가 없다 (10 초로 바꿔 쓰지 않는다)', () => {
    const a = controllerAt(clinicA, 'K04_Result');
    a.dispatch({ type: 'COMPLETE_USE' });
    expect(a.getState().screen).toBe('K06_Complete');
    vi.advanceTimersByTime(HOLD_A * SECOND - 1);
    expect(a.getState().screen).toBe('K06_Complete');
    vi.advanceTimersByTime(1);
    expect(a.getState().screen).toBe('K00_Start');

    const b = controllerAt(clinicB, 'K04_Result');
    b.dispatch({ type: 'COMPLETE_USE' });
    expect(b.getState().clinic.idle.completionHoldSeconds).toBeNull();
    vi.advanceTimersByTime(HOLD_A * SECOND);
    vi.advanceTimersByTime(3_600 * SECOND);
    expect(b.getState().screen).toBe('K06_Complete');
    b.dispose();
  });

  it('두 병원의 정책은 서로 섞이지 않는다: 같은 가짜 시계에서 A 는 이미 경고, B 는 아직 경고 전이다 (95초 지점)', () => {
    const a = controllerAt(clinicA, 'K01_Generation');
    const b = controllerAt(clinicB, 'K01_Generation');
    vi.advanceTimersByTime(95 * SECOND);
    expect(a.getState().overlay.kind).toBe('TIMEOUT_DIALOG');
    expect(b.getState().overlay.kind).toBe('NONE');
    a.dispose();
    b.dispose();
  });
});
