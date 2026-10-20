import type { BasisView, CatalogDto, CauseCode, DocumentsView, EstimateResult, GenerationCode, InsurerTypeCode, OptionsDto } from './api-types';
import type { DisplayState, Orientation } from './display';
import { EMPTY_DERIVED, EMPTY_INPUTS, NO_OVERLAY, createClinicData } from './defaults';
import type { ResolvedIdlePolicy } from './idle';
import { cancelRefresh } from './refresh';
import { cancelRequest } from './request';

export { createClinicData };

// 키오스크 세션 저장소: 환자 상태의 형식과 초기화·입력 변경 (SPEC-REIMBURSEMENT-001 M5.A, design.md DD-07·DD-08·DD-09·DD-13).
// 환자 상태는 이 객체 안(메모리)에만 있다. 저장소(localStorage·sessionStorage·IndexedDB·쿠키·Cache Storage)·URL 에 쓰지 않고 새로고침 뒤에 복원하지 않는다.
// 상태는 바꾸지 않는 값으로 다룬다: 모든 전이는 새 객체를 만들고, 바꾸지 않은 칸은 참조를 그대로 물려준다(시험이 참조 동일성으로 "건드리지 않음"을 본다).
// 병원 자료(catalog·options)는 환자 상태가 아니므로 초기화해도 남는다.

/** DD-07 상태 표의 15개 화면 상태. 겹침창(ResetConfirm, TimeoutDialog)은 화면이 아니라 `overlay` 에 따로 둔다. */
export const SCREEN_STATES = [
  'K00_Start',
  'K01_Generation',
  'K01_Generation_Unknown',
  'K02_Type',
  'K02b_Cause',
  'K03_Treatments',
  'Calculating',
  'K04_Result',
  'K04_Result_NotCovered',
  'K04_Result_Hold',
  'KXX_Error_Network',
  'K04_Basis_Calculation',
  'K07_Documents',
  'K07_Documents_Unknown',
  'K06_Complete',
] as const;
export type ScreenState = (typeof SCREEN_STATES)[number];

/** 겹침창은 동시에 하나만 열린다(DD-07). TimeoutDialog 의 초기화 시각은 열릴 때 정해지고 바뀌지 않는다(DD-07 규칙 4). 시각은 deps.now() 기준 밀리초다. */
export type OverlayState =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'RESET_CONFIRM' }
  | { readonly kind: 'TIMEOUT_DIALOG'; readonly openedAt: number; readonly resetAt: number };
export type OverlayKind = OverlayState['kind'];

/** 환자가 고른 값. 치료는 id 의 집합이다(수량이 없다: 이미 고른 치료를 다시 눌러도 수량이 늘지 않는다). */
export interface PatientInputs {
  readonly generation: GenerationCode | null;
  readonly insurerType: InsurerTypeCode | null;
  readonly cause: CauseCode | null;
  readonly treatmentIds: readonly string[];
}

export type ResultVariant = 'NORMAL' | 'NOT_COVERED';

/** 복귀 정보(DD-11): 어느 결과로 돌아갈지만 담는다. 표시 설정·화면 방향은 담지 않는다. */
export interface ReturnContext {
  readonly resultVariant: ResultVariant;
}

/** DD-08 이 입력 변경 때 한꺼번에 지우는 파생 데이터와 복귀 정보. */
export interface DerivedData {
  readonly estimate: EstimateResult | null;
  readonly documents: DocumentsView | null;
  readonly basis: BasisView | null;
  readonly returnContext: ReturnContext | null;
}

/** 병원 자료(환자 상태가 아님): 응답 본문, 두 버전, 응답에서 구성한 무조작 정책. 갱신(refresh.ts)은 이 묶음을 통째로 바꾼다. */
export interface ClinicData {
  readonly catalog: CatalogDto;
  readonly options: OptionsDto;
  readonly versions: { readonly catalogVersion: string | null; readonly ruleBundleVersion: string | null };
  readonly idle: ResolvedIdlePolicy;
}

export type RefreshState = 'NONE' | 'RUNNING' | 'FAILED';

// @MX:NOTE: [AUTO] DD-09 의 `activeRequest` 는 { requestId, sessionId, inputRevision, controller, timeoutHandle } 이지만 전이 함수를 순수하게 두려고 취소 수단(AbortController)과
// 시간 제한 타이머 핸들은 상태에 넣지 않는다. 그 둘은 컨트롤러가 활성 요청 하나마다 하나씩 쥐고(request-effects.ts), 활성 요청이 생기고 사라지는 것을 따라가며 만들고 푼다.
// 보호 규칙이 보는 세 값(요청·세션·입력 번호)은 그대로 상태에 있다.
/** DD-09 `activeRequest`: 진행 중인 계산 시도 하나. 시도가 없으면 null 이고, 이 값을 푸는 곳은 request.ts 의 settleRequest 하나뿐이다. */
export interface ActiveRequest {
  readonly requestId: string;
  readonly sessionId: string;
  readonly inputRevision: number;
}

/** catalog·options 갱신을 시작한 이유 (DD-09 "자료 갱신 생명주기", DD-19): 409, 422 `TREATMENT_NOT_PUBLISHED`, 환자의 인라인 "다시 시도". */
export type RefreshReason = 'VERSION_MISMATCH' | 'TREATMENT_NOT_PUBLISHED' | 'RETRY';

// @MX:NOTE: [AUTO] 요청의 activeRequest 와 같은 이유로 갱신의 AbortController(두 GET마다 하나)와 시간 제한 타이머 핸들은 상태에 넣지 않는다.
// 그 둘은 컨트롤러가 갱신 하나마다 쥐고(refresh-effects.ts) 활성 갱신이 생기고 사라지는 것을 따라가며 만들고 푼다.
/** DD-09 `activeRefresh`: 진행 중인 갱신 시도 하나(RUNNING 일 때만 있다). 시도가 없으면 null 이고, 이 값을 푸는 곳은 refresh.ts 의 settleRefresh 하나뿐이다. */
export interface ActiveRefresh {
  readonly refreshId: string;
  readonly sessionId: string;
  readonly inputRevision: number;
  readonly reason: RefreshReason;
}

/** 갱신 반영 때 게시에서 내려가 선택에서 빠진 치료의 안내용 기록 (DD-09 규칙 2 ①). 이름은 빠지기 전 카탈로그의 것이다. */
export interface RefreshNotice {
  readonly removed: readonly { readonly treatmentId: string; readonly displayName: string }[];
}

export interface KioskState {
  readonly screen: ScreenState;
  readonly overlay: OverlayState;
  /** 초기화마다 새로 만든다(기획서 §13.2 "세션 식별자 교체"). */
  readonly sessionId: string;
  readonly inputs: PatientInputs;
  /** 입력이 바뀔 때마다 1 오른다(DD-08). 세션이 바뀌면 0 으로 돌아간다(sessionId 가 다르므로 보호 규칙에는 영향이 없다). */
  readonly inputRevision: number;
  readonly derived: DerivedData;
  readonly display: DisplayState;
  readonly clinic: ClinicData;
  readonly refreshState: RefreshState;
  readonly activeRequest: ActiveRequest | null;
  readonly activeRefresh: ActiveRefresh | null;
  /** 마지막 갱신이 선택에서 뺀 치료의 안내. 초기화와 다음 입력 변경 때 비운다. */
  readonly refreshNotice: RefreshNotice | null;
  /** 치료 목록에서 보이는 첫 치료의 위치(0 부터). 쪽 번호는 표시 설정의 한 쪽 개수로 나눠 읽는다(selectors.selectTreatmentPage). */
  readonly treatmentPageOffset: number;
  /** 마지막 환자 조작 시각. 환자 사건만 이 값을 쓴다: 서버 응답·내부 갱신·시계 사건은 쓰지 않는다(DD-10). */
  readonly lastInteractionAt: number;
  /** 현재 세션이 열린 시각. 이용 완료 화면(K06_Complete)의 자동 복귀는 이 시각에서 센다(전체 삭제 직후에 그 화면이 열리므로 진입 시각과 같다). */
  readonly sessionStartedAt: number;
}

/** 키오스크가 처음 받는 병원 자료. 네트워크로 받는 일은 화면 쪽의 시작 단계(M6)가 맡고 상태 기계는 받은 응답을 넘겨받는다. */
export interface KioskInit {
  readonly catalog: CatalogDto;
  readonly options: OptionsDto;
  readonly orientation?: Orientation;
}

/** 전이 함수가 받는 바깥 값: 지금 시각과 새 세션·계산 시도 식별자 발급기. 전이 함수는 이것들 말고 바깥을 읽지 않는다. */
export interface Env {
  readonly now: number;
  newSessionId(): string;
  newRequestId(): string;
  newRefreshId(): string;
}


/** 키오스크가 켜진 직후의 상태: `K00_Start` 의 빈 세션. */
export function createInitialState(init: KioskInit, env: Env): KioskState {
  return {
    screen: 'K00_Start',
    overlay: NO_OVERLAY,
    sessionId: env.newSessionId(),
    inputs: EMPTY_INPUTS,
    inputRevision: 0,
    derived: EMPTY_DERIVED,
    display: { largeText: false, orientation: init.orientation ?? 'PORTRAIT' },
    clinic: createClinicData(init.catalog, init.options),
    refreshState: 'NONE',
    activeRequest: null,
    activeRefresh: null,
    refreshNotice: null,
    treatmentPageOffset: 0,
    lastInteractionAt: env.now,
    sessionStartedAt: env.now,
  };
}

// @MX:ANCHOR: [AUTO] 초기화가 확정되는 모든 길(처음으로·이용 완료·통신 오류의 이용 종료·무조작 초기화·새로고침·이용 완료 화면의 자동 복귀)의 유일한 전체 삭제 지점.
// @MX:REASON: 지우는 곳이 둘이면 한쪽만 큰 글자 끄기·새 sessionId·갱신 상태 비우기를 빠뜨려 이전 환자의 값이 다음 환자에게 남는다. 활성 요청은 settleRequest(…, CANCELLED)로 먼저 푼다
// (취소 수단과 타이머는 컨트롤러가 활성 요청·갱신이 사라지는 것을 보고 푼다). 활성 갱신도 settleRefresh(…, CANCELLED)로 먼저 푼다.
/**
 * 전체 삭제 = 세션 초기화(DD-07, DD-13). 새 sessionId 로 빈 세션을 만들고 `destination` 화면을 연다.
 * 큰 글자 보기는 꺼지고(plan.md §E #17) 관찰한 화면 방향과 병원 자료는 남는다. 겹침창·갱신 상태·활성 요청도 비운다.
 */
export function resetSession(state: KioskState, env: Env, destination: 'K00_Start' | 'K06_Complete'): KioskState {
  const settled = cancelRefresh(cancelRequest(state));
  return {
    screen: destination,
    overlay: NO_OVERLAY,
    sessionId: env.newSessionId(),
    inputs: EMPTY_INPUTS,
    inputRevision: 0,
    derived: EMPTY_DERIVED,
    display: { largeText: false, orientation: state.display.orientation },
    clinic: state.clinic,
    refreshState: 'NONE',
    activeRequest: settled.activeRequest,
    activeRefresh: settled.activeRefresh,
    refreshNotice: null,
    treatmentPageOffset: 0,
    lastInteractionAt: env.now,
    sessionStartedAt: env.now,
  };
}

/** 환자 입력이 하나라도 있는가. "처음으로"의 확인 규칙이 읽는다: "진행 중" = 세대·형태·원인·치료 가운데 하나라도 있음(plan.md §E #36). */
export function hasPatientInput(inputs: PatientInputs): boolean {
  return inputs.generation !== null || inputs.insurerType !== null || inputs.cause !== null || inputs.treatmentIds.length > 0;
}

function sameInputs(a: PatientInputs, b: PatientInputs): boolean {
  return (
    a.generation === b.generation &&
    a.insurerType === b.insurerType &&
    a.cause === b.cause &&
    a.treatmentIds.length === b.treatmentIds.length &&
    a.treatmentIds.every((id) => b.treatmentIds.includes(id))
  );
}

// @MX:ANCHOR: [AUTO] 확정된 입력값(세대·형태·원인·치료 묶음)을 바꾸는 유일한 길. 입력 단계의 모든 선택 사건이 거친다.
// @MX:REASON: 다른 값이면 파생 데이터와 복귀 정보를 지우고 inputRevision 을 1 올리는 것이 DD-08 이고, 요청 보호(DD-09)와 갱신 보호(DD-14)가 이 번호를 본다.
// 진행 중인 요청은 settleRequest(…, CANCELLED), 갱신은 settleRefresh(…, CANCELLED)로 여기서 먼저 푼다(갱신은 실패 상태가 되어 확인 버튼이 비활성인 채 인라인 "다시 시도"가 보인다, DD-09 규칙 5).
/**
 * 입력값을 바꾼다(DD-08). 같은 값(치료는 집합으로 비교)이면 같은 상태를 돌려주고, 다른 값이면 파생 데이터와 복귀 정보를 모두 지우고 `inputRevision` 을 1 올린다.
 * 큰 글자 보기·화면 방향은 건드리지 않는다.
 */
export function applyInputs(state: KioskState, inputs: PatientInputs): KioskState {
  return sameInputs(state.inputs, inputs) ? state : { ...cancelRefresh(cancelRequest(state)), inputs, inputRevision: state.inputRevision + 1, derived: EMPTY_DERIVED, refreshNotice: null };
}
