import type { CatalogDto, EstimateResult, OptionsDto } from '../../../src/app/kiosk/state/api-types';
import type { Orientation } from '../../../src/app/kiosk/state/display';
import { createInitialState } from '../../../src/app/kiosk/state/session-store';
import type { Env, KioskState, PatientInputs, ScreenState } from '../../../src/app/kiosk/state/session-store';
import { T_KIDNEY_SPRAY, T_XRAY, makeCatalog, makeOptions } from './clinic.fixture';

// 시험 자료(TEST_FIXTURE). 상태 기계 시험이 원하는 화면에서 시작하도록 상태를 만든다.
// 결과·근거·서류 화면은 요청 생명주기(M5.B)가 있어야 도달하므로 A 단계 시험은 상태를 직접 구성해 시작한다.
// 구성은 운영 코드의 순수 함수(createInitialState)를 쓰고 필요한 칸만 덮어쓴다.

/** 알려진 값을 차례로 내는 세션 식별자 발급기: `${prefix}-1`, `${prefix}-2`, ... */
export function sequenceIds(prefix = 'SESSION'): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}

/** 표지 값을 차례로 내는 발급기: `${prefix}-0001`, `${prefix}-0002`, ... (표지 값이 어디에도 새지 않는지 문자열로 찾을 때 쓴다) */
export function markerIds(prefix: string): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${String(n).padStart(4, '0')}`;
  };
}

export function makeEnv(now = 0, newSessionId: () => string = sequenceIds(), newRequestId: () => string = markerIds('RID-FIXTURE'), newRefreshId: () => string = markerIds('RFR-FIXTURE')): Env {
  return { now, newSessionId, newRequestId, newRefreshId };
}

export interface InitialOptions {
  catalog?: CatalogDto;
  options?: OptionsDto;
  orientation?: Orientation;
  env?: Env;
}

/** 빈 세션 `K00_Start` 상태. */
export function initialState(init: InitialOptions = {}): KioskState {
  const catalog = init.catalog ?? makeCatalog();
  const options = init.options ?? makeOptions();
  return createInitialState(init.orientation === undefined ? { catalog, options } : { catalog, options, orientation: init.orientation }, init.env ?? makeEnv());
}

export const FULL_INPUTS: PatientInputs = { generation: 'GEN2_C1', insurerType: 'NON_LIFE', cause: 'INJURY', treatmentIds: [T_XRAY, T_KIDNEY_SPRAY] };

export const EMPTY_PATIENT_INPUTS: PatientInputs = { generation: null, insurerType: null, cause: null, treatmentIds: [] };

/** 지정한 화면에 있는 상태. 칸을 덮어쓰려면 patch 를 쓴다. */
export function stateAt(screen: ScreenState, patch: Partial<KioskState> = {}, init: InitialOptions = {}): KioskState {
  return { ...initialState(init), screen, ...patch };
}

const RESULT_STATE_OF: Partial<Record<ScreenState, EstimateResult['state']>> = {
  K04_Result: 'ESTIMATED',
  K04_Result_NotCovered: 'ESTIMATED_WITH_EXCLUSIONS',
  K04_Result_Hold: 'ON_HOLD',
};

/**
 * 계산이 끝난 세션: 입력이 모두 있고(세대·형태·원인·치료 둘) 결과가 저장되어 있다. 결과 상태는 화면에 맞춘다.
 * 근거·서류 화면은 결과 종류를 정하지 않으므로 기본은 정상(`ESTIMATED`)이다.
 */
export function resultSessionAt(screen: ScreenState, patch: Partial<KioskState> = {}, init: InitialOptions = {}): KioskState {
  const base = initialState(init);
  const resultState = RESULT_STATE_OF[screen] ?? 'ESTIMATED';
  return {
    ...base,
    screen,
    inputs: FULL_INPUTS,
    inputRevision: 3,
    derived: { estimate: { state: resultState }, documents: { marker: 'DOCUMENTS' }, basis: { marker: 'BASIS' }, returnContext: null },
    ...patch,
  };
}
