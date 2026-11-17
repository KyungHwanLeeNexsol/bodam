import { describe, expect, it } from 'vitest';
import {
  abortsOnRefreshSettle,
  beginRefresh,
  buildRefreshUrls,
  canRetryRefresh,
  cancelRefresh,
  isRefreshOutcomeEvent,
  outcomeOfRefreshEvent,
  refreshSettlementOf,
  settleRefresh,
  settleRefreshOnEvent,
  treatmentsLocked,
} from '../../../src/app/kiosk/state/refresh';
import type { RefreshOutcome } from '../../../src/app/kiosk/state/refresh';
import { applyInputs, createClinicData, resetSession } from '../../../src/app/kiosk/state/session-store';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import type { KioskEvent } from '../../../src/app/kiosk/state/events';
import { T_KIDNEY_SPRAY, T_ULTRASOUND, T_XRAY, makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';
import { FULL_INPUTS, makeEnv, markerIds, sequenceIds, stateAt } from '../../fixtures/kiosk/state.fixture';
import { catalogBody, optionsBody } from '../../fixtures/kiosk/transport.fixture';
import { withoutKidney } from './refresh-helpers';

// 자료 갱신 생명주기의 순수 함수를 직접 본다 (design.md DD-09 "자료 갱신 생명주기" 규칙 2~5, DD-08 "409·422 뒤 자료 갱신 반영").
// 부수 효과(두 GET·타이머·취소)는 refresh-lifecycle.test.ts 가 컨트롤러 위에서 본다.

const env = makeEnv(5_000, sequenceIds('NEW'), markerIds('RID-UNIT'), markerIds('RFR-UNIT'));
const k03 = (patch: Partial<KioskState> = {}): KioskState => stateAt('K03_Treatments', { inputs: FULL_INPUTS, inputRevision: 2, ...patch });
const running = (patch: Partial<KioskState> = {}, refreshId = 'RFR-UNIT-A'): KioskState => {
  const base = k03({ refreshState: 'RUNNING', ...patch });
  return { ...base, activeRefresh: { refreshId, sessionId: base.sessionId, inputRevision: base.inputRevision, reason: 'VERSION_MISMATCH' } };
};
const ok = (catalog = catalogBody(), options = optionsBody()) => ({ outcome: 'SUCCEEDED', catalog, options }) as const;

describe('beginRefresh · canRetryRefresh · treatmentsLocked', () => {
  it('RUNNING 으로 두고 활성 갱신을 기록한다: 식별자는 env 발급기에서 한 번, 세션·입력 번호·이유와 함께. 화면·선택은 그대로다', () => {
    const state = k03();
    const next = beginRefresh(state, env, 'TREATMENT_NOT_PUBLISHED');
    expect(next.refreshState).toBe('RUNNING');
    expect(next.activeRefresh).toEqual({ refreshId: 'RFR-UNIT-0001', sessionId: state.sessionId, inputRevision: 2, reason: 'TREATMENT_NOT_PUBLISHED' });
    expect(next.screen).toBe('K03_Treatments');
    expect(next.inputs).toBe(state.inputs);
    expect(beginRefresh(state, env, 'RETRY').activeRefresh?.refreshId).toBe('RFR-UNIT-0002');
  });

  it('활성 갱신이 있으면 먼저 취소하고 새 갱신으로 교체한다', () => {
    const state = running();
    const next = beginRefresh(state, env, 'RETRY');
    expect(next.activeRefresh).toMatchObject({ reason: 'RETRY' });
    expect(next.activeRefresh?.refreshId).not.toBe('RFR-UNIT-A');
    expect(next.refreshState).toBe('RUNNING');
  });

  it('인라인 "다시 시도"는 실패 상태의 4단계에서만 있다', () => {
    expect(canRetryRefresh(k03({ refreshState: 'FAILED' }))).toBe(true);
    expect(canRetryRefresh(k03({ refreshState: 'RUNNING' }))).toBe(false);
    expect(canRetryRefresh(k03({ refreshState: 'NONE' }))).toBe(false);
    expect(canRetryRefresh(stateAt('K02_Type', { inputs: FULL_INPUTS, refreshState: 'FAILED' }))).toBe(false);
    expect(canRetryRefresh(running({ refreshState: 'FAILED' }))).toBe(false);
  });

  it('치료 카드·이전은 진행 중(RUNNING)일 때만 잠긴다', () => {
    expect([treatmentsLocked(k03({ refreshState: 'RUNNING' })), treatmentsLocked(k03({ refreshState: 'FAILED' })), treatmentsLocked(k03())]).toEqual([true, false, false]);
  });

  it('두 GET 의 주소는 병원 slug 에서만 만든다 (식별자 없음, 경로 조각 인코딩)', () => {
    expect(buildRefreshUrls(k03())).toEqual({ catalog: '/api/clinics/test-fixture-clinic-1/catalog', options: '/api/clinics/test-fixture-clinic-1/insurance/options' });
    const odd = k03({ clinic: createClinicData(makeCatalog({ clinic: { slug: 'a b/c', displayName: 'x', setting: 'OUTPATIENT_ONLY' } }), makeOptions()) });
    expect(buildRefreshUrls(odd).catalog).toBe('/api/clinics/a%20b%2Fc/catalog');
  });
});

describe('settleRefresh 1단계: 활성 갱신과 맞지 않으면 아무것도 바꾸지 않는다', () => {
  it('활성 갱신이 없다 / refreshId 가 다르다', () => {
    const idle = k03();
    expect(settleRefresh(idle, 'RFR-UNIT-A', { outcome: 'FAILED' })).toBe(idle);
    const state = running();
    expect(settleRefresh(state, 'RFR-UNIT-OTHER', ok())).toBe(state);
  });

  it('활성 갱신의 sessionId·inputRevision 이 지금과 다르다 (방어): 완료 계열 결말은 버린다', () => {
    const wrongSession = { ...running(), sessionId: 'SESSION-OTHER' };
    const wrongRevision = { ...running(), inputRevision: 99 };
    for (const state of [wrongSession, wrongRevision]) {
      for (const settlement of [ok(), { outcome: 'FAILED' }, { outcome: 'EXPIRED' }] as const) expect(settleRefresh(state, 'RFR-UNIT-A', settlement)).toBe(state);
    }
  });

  it('취소는 refreshId 만 본다: 세션·입력 번호가 어긋난 활성 갱신도 풀린다 (그 값을 바꾸는 동작이 자기 값을 바꾸기 전에 부르는 정리다)', () => {
    const zombie = { ...running(), sessionId: 'SESSION-OTHER', inputRevision: 99 };
    expect(cancelRefresh(zombie).activeRefresh).toBeNull();
    expect(cancelRefresh(zombie).refreshState).toBe('FAILED');
  });
});

describe('settleRefresh 2·3단계', () => {
  it.each([{ outcome: 'FAILED' }, { outcome: 'EXPIRED' }, { outcome: 'CANCELLED' }] as const)('%j: 활성 갱신을 풀고 FAILED 로 둔다. 자료·선택·화면·무조작 시각은 그대로다', (settlement) => {
    const state = running();
    const next = settleRefresh(state, 'RFR-UNIT-A', settlement);
    expect(next.activeRefresh).toBeNull();
    expect(next.refreshState).toBe('FAILED');
    expect(next.clinic).toBe(state.clinic);
    expect(next.inputs).toBe(state.inputs);
    expect(next.screen).toBe('K03_Treatments');
    expect(next.lastInteractionAt).toBe(state.lastInteractionAt);
    expect(next.derived).toBe(state.derived);
  });

  it('첫 유효 호출만 처리하고 같은 시도의 다음 호출은 같은 상태 참조를 돌려준다', () => {
    const first = settleRefresh(running(), 'RFR-UNIT-A', ok());
    expect(first.refreshState).toBe('NONE');
    expect(settleRefresh(first, 'RFR-UNIT-A', ok())).toBe(first);
    expect(settleRefresh(first, 'RFR-UNIT-A', { outcome: 'FAILED' })).toBe(first);
  });

  it('성공 (제거 없음): 자료·두 버전·무조작 정책을 함께 바꾸고 파생 데이터를 지우되, 선택·inputRevision·안내는 그대로(없음)다', () => {
    const derived = { estimate: { state: 'ESTIMATED' as const }, documents: null, basis: null, returnContext: { resultVariant: 'NORMAL' as const } };
    const state = running({ derived });
    const catalog = catalogBody({ idlePolicy: { screens: { INPUT: { warnSeconds: 40, resetSeconds: 70 } }, completionHoldSeconds: 9 } });
    const options = optionsBody();
    const next = settleRefresh(state, 'RFR-UNIT-A', ok(catalog, options));
    expect(next.clinic).toEqual(createClinicData(catalog, options));
    expect(next.clinic.idle.screens.INPUT).toEqual({ warnSeconds: 40, resetSeconds: 70 });
    expect(next.clinic.idle.completionHoldSeconds).toBe(9);
    expect(next.derived).toEqual({ estimate: null, documents: null, basis: null, returnContext: null });
    expect(next.inputs).toBe(state.inputs);
    expect(next.inputRevision).toBe(state.inputRevision);
    expect(next.refreshNotice).toBeNull();
    expect(next.refreshState).toBe('NONE');
    expect(next.activeRefresh).toBeNull();
    expect(next.lastInteractionAt).toBe(state.lastInteractionAt);
  });

  it('성공 (제거 있음): 게시 중인 선택만 남기고 순서를 지키며, 빠진 치료는 이름과 함께 안내에 남고, inputRevision 이 한 번 오른다', () => {
    const state = running({ refreshNotice: { removed: [{ treatmentId: 'OLD', displayName: '옛 안내' }] } });
    const next = settleRefresh(state, 'RFR-UNIT-A', ok(withoutKidney()));
    expect(next.inputs.treatmentIds).toEqual([T_XRAY]);
    expect(next.inputRevision).toBe(3);
    expect(next.refreshNotice).toEqual({ removed: [{ treatmentId: T_KIDNEY_SPRAY, displayName: 'TEST_FIXTURE 신장분사치료' }] });
  });

  it('성공 (제거 있음): 이전 카탈로그에도 없던 선택 id(강제 구성)는 이름 대신 id 로 안내한다', () => {
    const state = running({ inputs: { ...FULL_INPUTS, treatmentIds: [T_XRAY, 'GHOST'] } });
    const next = settleRefresh(state, 'RFR-UNIT-A', ok());
    expect(next.inputs.treatmentIds).toEqual([T_XRAY]);
    expect(next.refreshNotice).toEqual({ removed: [{ treatmentId: 'GHOST', displayName: 'GHOST' }] });
  });

  it('성공 (제거 없음)은 이전 안내를 비운다', () => {
    const state = running({ refreshNotice: { removed: [{ treatmentId: 'OLD', displayName: '옛 안내' }] } });
    expect(settleRefresh(state, 'RFR-UNIT-A', ok()).refreshNotice).toBeNull();
  });
});

describe('초기화·입력 변경이 활성 갱신을 먼저 풀어야 한다 (DD-09 규칙 5)', () => {
  it('resetSession: 갱신 상태 NONE, 활성 갱신 없음, 안내 비움', () => {
    const next = resetSession(running({ refreshNotice: { removed: [] } }), env, 'K00_Start');
    expect(next).toMatchObject({ screen: 'K00_Start', refreshState: 'NONE', activeRefresh: null, refreshNotice: null });
  });

  it('applyInputs 의 실제 변경: 진행 중인 갱신을 취소하고 FAILED 로 두며 안내를 비운다. 같은 값이면 그대로다', () => {
    const state = running({ refreshNotice: { removed: [] } });
    const same = applyInputs(state, state.inputs);
    expect(same).toBe(state);
    const changed = applyInputs(state, { ...state.inputs, generation: 'GEN4_C4' });
    expect(changed).toMatchObject({ activeRefresh: null, refreshState: 'FAILED', refreshNotice: null, inputRevision: 3 });
  });

  it('갱신이 없던 상태의 입력 변경은 갱신 상태를 건드리지 않는다', () => {
    const state = k03({ refreshState: 'FAILED' });
    expect(applyInputs(state, { ...state.inputs, treatmentIds: [T_ULTRASOUND] }).refreshState).toBe('FAILED');
  });
});

describe('결말 사건 읽기', () => {
  const rid = 'RFR-UNIT-A';
  const state = running();

  it('REFRESH_FAILED / REFRESH_EXPIRED 는 그 결말이고, 읽을 수 있는 두 본문이 같은 병원의 것이면 RESOLVED 가 SUCCEEDED 다', () => {
    expect(refreshSettlementOf({ type: 'REFRESH_FAILED', refreshId: rid }, state)).toEqual({ outcome: 'FAILED' });
    expect(refreshSettlementOf({ type: 'REFRESH_EXPIRED', refreshId: rid }, state)).toEqual({ outcome: 'EXPIRED' });
    const catalog = catalogBody();
    const options = optionsBody();
    expect(refreshSettlementOf({ type: 'REFRESH_RESOLVED', refreshId: rid, catalog, options }, state)).toEqual({ outcome: 'SUCCEEDED', catalog, options });
  });

  const BAD_CATALOGS: Array<[string, unknown]> = [
    ['객체가 아니다', 'x'],
    ['배열이다', []],
    ['clinic 이 없다', { ...catalogBody(), clinic: undefined }],
    ['slug 가 문자열이 아니다', { ...catalogBody(), clinic: { slug: 1, displayName: 'x' } }],
    ['serviceDisplayName 이 없다', { ...catalogBody(), serviceDisplayName: undefined }],
    ['catalogVersion 이 문자열도 null 도 아니다', { ...catalogBody(), catalogVersion: 3 }],
    ['baseFeeIncluded 가 열거값 밖이다', { ...catalogBody(), baseFeeIncluded: 'MAYBE' }],
    ['idlePolicy 가 객체가 아니다', { ...catalogBody(), idlePolicy: 'x' }],
    ['치료 목록이 배열이 아니다', { ...catalogBody(), treatments: {} }],
    ['치료의 금액이 음수다', { ...catalogBody(), treatments: [{ ...catalogBody().treatments[0], patientAmount: -1 }] }],
    ['치료의 금액이 정수가 아니다', { ...catalogBody(), treatments: [{ ...catalogBody().treatments[0], patientAmount: 1.5 }] }],
    ['치료의 급여 구분이 열거값 밖이다', { ...catalogBody(), treatments: [{ ...catalogBody().treatments[0], benefitType: 'FREE' }] }],
    ['치료 항목이 객체가 아니다', { ...catalogBody(), treatments: ['x'] }],
    ['기본비용의 금액이 문자열이다', { ...catalogBody(), baseFees: [{ baseFeeId: 'F', displayName: 'f', benefitType: 'BENEFIT', amount: '1' }] }],
  ];
  const BAD_OPTIONS: Array<[string, unknown]> = [
    ['객체가 아니다', null],
    ['ruleBundleVersion 이 문자열도 null 도 아니다', { ...optionsBody(), ruleBundleVersion: 1 }],
    ['ruleBundleStatus 가 열거값 밖이다', { ...optionsBody(), ruleBundleStatus: 'GONE' }],
    ['guidance 가 없다', { ...optionsBody(), guidance: undefined }],
    ['guidance 의 문구가 문자열이 아니다', { ...optionsBody(), guidance: { generationUnknown: 3 } }],
    ['세대 카드의 코드가 없다', { ...optionsBody(), generations: [{ label: 'x' }] }],
    ['형태 카드 목록이 배열이 아니다', { ...optionsBody(), insurerTypes: 'x' }],
    ['원인 카드의 라벨이 없다', { ...optionsBody(), causes: [{ code: 'INJURY' }] }],
  ];

  it.each(BAD_CATALOGS)('catalog 본문의 모양이 틀리면(%s) FAILED — options 가 멀쩡해도 아무것도 쓰지 않는다', (_name, catalog) => {
    expect(refreshSettlementOf({ type: 'REFRESH_RESOLVED', refreshId: rid, catalog, options: optionsBody() }, state)).toEqual({ outcome: 'FAILED' });
  });

  it.each(BAD_OPTIONS)('options 본문의 모양이 틀리면(%s) FAILED — catalog 가 멀쩡해도 아무것도 쓰지 않는다', (_name, options) => {
    expect(refreshSettlementOf({ type: 'REFRESH_RESOLVED', refreshId: rid, catalog: catalogBody(), options }, state)).toEqual({ outcome: 'FAILED' });
  });

  it('다른 병원의 catalog 는 반영하지 않는다', () => {
    const other = catalogBody({ clinic: { slug: 'other', displayName: 'x', setting: 'OUTPATIENT_ONLY' } });
    expect(refreshSettlementOf({ type: 'REFRESH_RESOLVED', refreshId: rid, catalog: other, options: optionsBody() }, state)).toEqual({ outcome: 'FAILED' });
  });

  it('settleRefreshOnEvent: 맞지 않으면 null (거절), 맞으면 새 상태', () => {
    expect(settleRefreshOnEvent(state, { type: 'REFRESH_FAILED', refreshId: 'RFR-UNIT-X' })).toBeNull();
    expect(settleRefreshOnEvent(state, { type: 'REFRESH_FAILED', refreshId: rid })?.refreshState).toBe('FAILED');
    expect(settleRefreshOnEvent(state, { type: 'REFRESH_RESOLVED', refreshId: rid, catalog: catalogBody(), options: optionsBody() })?.refreshState).toBe('NONE');
  });

  it('outcomeOfRefreshEvent: 결말 사건은 그 결말, 그 밖의 사건이 풀었다면 CANCELLED, 사건 없음도 CANCELLED, 읽을 수 없는 RESOLVED 는 FAILED', () => {
    expect(outcomeOfRefreshEvent({ type: 'REFRESH_EXPIRED', refreshId: rid }, state)).toBe('EXPIRED');
    expect(outcomeOfRefreshEvent({ type: 'REFRESH_RESOLVED', refreshId: rid, catalog: {}, options: {} }, state)).toBe('FAILED');
    expect(outcomeOfRefreshEvent({ type: 'REFRESH_RESOLVED', refreshId: rid, catalog: catalogBody(), options: optionsBody() }, state)).toBe('SUCCEEDED');
    for (const event of [{ type: 'CONFIRM_RESET' }, { type: 'PAGE_RESTORED' }, { type: 'RETRY_REFRESH' }, { type: 'TICK' }] as KioskEvent[]) {
      expect(isRefreshOutcomeEvent(event), event.type).toBe(false);
      expect(outcomeOfRefreshEvent(event, state), event.type).toBe('CANCELLED');
    }
    expect(outcomeOfRefreshEvent(null, state)).toBe('CANCELLED');
  });

  it('abortsOnRefreshSettle: 시간 초과와 취소 계열만 취소 수단을 쓴다', () => {
    const all: RefreshOutcome[] = ['SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'];
    expect(all.filter(abortsOnRefreshSettle)).toEqual(['EXPIRED', 'CANCELLED']);
  });
});
