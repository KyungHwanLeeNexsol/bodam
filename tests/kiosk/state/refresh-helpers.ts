import { expect, vi } from 'vitest';
import type { CatalogDto, OptionsDto } from '../../../src/app/kiosk/state/api-types';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { DD10_SCREENS, SIX_TREATMENTS, T_KIDNEY_SPRAY, T_XRAY } from '../../fixtures/kiosk/clinic.fixture';
import { REPLIES, catalogBody, goToTreatments, optionsBody } from '../../fixtures/kiosk/transport.fixture';
import type { Kiosk, PendingCall, Reply } from '../../fixtures/kiosk/transport.fixture';

// 자료 갱신 시험이 함께 쓰는 도우미 (가짜 시계 위에서 쓴다).

export const SECOND = 1_000;

export const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

export const stateOf = (kiosk: Kiosk): KioskState => kiosk.controller.getState();

export interface Refreshing {
  readonly catalogCall: PendingCall;
  readonly optionsCall: PendingCall;
  readonly refreshId: string;
}

/** 현재 진행 중인 갱신(가장 최근 GET 두 개)을 돌려준다. */
export function currentRefresh(kiosk: Kiosk): Refreshing {
  const calls = kiosk.transport.refreshCalls();
  const catalogCall = calls[calls.length - 2] as PendingCall;
  const optionsCall = calls[calls.length - 1] as PendingCall;
  const refreshId = stateOf(kiosk).activeRefresh?.refreshId;
  if (refreshId === undefined) throw new Error('활성 갱신이 없다');
  return { catalogCall, optionsCall, refreshId };
}

/** 4단계까지 가서 "예상 부담액 확인" -> 지정한 응답(기본 409)으로 갱신이 시작된 상태를 만든다. */
export async function startRefreshing(kiosk: Kiosk, answer: Reply = REPLIES.mismatch): Promise<Refreshing> {
  goToTreatments(kiosk);
  expect(kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' })).toBe('APPLIED');
  const call = kiosk.transport.estimateCalls()[0] as PendingCall;
  call.respond(answer.status, answer.body);
  await flush();
  expect(stateOf(kiosk).refreshState).toBe('RUNNING');
  return currentRefresh(kiosk);
}

export async function resolveBoth(refreshing: Refreshing, catalog: CatalogDto = catalogBody(), options: OptionsDto = optionsBody()): Promise<void> {
  refreshing.catalogCall.respond(200, catalog);
  refreshing.optionsCall.respond(200, options);
  await flush();
}

/** 새 카탈로그: 선택한 치료 둘 가운데 신장분사치료(T_KIDNEY_SPRAY)가 게시에서 내려갔다. */
export const withoutKidney = (): CatalogDto => catalogBody({ treatments: SIX_TREATMENTS.filter((treatment) => treatment.treatmentId !== T_KIDNEY_SPRAY) });
/** 새 카탈로그: 선택한 치료가 모두 내려갔다. */
export const withoutSelected = (): CatalogDto => catalogBody({ treatments: SIX_TREATMENTS.filter((treatment) => treatment.treatmentId !== T_KIDNEY_SPRAY && treatment.treatmentId !== T_XRAY) });
/** 새 카탈로그: 가격만 바뀌고 무조작 정책의 입력 단계 값이 90/110 이다. */
export const repriced = (): CatalogDto =>
  catalogBody({
    treatments: SIX_TREATMENTS.map((treatment) => (treatment.treatmentId === T_XRAY ? { ...treatment, patientAmount: 12_000 } : treatment)),
    idlePolicy: { screens: { ...DD10_SCREENS, INPUT: { warnSeconds: 90, resetSeconds: 110 } }, completionHoldSeconds: null },
  });

