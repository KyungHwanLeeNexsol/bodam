import { isWon, sumLineAmounts } from './numeric';
import type { CheckedResult } from './numeric';
import { GENERATIONS } from './types';
import type { EngineRejection, EstimateInput, Generation, PublishedLine, Won } from './types';

// 엔진 입력 검증 (design.md DD-03 "엔진 입력 검증", DD-04 호출 순서 1, DD-24).
// 기대되는 입력 결함은 던지지 않고 거절 결과로 돌려준다. 거절은 계산 결과가 아니라 거절이다(보류 아님).
// 판정 순서: 세대 열거 → 치료 0개 → 충돌하는 중복 줄(INPUT_INTEGRITY_VIOLATION) → 줄 금액 범위와 병원 결제액 T 의 검사 합산.
//
// 중복 줄 계약: treatmentId 가 같고 내용(PublishedLine 의 모든 필드)이 완전히 같은 줄은 한 번으로 센다.
// 내용이 하나라도 다르면 어느 줄이 맞는지 엔진이 알 수 없으므로 첫 줄을 고르지도 합하지도 않고 입력 전체를 거절한다.
// 이 판정은 배열 순서와 중복 줄의 위치에 영향을 받지 않는다. 치료 줄과 기본비용 줄은 각각 따로 검사한다.
//
// 구현 안 됨 — M4 필수 검증 (엔진은 아래 넷을 검사하지 않으며 서버 책임으로 남아 있다):
//  (a) 선택한 treatmentId 에 줄이 없는 경우, (b) 선택하지 않은 treatmentId 의 줄이 들어온 경우,
//  (c) 같은 treatmentId 가 치료 줄과 기본비용 줄 양쪽에 있는 경우, (d) isBaseFee 표시가 줄이 들어 있는 배열과 어긋나는 경우.

export interface ValidatedInput {
  generation: Generation;
  /** 중복을 제거하고 유니코드 코드 포인트 순으로 정렬한 치료 ID. 1개 이상. */
  treatmentIds: string[];
  /** 내용이 같은 중복 줄을 한 번으로 줄이고 treatmentId 의 코드 포인트 순으로 정렬한 치료 줄. 내용이 다른 중복이 있으면 이 값은 만들어지지 않는다. */
  lines: PublishedLine[];
  /** 내용이 같은 중복 줄을 한 번으로 줄이고 treatmentId 의 코드 포인트 순으로 정렬한 공통 기본비용 줄. */
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

/** treatmentId(문자열)를 가진 객체인지. 아니면 형식이 깨진 줄이며 중복 비교에서 빼고 금액 검사가 거절한다. */
function isLineRecord(entry: unknown): entry is PublishedLine {
  return typeof entry === 'object' && entry !== null && typeof (entry as { treatmentId?: unknown }).treatmentId === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const LINE_FIELDS = [
  'treatmentId',
  'treatmentVersionId',
  'displayName',
  'benefitType',
  'calcClass',
  'patientAmount',
  'coverageFingerprint',
  'isBaseFee',
  'origin',
] as const;
const DOCUMENT_FLAG_FIELDS = ['imaging', 'biopsy', 'opinionRequired'] as const;

/** documentFlags 비교: 둘 다 객체이면 세 표시를 하나씩, 아니면 값 자체를 비교한다(없는 값을 만들어 채우지 않는다). */
function sameDocumentFlags(x: unknown, y: unknown): boolean {
  if (isRecord(x) && isRecord(y)) {
    return DOCUMENT_FLAG_FIELDS.every((field) => Object.is(x[field], y[field]));
  }
  return Object.is(x, y);
}

/**
 * 두 줄의 내용이 완전히 같은지. 키 삽입 순서와 객체 정체성은 보지 않는다.
 * 값은 Object.is 로 비교한다: NaN 은 NaN 과 같고 −0 은 0 과 다르다(−0 은 금액으로 무효이므로 같은 줄로 합치지 않는다).
 * 던지지 않고 입력을 바꾸지 않는다. PublishedLine 에 없는 추가 속성은 비교하지 않는다(형식 계약).
 */
function sameLine(x: PublishedLine, y: PublishedLine): boolean {
  return LINE_FIELDS.every((field) => Object.is(x[field], y[field])) && sameDocumentFlags(x.documentFlags, y.documentFlags);
}

/**
 * 같은 treatmentId 인데 내용이 다른 줄이 있는지. 같음은 동치 관계이므로 "첫 줄과 모두 같다"는 "모든 쌍이 같다"와 같고,
 * 따라서 결과는 입력 순서와 중복 줄의 위치에 영향을 받지 않는다. 형식이 깨진 항목(null, 비객체, treatmentId 없음)은 건너뛴다.
 */
function hasConflictingDuplicate(lines: readonly unknown[]): boolean {
  const firstSeen = new Map<string, PublishedLine>();
  for (const entry of lines) {
    if (!isLineRecord(entry)) continue;
    const first = firstSeen.get(entry.treatmentId);
    if (first === undefined) {
      firstSeen.set(entry.treatmentId, entry);
    } else if (!sameLine(first, entry)) {
      return true;
    }
  }
  return false;
}

/**
 * 같은 treatmentId 의 줄을 한 번으로 줄여 코드 포인트 순으로 돌려준다.
 * 호출 전에 hasConflictingDuplicate 가 거짓이어야 한다: 이때 같은 ID 의 줄은 내용이 모두 같으므로 어느 줄을 남겨도 같다.
 */
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
// @MX:REASON: 거절 판정 순서(세대 → 치료 0개 → 충돌하는 중복 줄 → 수치)와 줄 금액·T 검사가 어긋나면 잘못된 병원 결제액이 숫자처럼 나간다(DD-24).
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
  // 치료 ID 가 없거나, 치료 줄(공통 기본비용 줄이 아닌 줄)이 하나도 없으면 계산할 치료가 없는 것이다.
  // 치료 줄 없이 통과시키면 병원 결제액과 보험금이 0원인 결과가 나오므로 0원 결과를 만들지 않고 거절한다.
  if (treatmentIds.length === 0 || input.lines.length === 0) {
    return { ok: false, rejection: { code: 'NO_TREATMENT_SELECTED' } };
  }

  // 충돌하는 중복 줄은 금액 검사와 합산보다 먼저 거절한다. 치료 줄 사유가 기본비용 줄 사유보다 앞선다.
  if (hasConflictingDuplicate(input.lines)) {
    return { ok: false, rejection: { code: 'INPUT_INTEGRITY_VIOLATION', reason: 'CONFLICTING_DUPLICATE_TREATMENT_LINE' } };
  }
  if (hasConflictingDuplicate(input.baseFeeLines)) {
    return { ok: false, rejection: { code: 'INPUT_INTEGRITY_VIOLATION', reason: 'CONFLICTING_DUPLICATE_BASE_FEE_LINE' } };
  }

  // 잘못된 줄을 보류로 돌리거나 합계에서 빼지 않는다. 하나라도 무효이면 계산 없이 거절한다.
  // 중복 제거로 버려질 줄도 포함해 원본 배열 전체를 먼저 검사한다(무효 금액을 조용히 버리지 않기 위해서다).
  // 형식이 깨진 줄(null, 비객체, treatmentId 없음)은 던지거나 고쳐 쓰지 않고 같은 거절(금액 무효)로 처리한다.
  if (![...input.lines, ...input.baseFeeLines].every((line) => isLineRecord(line) && isWon(line.patientAmount))) {
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
