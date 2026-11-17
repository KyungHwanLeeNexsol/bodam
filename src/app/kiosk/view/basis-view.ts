import type { EstimateResponseDto } from '../state/api-types';
import type { KioskState } from '../state/session-store';
import { COPY } from './copy';
import { AMOUNT_UNKNOWN_LABEL, formatWon } from './format';
import { isRecord, isWon, list } from './response-read';
import { causeWord, describeSelection } from './selection-view';
import { exclusionNotesOf, exclusionsOf, nameLookup } from './result-view';
import type { ExclusionView } from './result-view';

// 계산 근거 화면의 읽기 전용 값 (SPEC-REIMBURSEMENT-001 M6 S3b, design.md DD-22·DD-11, AC-014f, AC-013f, AC-010e).
// 순수 함수다. 값은 모두 응답(result.lines·result.basis·result.assumptions·result.excludedItems)에서 읽고 화면에는 보험 계산이 없다: 합계·지급액은 응답의 값이다.
//  - 입력으로 확인한 것: 고른 세대·보험사 형태·치료 원인·치료와 병원 게시 가격(응답 줄), 응답의 병원 결제액 합계.
//  - 가정으로 적용한 것: 공제·한도에 "(가정)" 을 붙인다. 약관 출처는 문서·개정일·조항 또는 쪽만 보이고 확인자·확인일·효력일·규칙 id 는 환자 화면에 없다.
//  - 계산 과정: 그룹별 보장 대상 치료비, 명목 공제와 실제 적용 공제, 한도, 지급액, 공유 한도 적용 결과.
//  - 응답에 없는 값(단계 기록·출처)은 지어내지 않고 그 칸을 그리지 않는다. 값이 없는 금액(null)은 0원이 아니라 "확인 필요"다.
// 보류 결과에는 근거가 없다(계산하지 않았다): null.

export type BasisVariant = 'NORMAL' | 'NOT_COVERED';

export interface BasisConditionRow {
  readonly label: string;
  readonly value: string;
}

export interface BasisTreatmentRow {
  readonly name: string;
  readonly benefitLabel: string;
  readonly amount: string;
  readonly coverage: string;
  /** 확인된 제외 항목인가 (표에서 "보장 제외"를 굵게 구분한다). */
  readonly excluded: boolean;
}

export interface BasisStepRow {
  readonly label: string;
  readonly value: string;
}

export interface BasisGroupView {
  /** 그룹이 둘 이상일 때만 "계산 묶음 N" (내부 그룹 이름은 환자 화면에 없다). */
  readonly title: string | null;
  readonly rows: readonly BasisStepRow[];
}

export interface BasisSourceView {
  readonly document: string;
  /** "2026.01.01 개정" 또는 날짜 형식이 아니면 응답의 글자 그대로. */
  readonly revision: string | null;
  readonly clause: string | null;
}

export interface BasisView {
  readonly variant: BasisVariant;
  readonly testData: boolean;
  readonly conditionRows: readonly BasisConditionRow[];
  /** 가로형의 한 줄: "2세대(C1) · 손해보험사 · 상해 · 치료 4개". */
  readonly compactCondition: string;
  readonly treatments: readonly BasisTreatmentRow[];
  readonly hospitalTotal: string;
  readonly groups: readonly BasisGroupView[];
  readonly payoutTotal: string;
  readonly exclusions: readonly ExclusionView[];
  readonly assumptions: readonly string[];
  readonly uncheckedPremise: string;
  readonly sources: readonly BasisSourceView[];
}

const won = (value: unknown): string => (isWon(value) ? formatWon(value) : AMOUNT_UNKNOWN_LABEL);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** "2026-01-01" → "2026.01.01 개정". 날짜 형식이 아니면 응답의 글자 그대로(다시 쓰지 않는다). */
function revisionText(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return date === null ? raw : COPY.basis.sourceRevision(`${date[1]}.${date[2]}.${date[3]}`);
}

function sourcesOf(response: EstimateResponseDto): BasisSourceView[] {
  const profile: unknown = response.result.basis?.profile;
  if (!isRecord(profile)) return [];
  return list(profile.policySources as readonly unknown[] | undefined).flatMap((source) => {
    if (!isRecord(source)) return [];
    const document = text(source.insurerDocumentId);
    return document === null ? [] : [{ document, revision: revisionText(source.revisionDate), clause: text(source.clauseOrPage) }];
  });
}

/** 공제·한도 줄 하나(그룹 하나)의 칸. 응답의 값만 쓰고 계산하지 않는다. 명목 공제와 실제 적용 공제가 같으면 한 줄이다. */
function stepGroup(step: unknown, index: number, many: boolean): BasisGroupView | null {
  if (!isRecord(step)) return null;
  const rows: BasisStepRow[] = [{ label: COPY.basis.coveredTotal, value: won(step.E) }];
  if (step.D === step.D_applied) rows.push({ label: COPY.basis.deduction, value: isWon(step.D_applied) ? `- ${formatWon(step.D_applied)}` : AMOUNT_UNKNOWN_LABEL });
  else rows.push({ label: COPY.basis.deduction, value: won(step.D) }, { label: COPY.basis.deductionApplied, value: isWon(step.D_applied) ? `- ${formatWon(step.D_applied)}` : AMOUNT_UNKNOWN_LABEL });
  rows.push({ label: COPY.basis.limit, value: step.L === 'UNLIMITED' ? COPY.basis.unlimited : won(step.L) });
  // 그룹이 하나이고 공유 한도가 없으면 그룹의 지급액이 곧 예상 보험금이라 표 맨 아래 한 줄로 충분하다. 그룹이 여럿이거나 공유 한도가 적용되면 그룹별 지급액을 보인다.
  const pooled = step.poolKey !== undefined || (step.P !== step.P_pooled && step.P_pooled !== undefined);
  if (many || pooled) rows.push({ label: COPY.basis.groupPayout, value: won(step.P) });
  if (pooled) rows.push({ label: COPY.basis.pooledPayout, value: won(step.P_pooled) });
  return { title: many ? COPY.basis.groupTitle(index + 1) : null, rows };
}

const COVERAGE_OF_LINE: Readonly<Record<string, string>> = { ESTIMATED: COPY.basis.covered, EXCLUDED_CONFIRMED: COPY.basis.excluded };

/**
 * 계산 근거 화면의 값. 저장된 응답이 없거나 보류 결과(계산하지 않아 근거가 없다)이면 null 이다
 * (화면은 이때 0원이나 빈 표를 그리지 않고 안내 화면으로 간다).
 */
export function buildBasisView(state: KioskState): BasisView | null {
  const response = state.derived.estimate?.response;
  if (response === undefined) return null;
  const { result } = response;
  const variant: BasisVariant | null = result.state === 'ESTIMATED' ? 'NORMAL' : result.state === 'ESTIMATED_WITH_EXCLUSIONS' ? 'NOT_COVERED' : null;
  if (variant === null) return null;

  const selection = describeSelection(state, response);
  const cause = causeWord(state.inputs.cause);
  const conditionRows = [
    ...(selection.insuranceLabel === null ? [] : [{ label: COPY.result.conditionInsurance, value: selection.insuranceLabel }]),
    ...(cause === null ? [] : [{ label: COPY.basis.conditionCause, value: cause }]),
  ];
  const compactCondition = [...(selection.insuranceLabel === null ? [] : [selection.insuranceLabel]), ...(cause === null ? [] : [cause]), `치료 ${selection.treatmentNames.length}개`].join(' · ');

  const treatments = list(result.lines).flatMap((entry): BasisTreatmentRow[] => {
    if (!isRecord(entry) || typeof entry.displayName !== 'string') return [];
    return [
      {
        name: entry.displayName,
        benefitLabel: entry.benefitType === 'BENEFIT' ? COPY.basis.benefit : COPY.basis.nonBenefit,
        amount: won(entry.patientAmount),
        coverage: typeof entry.state === 'string' ? (COVERAGE_OF_LINE[entry.state] ?? COPY.basis.unconfirmed) : COPY.basis.unconfirmed,
        excluded: entry.state === 'EXCLUDED_CONFIRMED',
      },
    ];
  });

  const steps = list(response.result.basis?.steps as readonly unknown[] | undefined);
  const groups = steps.flatMap((step, index) => stepGroup(step, index, steps.length > 1) ?? []);

  const assumptionCodes = list(result.assumptions);
  const assumptions = [
    ...(assumptionCodes.includes('STANDARD_PROFILE_APPLIED') ? [COPY.basis.standardProfile(selection.insuranceLabel)] : []),
    ...(assumptionCodes.includes('ALL_COVERED_AND_LIMIT_REMAINS') ? [COPY.basis.allCovered] : []),
    ...(variant === 'NOT_COVERED' ? exclusionNotesOf(response) : []),
  ];

  return {
    variant,
    testData: response.origin !== 'OPERATING',
    conditionRows,
    compactCondition,
    treatments,
    hospitalTotal: won(result.amounts.hospitalPayment),
    groups,
    payoutTotal: won(result.amounts.expectedInsurancePayout),
    exclusions: variant === 'NOT_COVERED' ? exclusionsOf(response, nameLookup(state, response)) : [],
    assumptions,
    uncheckedPremise: COPY.basis.uncheckedPremise,
    sources: sourcesOf(response),
  };
}
