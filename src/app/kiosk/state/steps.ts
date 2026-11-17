import type { PatientInputs, ScreenState } from './session-store';

// 입력 단계(1/4 ~ 4/4)의 이동 표 (SPEC-REIMBURSEMENT-001 M5.A, design.md DD-07 전이표, DD-12 단계 표시).
// "다음"은 1-3단계에서 값이 있을 때만 활성이다. 4단계의 다음 동작은 "예상 부담액 확인"이며 계산 요청(M5.B)이다.

export interface StepNext {
  readonly to: ScreenState;
  /** 이 단계의 값이 있어 "다음"을 누를 수 있는가. */
  readonly ready: (inputs: PatientInputs) => boolean;
}

export const STEP_NEXT: Readonly<Partial<Record<ScreenState, StepNext>>> = {
  K01_Generation: { to: 'K02_Type', ready: (inputs) => inputs.generation !== null },
  K02_Type: { to: 'K02b_Cause', ready: (inputs) => inputs.insurerType !== null },
  K02b_Cause: { to: 'K03_Treatments', ready: (inputs) => inputs.cause !== null },
};

export const STEP_PREV: Readonly<Partial<Record<ScreenState, ScreenState>>> = {
  K02_Type: 'K01_Generation',
  K02b_Cause: 'K02_Type',
  K03_Treatments: 'K02b_Cause',
};

export const STEP_TOTAL = 4;

/** 단계 표시(1/4 실손보험 · 2/4 보험사 형태 · 3/4 치료 원인 · 4/4 치료 선택, AC-012a)의 순번. 문구는 화면(M6)이 정한다. */
export const STEP_INDEX: Readonly<Partial<Record<ScreenState, 1 | 2 | 3 | 4>>> = {
  K01_Generation: 1,
  K02_Type: 2,
  K02b_Cause: 3,
  K03_Treatments: 4,
};
