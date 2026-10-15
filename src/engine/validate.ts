import { isWon, sumLineAmounts } from './numeric';
import type { CheckedResult } from './numeric';
import { GENERATIONS } from './types';
import type { EngineRejection, EstimateInput, Generation, PublishedLine, Won } from './types';

// 엔진 입력 검증 (design.md DD-03 "엔진 입력 검증", DD-04 호출 순서 1, DD-24).
// 기대되는 입력 결함은 던지지 않고 거절 결과로 돌려준다. 거절은 계산 결과가 아니라 거절이다(보류 아님).
// 판정 순서: 세대 열거 → 치료 0개 → 줄 금액 범위와 병원 결제액 T 의 검사 합산.

export interface ValidatedInput {
  generation: Generation;
  /** 중복을 제거하고 유니코드 코드 포인트 순으로 정렬한 치료 ID. 1개 이상. */
  treatmentIds: string[];
  /** treatmentId 중복을 제거하고 코드 포인트 순으로 정렬한 치료 줄. */
  lines: PublishedLine[];
  /** treatmentId 중복을 제거하고 코드 포인트 순으로 정렬한 공통 기본비용 줄. */
  baseFeeLines: PublishedLine[];
  /**
   * 예상 병원 결제액 T = 치료 줄과 기본비용 줄의 환자 결제액 검사 합산.
   * 안전 정수이며 MAX_AMOUNT_WON 보다 클 수 있다(줄 하나가 아니라 합계이므로).
   */
  hospitalPayment: Won;
}

export type ValidationResult =
  | { ok: true; value: ValidatedInput }
  | { ok: false; rejection: EngineRejection };

export function isGeneration(value: unknown): value is Generation {
  return typeof value === 'string' && (GENERATIONS as readonly string[]).includes(value);
}

/**
 * 유니코드 코드 포인트 순 비교. 기본 sort() 는 UTF-16 코드 단위로 비교하므로
 * 보충 문자(U+10000 이상)와 U+E000~U+FFFF 사이에서 순서가 달라진다.
 */
export function compareCodePoints(a: string, b: string): number {
  const left = a[Symbol.iterator]();
  const right = b[Symbol.iterator]();
  for (;;) {
    const l = left.next();
    const r = right.next();
    if (l.done) {
      return r.done ? 0 : -1;
    }
    if (r.done) {
      return 1;
    }
    const lc = l.value.codePointAt(0) as number;
    const rc = r.value.codePointAt(0) as number;
    if (lc !== rc) {
      return lc < rc ? -1 : 1;
    }
  }
}

/** 같은 treatmentId 의 줄은 한 번으로 치고(입력 순서의 첫 줄을 남김) 코드 포인트 순으로 돌려준다. */
function dedupeByTreatmentId(lines: readonly PublishedLine[]): PublishedLine[] {
  const seen = new Set<string>();
  const unique: PublishedLine[] = [];
  for (const line of lines) {
    if (!seen.has(line.treatmentId)) {
      seen.add(line.treatmentId);
      unique.push(line);
    }
  }
  return unique.sort((x, y) => compareCodePoints(x.treatmentId, y.treatmentId));
}

// @MX:ANCHOR: [AUTO] 엔진 입력 검증의 단일 진입점. estimate() 앞단(M1.2)과 서버 계산 경로(M4)가 같은 검증을 거친다.
// @MX:REASON: 거절 판정 순서(세대 → 치료 0개 → 수치)와 줄 금액·T 검사가 어긋나면 잘못된 병원 결제액이 숫자처럼 나간다(DD-24).
/**
 * 엔진 입력을 검증하고 중복 제거·정렬한 입력과 예상 병원 결제액 T 를 돌려준다.
 * sum 은 T 의 검사 합산 함수다. 기본값은 numeric.ts 의 sumLineAmounts 이며,
 * 줄 9,007,200개가 필요한 넘침 경계를 시험하기 위한 시험 대역 주입 자리다 (acceptance.md AC-003h 10행).
 */
export function validateEstimateInput(
  input: EstimateInput,
  sum: (amounts: readonly number[]) => CheckedResult = sumLineAmounts,
): ValidationResult {
  if (!isGeneration(input.generation)) {
    return { ok: false, rejection: { code: 'UNSUPPORTED_GENERATION' } };
  }

  const treatmentIds = Array.isArray(input.treatmentIds)
    ? [...new Set(input.treatmentIds)].sort(compareCodePoints)
    : [];
  if (treatmentIds.length === 0) {
    return { ok: false, rejection: { code: 'NO_TREATMENT_SELECTED' } };
  }

  // 잘못된 줄을 보류로 돌리거나 합계에서 빼지 않는다. 하나라도 무효이면 계산 없이 거절한다.
  // 중복 제거로 버려질 줄도 포함해 원본 배열 전체를 먼저 검사한다(무효 금액을 조용히 버리지 않기 위해서다).
  if (![...input.lines, ...input.baseFeeLines].every((line) => isWon(line.patientAmount))) {
    return { ok: false, rejection: { code: 'INVALID_NUMERIC_INPUT', reason: 'LINE_AMOUNT_INVALID' } };
  }

  const lines = dedupeByTreatmentId(input.lines);
  const baseFeeLines = dedupeByTreatmentId(input.baseFeeLines);
  const total = sum([...lines, ...baseFeeLines].map((line) => line.patientAmount));
  if (!total.ok) {
    return {
      ok: false,
      rejection: {
        code: 'INVALID_NUMERIC_INPUT',
        reason: total.reason === 'OVERFLOW' ? 'HOSPITAL_PAYMENT_OVERFLOW' : 'LINE_AMOUNT_INVALID',
      },
    };
  }

  return {
    ok: true,
    value: {
      generation: input.generation,
      treatmentIds,
      lines,
      baseFeeLines,
      hospitalPayment: total.value,
    },
  };
}
