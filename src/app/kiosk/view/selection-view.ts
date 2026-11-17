import type { CauseCode, EstimateResponseDto } from '../state/api-types';
import type { KioskState } from '../state/session-store';
import { COPY } from './copy';
import { list } from './response-read';

// 고른 값의 표시 (SPEC-REIMBURSEMENT-001 M6 S3a·S3b): 결과·계산 근거·필요 서류 화면이 같은 "보험 조건·선택한 치료" 요약을 쓴다.
// 환자가 고른 값(state.inputs)과 병원 자료(state.clinic)에서 읽고, 계산 응답은 카탈로그에서 사라진 치료의 이름을 찾을 때만 본다. 내부 코드는 찾지 못하면 빠지고 화면에 나오지 않는다.

export interface SelectionView {
  /** "2세대(C1)". options 응답의 label 이고 찾지 못하면 null. */
  readonly generationLabel: string | null;
  /** "손해보험사". */
  readonly insurerLabel: string | null;
  /** "2세대(C1) · 손해보험사". 찾지 못한 부분은 빠진다. */
  readonly insuranceLabel: string | null;
  readonly treatmentNames: readonly string[];
  /** "X-ray, 초음파, 신장분사치료, 물리치료 (4개)". */
  readonly treatmentSummary: string;
}

/** 선택한 치료의 이름: 카탈로그 순서(디자인의 "X-ray, 초음파, …")가 먼저이고, 카탈로그에서 사라진 선택은 응답 줄의 이름을 쓴다. */
export function describeSelection(state: KioskState, response: EstimateResponseDto): SelectionView {
  const lines = list(response.result.lines);
  const catalog = state.clinic.catalog.treatments;
  const selected = state.inputs.treatmentIds;
  const known = new Set(catalog.map((entry) => entry.treatmentId));
  const treatmentNames = [
    ...catalog.filter((entry) => selected.includes(entry.treatmentId)).map((entry) => entry.displayName),
    ...selected.filter((id) => !known.has(id)).flatMap((id) => lines.find((entry) => entry.treatmentId === id)?.displayName ?? []),
  ];
  const { options } = state.clinic;
  const generationLabel = options.generations.find((card) => card.code === state.inputs.generation)?.label ?? null;
  const insurerLabel = options.insurerTypes.find((card) => card.code === state.inputs.insurerType)?.label ?? null;
  const parts = [generationLabel, insurerLabel].flatMap((label) => label ?? []);
  return {
    generationLabel,
    insurerLabel,
    insuranceLabel: parts.length === 0 ? null : parts.join(' · '),
    treatmentNames,
    treatmentSummary: `${treatmentNames.join(', ')} (${treatmentNames.length}개)`,
  };
}

/** 치료 원인의 짧은 말: 서류 화면의 "청구 기준"과 근거 화면의 "치료 원인"이 쓴다. 모름은 "상해 또는 질병 (선택 안 함)". */
export function causeWord(cause: CauseCode | null): string | null {
  switch (cause) {
    case 'INJURY':
      return COPY.documents.causeInjury;
    case 'ILLNESS':
      return COPY.documents.causeIllness;
    case 'UNKNOWN':
      return COPY.documents.causeUnknown;
    case null:
      return null;
  }
}
