import type { EstimateResponseDto, EstimateResultState } from '../../../src/app/kiosk/state/api-types';
import type { KioskState, ScreenState } from '../../../src/app/kiosk/state/session-store';
import { FOUR_TREATMENTS, T_KIDNEY_SPRAY, T_PHYSIO, T_ULTRASOUND, T_XRAY, makeCatalog } from './clinic.fixture';
import { initialState } from './state.fixture';
import type { InitialOptions } from './state.fixture';

// 시험 자료(TEST_FIXTURE). 결과 화면(M6 S3a)이 읽는 계산 응답을 가진 세션 상태. 응답 본문 자체는 estimate-response.fixture.ts 에 있고(브라우저 시험도 쓴다) 여기서 다시 내보낸다.

export { POLICY_SOURCE, basisWith, docLine, estimatedResponse, holdResponse, notCoveredResponse, responseFor, singleCauseDocuments, unknownCauseDocuments, withAmounts } from './estimate-response.fixture';

/** 결과 화면 상태: 입력이 모두 있고(2세대(C1)·손해보험사·상해·치료 넷) 응답이 저장돼 있다. 화면은 응답의 결과 종류에 맞는다. */
export function resultStateWith(response: EstimateResponseDto, patch: Partial<KioskState> = {}, init: InitialOptions = {}, screen?: ScreenState): KioskState {
  const base = initialState({ catalog: makeCatalog({ treatments: [...FOUR_TREATMENTS] }), ...init });
  const byState: Record<EstimateResultState, ScreenState> = { ESTIMATED: 'K04_Result', ESTIMATED_WITH_EXCLUSIONS: 'K04_Result_NotCovered', ON_HOLD: 'K04_Result_Hold' };
  return {
    ...base,
    screen: screen ?? byState[response.result.state],
    inputs: { generation: 'GEN2_C1', insurerType: 'NON_LIFE', cause: 'INJURY', treatmentIds: [T_XRAY, T_ULTRASOUND, T_KIDNEY_SPRAY, T_PHYSIO] },
    inputRevision: 3,
    derived: { estimate: { state: response.result.state, response }, documents: response.documents as never, basis: null, returnContext: null },
    ...patch,
  };
}
