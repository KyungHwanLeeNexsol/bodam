import { describe, expect, it } from 'vitest';
import type { IdlePolicyDto } from '../../../src/app/kiosk/state/api-types';
import { DEFAULT_IDLE_THRESHOLDS, IDLE_SCREEN_KINDS, idleScreenKindOf, nextSchedule, resolveIdlePolicy, selectTimeoutDialog } from '../../../src/app/kiosk/state/idle';
import { createClinicData, SCREEN_STATES } from '../../../src/app/kiosk/state/session-store';
import type { KioskState, ScreenState } from '../../../src/app/kiosk/state/session-store';
import { DEFAULT_IDLE_THRESHOLDS as SERVER_DEFAULTS, IDLE_SCREEN_KINDS as SERVER_KINDS } from '../../../src/server/idle-policy';
import { DD10_SCREENS, makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';
import { stateAt } from '../../fixtures/kiosk/state.fixture';

// DD-10 무조작 정책의 읽기와 일정 계산(순수 함수). 닫는 AC: AC-015h(타이머 없는 화면). 증거: AC-015a·b·c·i 의 구성 부분.
// 시간이 실제로 흐르는 시험은 idle-timers.test.ts, 실제 catalog 라우트와 이어 보는 시험은 idle-policy-integration.test.ts 다.

describe('resolveIdlePolicy: catalog 응답의 idlePolicy → 화면 종류별 임계값', () => {
  it('정책이 없으면(응답에 idlePolicy 가 없음) DD-10 표의 값이고 completionHoldSeconds 는 null 이다', () => {
    expect(resolveIdlePolicy(undefined)).toEqual({ screens: DD10_SCREENS, completionHoldSeconds: null });
  });

  it('클라이언트의 기본값은 서버의 DD-10 기본값과 같은 표다 (어긋나면 이 시험이 깨진다)', () => {
    expect([...IDLE_SCREEN_KINDS]).toEqual([...SERVER_KINDS]);
    expect(DEFAULT_IDLE_THRESHOLDS).toEqual(SERVER_DEFAULTS);
  });

  it('screens 가 없으면 다섯 종류 모두 표의 값이다', () => {
    expect(resolveIdlePolicy({ completionHoldSeconds: 30 }).screens).toEqual(DD10_SCREENS);
  });

  it('응답에 담긴 화면 종류는 응답 값을, 빠진 화면 종류는 표의 값을 쓴다', () => {
    const resolved = resolveIdlePolicy({ screens: { INPUT: { warnSeconds: 90, resetSeconds: 110 }, HOLD_RESULT: { warnSeconds: 30, resetSeconds: 60 } }, completionHoldSeconds: null });
    expect(resolved.screens).toEqual({ ...DD10_SCREENS, INPUT: { warnSeconds: 90, resetSeconds: 110 }, HOLD_RESULT: { warnSeconds: 30, resetSeconds: 60 } });
  });

  it.each([
    ['객체가 아니다', 'x'],
    ['null', null],
    ['경고 값이 없다', { resetSeconds: 120 }],
    ['초기화 값이 없다', { warnSeconds: 90 }],
    ['숫자가 아니다', { warnSeconds: '90', resetSeconds: 110 }],
    ['초기화 값이 숫자가 아니다', { warnSeconds: 90, resetSeconds: '110' }],
    ['NaN', { warnSeconds: Number.NaN, resetSeconds: 110 }],
    ['무한대', { warnSeconds: 90, resetSeconds: Number.POSITIVE_INFINITY }],
    ['경고가 음수', { warnSeconds: -1, resetSeconds: 110 }],
    ['초기화가 경고와 같다', { warnSeconds: 90, resetSeconds: 90 }],
    ['초기화가 경고보다 앞선다', { warnSeconds: 90, resetSeconds: 80 }],
  ])('읽을 수 없는 화면 종류 값(%s)은 그 종류만 표의 값으로 돌아간다', (_name, entry) => {
    const resolved = resolveIdlePolicy({ screens: { INPUT: entry, RESULT: { warnSeconds: 70, resetSeconds: 99 } }, completionHoldSeconds: null } as unknown as IdlePolicyDto);
    expect(resolved.screens.INPUT).toEqual(DD10_SCREENS.INPUT);
    expect(resolved.screens.RESULT).toEqual({ warnSeconds: 70, resetSeconds: 99 });
  });

  it('경고 0초는 받아들인다 (서버 저장 검증과 같다: 0 이상)', () => {
    expect(resolveIdlePolicy({ screens: { INPUT: { warnSeconds: 0, resetSeconds: 20 } }, completionHoldSeconds: null }).screens.INPUT).toEqual({ warnSeconds: 0, resetSeconds: 20 });
  });

  it.each([
    [25, 25],
    [1, 1],
    [null, null],
    [undefined, null],
    [0, null],
    [-5, null],
    [1.5, null],
    [Number.NaN, null],
    [Number.MAX_SAFE_INTEGER + 2, null],
    ['10', null],
  ])('completionHoldSeconds %j → %j: 양의 정수일 때만 그 값이고 아니면 null 이다 (10 으로 바꿔 쓰지 않는다)', (input, expected) => {
    const resolved = resolveIdlePolicy({ completionHoldSeconds: input } as unknown as IdlePolicyDto);
    expect(resolved.completionHoldSeconds).toBe(expected);
  });

  it('돌려주는 값은 응답 객체와 별개의 사본이다 (응답을 나중에 고쳐도 정책이 바뀌지 않는다)', () => {
    const response: IdlePolicyDto = { screens: { INPUT: { warnSeconds: 90, resetSeconds: 110 } }, completionHoldSeconds: 20 };
    const resolved = resolveIdlePolicy(response);
    (response.screens as { INPUT: { warnSeconds: number } }).INPUT.warnSeconds = 1;
    expect(resolved.screens.INPUT.warnSeconds).toBe(90);
    expect(resolved.screens).not.toBe(DEFAULT_IDLE_THRESHOLDS);
  });
});

describe('화면 → 화면 종류 (DD-10 표의 행)', () => {
  const EXPECTED: Record<ScreenState, string | null> = {
    K00_Start: null,
    K01_Generation: 'INPUT',
    K01_Generation_Unknown: 'NOTICE_PROGRESS_ERROR',
    K02_Type: 'INPUT',
    K02b_Cause: 'INPUT',
    K03_Treatments: 'INPUT',
    Calculating: 'NOTICE_PROGRESS_ERROR',
    K04_Result: 'RESULT',
    K04_Result_NotCovered: 'RESULT',
    K04_Result_Hold: 'HOLD_RESULT',
    KXX_Error_Network: 'NOTICE_PROGRESS_ERROR',
    K04_Basis_Calculation: 'BASIS_AND_DOCUMENTS',
    K07_Documents: 'BASIS_AND_DOCUMENTS',
    K07_Documents_Unknown: 'BASIS_AND_DOCUMENTS',
    K06_Complete: null,
  };

  it.each(SCREEN_STATES)('%s', (screen) => {
    expect(idleScreenKindOf(screen)).toBe(EXPECTED[screen]);
  });

  it('K00_Start 와 K06_Complete 만 무조작 타이머가 없다 (담는 화면 종류 5 + 없음 2)', () => {
    expect(SCREEN_STATES.filter((screen) => idleScreenKindOf(screen) === null)).toEqual(['K00_Start', 'K06_Complete']);
    expect(new Set(SCREEN_STATES.map(idleScreenKindOf).filter((kind) => kind !== null))).toEqual(new Set(IDLE_SCREEN_KINDS));
  });
});

describe('nextSchedule: 상태에서 다음에 올 시각을 읽는다', () => {
  const withPolicy = (screen: ScreenState, patch: Partial<KioskState> = {}, policy?: IdlePolicyDto): KioskState =>
    stateAt(screen, { lastInteractionAt: 10_000, sessionStartedAt: 10_000, ...patch }, { catalog: makeCatalog(policy === undefined ? {} : { idlePolicy: policy }) });

  it('K00_Start 는 일정이 없다', () => {
    expect(nextSchedule(withPolicy('K00_Start'))).toBeNull();
  });

  it('입력 단계: 마지막 조작 + 경고 100초', () => {
    expect(nextSchedule(withPolicy('K01_Generation'))).toEqual({ kind: 'WARN', at: 10_000 + 100_000 });
  });

  it('결과 화면: 마지막 조작 + 경고 160초', () => {
    expect(nextSchedule(withPolicy('K04_Result'))).toEqual({ kind: 'WARN', at: 10_000 + 160_000 });
  });

  it('ResetConfirm 이 열려 있어도 일정은 경고 시각이다 (초기화 시점을 늦추지 않는다)', () => {
    expect(nextSchedule(withPolicy('K04_Result', { overlay: { kind: 'RESET_CONFIRM' } }))).toEqual({ kind: 'WARN', at: 10_000 + 160_000 });
  });

  it('TimeoutDialog 가 열려 있으면 열릴 때 정해 둔 초기화 시각이다 — 화면 종류나 마지막 조작과 상관없다', () => {
    const state = withPolicy('K04_Result', { overlay: { kind: 'TIMEOUT_DIALOG', openedAt: 170_000, resetAt: 190_000 }, lastInteractionAt: 999_999 });
    expect(nextSchedule(state)).toEqual({ kind: 'RESET', at: 190_000 });
  });

  it('K06_Complete: completionHoldSeconds 가 양의 정수면 세션 시작 + 그 값, null 이면 자동 복귀가 없다', () => {
    expect(nextSchedule(withPolicy('K06_Complete', {}, { screens: DD10_SCREENS, completionHoldSeconds: 25 }))).toEqual({ kind: 'COMPLETION_RETURN', at: 10_000 + 25_000 });
    expect(nextSchedule(withPolicy('K06_Complete', {}, { screens: DD10_SCREENS, completionHoldSeconds: null }))).toBeNull();
  });

  it('병원 정책의 임계값을 쓴다 (입력 단계 90/110)', () => {
    const state = withPolicy('K02_Type', {}, { screens: { INPUT: { warnSeconds: 90, resetSeconds: 110 } }, completionHoldSeconds: null });
    expect(nextSchedule(state)).toEqual({ kind: 'WARN', at: 10_000 + 90_000 });
  });
});

describe('selectTimeoutDialog', () => {
  it('겹침창이 TimeoutDialog 가 아니면 null', () => {
    expect(selectTimeoutDialog(stateAt('K04_Result'), 1_000)).toBeNull();
    expect(selectTimeoutDialog(stateAt('K04_Result', { overlay: { kind: 'RESET_CONFIRM' } }), 1_000)).toBeNull();
  });

  it('열린 TimeoutDialog: 초기화 시각과 남은 시간(밀리초, 0 아래로 내려가지 않음)', () => {
    const state = stateAt('K04_Result', { overlay: { kind: 'TIMEOUT_DIALOG', openedAt: 40_000, resetAt: 60_000 } });
    expect(selectTimeoutDialog(state, 45_000)).toEqual({ openedAt: 40_000, resetAt: 60_000, remainingMs: 15_000 });
    expect(selectTimeoutDialog(state, 61_000)?.remainingMs).toBe(0);
  });
});

describe('createClinicData: catalog·options 와 두 버전과 무조작 정책을 한 묶음으로 보관한다', () => {
  it('versions 는 catalog 응답의 catalogVersion 과 options 응답의 ruleBundleVersion 이다 (null 도 그대로)', () => {
    expect(createClinicData(makeCatalog(), makeOptions()).versions).toEqual({ catalogVersion: 'TEST_FIXTURE_CATALOG_V1', ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V1' });
    expect(createClinicData(makeCatalog({ catalogVersion: null }), makeOptions({ ruleBundleVersion: null })).versions).toEqual({ catalogVersion: null, ruleBundleVersion: null });
  });

  it('idle 은 catalog 응답의 idlePolicy 로 구성한다', () => {
    const data = createClinicData(makeCatalog({ idlePolicy: { screens: { INPUT: { warnSeconds: 90, resetSeconds: 110 } }, completionHoldSeconds: 15 } }), makeOptions());
    expect(data.idle.screens.INPUT).toEqual({ warnSeconds: 90, resetSeconds: 110 });
    expect(data.idle.screens.RESULT).toEqual(DD10_SCREENS.RESULT);
    expect(data.idle.completionHoldSeconds).toBe(15);
  });
});
