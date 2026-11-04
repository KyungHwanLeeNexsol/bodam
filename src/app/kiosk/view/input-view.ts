import type { BenefitTypeCode } from '../state/api-types';
import { COPY } from './copy';

// 입력 단계 카드의 표시 변환 (SPEC-REIMBURSEMENT-001 M6 S2, BRIEF D9). 응답(options·catalog)의 값을 디자인 카드 모양으로 나눌 뿐이고 값의 뜻을 바꾸거나 새로 만들지 않는다.
// 응답에 없는 보험 사실(세대별 기간, 코드 뜻)을 여기서 보태지 않는다: 코드 칩은 label 의 괄호 안 글자, 기간은 period 그대로다.

export interface GenerationLabel {
  readonly name: string;
  /** label 의 괄호 안(예: "2세대(C1)" → "C1"). 괄호가 없으면 null 이고 칩을 그리지 않는다. */
  readonly badge: string | null;
}

/** "2세대(C1)" → { name: "2세대", badge: "C1" }. 모양이 다르면 label 전체가 이름이다. */
export function splitGenerationLabel(label: string): GenerationLabel {
  const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(label.trim());
  const name = match?.[1]?.trim() ?? '';
  const badge = match?.[2]?.trim() ?? '';
  return match === null || name === '' || badge === '' ? { name: label.trim(), badge: null } : { name, badge };
}

/**
 * 가입 기간 줄. "2009.08.01~2015.09.01 이전" → "가입기간 2009.08.01 ~ 2015.09.01 이전" (물결 앞뒤 간격만 디자인대로 맞춘다).
 * "…이전"으로 끝나는 기간에만 "가입기간"을 붙인다: 4세대의 응답 문구("2021.07.01부터의 4세대 계약")는 기간 범위가 아니라 계약을 가리키는 문장이라 그대로 둔다.
 */
export function formatPeriod(period: string): string {
  const spaced = period.trim().replace(/\s*~\s*/g, ' ~ ');
  return spaced.endsWith('이전') ? `${COPY.input.generation.periodPrefix}${spaced}` : spaced;
}

/** 급여·비급여 표시. */
export function benefitLabel(benefitType: BenefitTypeCode): string {
  return benefitType === 'BENEFIT' ? COPY.input.treatments.benefit : COPY.input.treatments.nonBenefit;
}

/** "가입 시기를 모르실 때" 안내 문장을 문장 끝(마침표 뒤 공백)에서 줄로 나눈다. 문장을 고치지 않는다. */
export function guidanceLines(guidance: string): string[] {
  return guidance
    .split(/(?<=\.)\s+/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
