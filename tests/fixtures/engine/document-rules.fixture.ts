import { documentRuleSetContent } from '../../../src/engine/usability';
import type { DeriveDocumentsInput } from '../../../src/engine/documents';
import type { DocumentCode, DocumentFlags, DocumentLineKey, DocumentRule, DocumentRuleSet, DocumentWhen } from '../../../src/engine/types';
import { TEST_FIXTURE_APPROVER, TEST_VALIDITY, testDigest, testPolicySource } from './profiles.fixture';

// 시험 자료(TEST_FIXTURE). 이 파일의 모든 값은 엔진 시험용 가짜 값이다.
// 실제 보험사의 서류 요건·약관 조항·승인 기록이 아니며, 사유 문장은 모두 이 시험을 위해 지어낸 환자용 문장이다.
// 기획서 §4 의 조건부 매핑 예시를 시험 자료로 옮겼을 뿐 확정 규칙이 아니다. 운영 서류 규칙은 아직 없다(보류-06).
// 이 파일은 src 에서 가져올 수 없다(tests/boundary 가 막는다).

/** 이 파일이 만든 모든 사유 문장의 끝에 붙는 표시. 운영 요건으로 오해하지 않게 한다. */
export const TEST_DOCUMENT_RULES_REVIEW_MARK = '(검증 필요 · 시험 자료)';

/** 서류 규칙 하나. 사유에는 "검증 필요" 표시가 붙는다. */
export function rule(documentCode: DocumentCode, when: DocumentWhen, reason: string, priority: number): DocumentRule {
  return { documentCode, when, reason: `${reason} ${TEST_DOCUMENT_RULES_REVIEW_MARK}`, priority };
}

/** 사유를 그대로 쓰는 규칙(표시를 붙이지 않는다). 사유 문자열 자체를 시험할 때만 쓴다. */
export function plainRule(documentCode: DocumentCode, when: DocumentWhen, reason: string, priority: number): DocumentRule {
  return { documentCode, when, reason, priority };
}

/** 내용 해시를 현재 내용에 맞춘다. */
export function withValidDocumentHash(ruleSet: DocumentRuleSet): DocumentRuleSet {
  return { ...ruleSet, contentHash: testDigest(documentRuleSetContent(ruleSet)) };
}

/** 사용 가능한(PUBLISHED, TEST_FIXTURE, 해시 일치) 시험 서류 규칙 묶음. overrides 를 적용한 뒤 해시를 다시 맞춘다. */
export function ruleSetOf(rules: DocumentRule[], overrides: Partial<DocumentRuleSet> = {}): DocumentRuleSet {
  const base: DocumentRuleSet = {
    id: 'TEST_DOCUMENT_RULES_1',
    version: 'v1',
    rules,
    contentHash: '',
    state: 'PUBLISHED',
    origin: 'TEST_FIXTURE',
    validity: { ...TEST_VALIDITY },
    policySources: [testPolicySource('DOC')],
    approver: { ...TEST_FIXTURE_APPROVER },
    ...overrides,
  };
  // contentHash 를 직접 넘긴 시험(불일치 시험)은 그 값을 그대로 쓴다.
  return overrides.contentHash === undefined ? withValidDocumentHash(base) : base;
}

// ───────────────────────── 항상 필요한 줄 ─────────────────────────

/** 영수증·세부내역서에 사유를 주는 규칙(조건 없음). 이 줄은 규칙이 없어도 필요하며 사유만 이 규칙에서 온다. */
function receiptRules(): DocumentRule[] {
  return [
    rule('RECEIPT', {}, '시험 문장: 진료비를 낸 기록이라 영수증이 필요해요', 5),
    rule('ITEMIZED_STATEMENT', {}, '시험 문장: 어떤 진료를 받았는지 보이는 세부내역서가 필요해요', 5),
  ];
}

// ───────────────────────── (i) 기획서 §4 예시 ─────────────────────────

/**
 * 기획서 §4 의 조건부 매핑 예시를 옮긴 규칙: 통원 → 통원확인서 또는 진료확인서 · 입원 → 입퇴원확인서 + 진단서 · 상해 → 초진기록지 ·
 * 질병 → 진단서 · 영상 검사 포함 → 판독지 · 조직 검사 포함 → 조직검사결과지 · 소견 필요 포함 → 소견서.
 * 영수증·세부내역서의 사유 규칙은 이 시험 자료가 더한 것이다. 확정 규칙이 아니다("검증 필요").
 */
export function planningExampleRules(): DocumentRule[] {
  return [
    ...receiptRules(),
    rule('OUTPATIENT_CONFIRMATION', { setting: 'OUTPATIENT' }, '시험 문장: 통원 진료라 통원확인서가 필요해요', 10),
    rule('TREATMENT_CONFIRMATION', { setting: 'OUTPATIENT' }, '시험 문장: 통원 진료라 진료확인서가 필요해요', 10),
    rule('ADMISSION_DISCHARGE_CONFIRMATION', { setting: 'INPATIENT' }, '시험 문장: 입원 진료라 입퇴원확인서가 필요해요', 10),
    rule('DIAGNOSIS_CERT', { setting: 'INPATIENT' }, '시험 문장: 입원 진료라 진단서가 필요해요', 10),
    rule('INITIAL_EXAM_RECORD', { cause: 'INJURY' }, '시험 문장: 다쳐서 오셨다면 초진기록지가 필요해요', 10),
    rule('DIAGNOSIS_CERT', { cause: 'ILLNESS' }, '시험 문장: 아파서 오셨다면 진단서가 필요해요', 10),
    rule('IMAGING_READING', { imaging: true }, '시험 문장: 영상 검사를 받았다면 판독지가 필요해요', 10),
    rule('BIOPSY_RESULT', { biopsy: true }, '시험 문장: 조직 검사를 받았다면 조직검사결과지가 필요해요', 10),
    rule('MEDICAL_OPINION', { opinionRequired: true }, '시험 문장: 소견이 필요한 항목이라면 소견서가 필요해요', 10),
  ];
}

export function planningExampleRuleSet(overrides: Partial<DocumentRuleSet> = {}): DocumentRuleSet {
  return ruleSetOf(planningExampleRules(), { id: 'TEST_DOCUMENT_RULES_PLANNING_EXAMPLE', ...overrides });
}

/**
 * 이 예시 묶음에서 원인 UNKNOWN, 서류 표시 없음, 통원 진료일 때 나와야 하는 결과(7 + 1 + 1).
 * 이 예시 묶음 하나의 결과일 뿐이며 일반 규칙도 상한도 아니다(AC-007c, AC-007h). deriveDocuments 와의 일치는 documents.test.ts 가 확인한다.
 */
export const PLANNING_EXAMPLE_UNKNOWN_CAUSE_OUTCOME: ScopeOutcome = {
  common: [
    'OUTPATIENT_CONFIRMATION',
    'TREATMENT_CONFIRMATION',
    'RECEIPT_AND_ITEMIZED',
    'ADMISSION_DISCHARGE_CONFIRMATION',
    'MEDICAL_OPINION',
    'IMAGING_READING',
    'BIOPSY_RESULT',
  ],
  injuryOnly: ['INITIAL_EXAM_RECORD'],
  illnessOnly: ['DIAGNOSIS_CERT'],
  required: ['DIAGNOSIS_CERT', 'OUTPATIENT_CONFIRMATION', 'TREATMENT_CONFIRMATION', 'RECEIPT_AND_ITEMIZED', 'INITIAL_EXAM_RECORD'],
};

export interface ScopeOutcome {
  /** 범위별 줄 키, 고정 9줄 순서. 필요 없는 줄도 COMMON 에 든다. */
  common: DocumentLineKey[];
  injuryOnly: DocumentLineKey[];
  illnessOnly: DocumentLineKey[];
  /** 필요(required: true)인 줄 전부, 고정 9줄 순서. */
  required: DocumentLineKey[];
}

// ───────────────────────── (iii) 전용 줄 수 변형 (AC-007h) ─────────────────────────
// 모두 원인 UNKNOWN, 서류 표시 없음, 통원 진료 입력을 기준으로 한 기대 결과다.

/** 영수증·세부내역서·통원확인서만 모든 원인에 필요한 공통 규칙. */
function commonOnlyRules(): DocumentRule[] {
  return [...receiptRules(), rule('OUTPATIENT_CONFIRMATION', { setting: 'OUTPATIENT' }, '시험 문장: 통원 진료라 통원확인서가 필요해요', 10)];
}

/** 상해 전용 2줄(초진기록지, 소견서) + 질병 전용 3줄(진단서, 판독지, 조직검사결과지). */
export function ruleSetTwoInjuryThreeIllness(): DocumentRuleSet {
  return ruleSetOf(
    [
      ...commonOnlyRules(),
      rule('INITIAL_EXAM_RECORD', { cause: 'INJURY' }, '시험 문장: 다쳐서 오셨다면 초진기록지가 필요해요', 10),
      rule('MEDICAL_OPINION', { cause: 'INJURY' }, '시험 문장: 다쳐서 오셨다면 소견서가 필요해요', 10),
      rule('DIAGNOSIS_CERT', { cause: 'ILLNESS' }, '시험 문장: 아파서 오셨다면 진단서가 필요해요', 10),
      rule('IMAGING_READING', { cause: 'ILLNESS' }, '시험 문장: 아파서 오셨다면 판독지가 필요해요', 10),
      rule('BIOPSY_RESULT', { cause: 'ILLNESS' }, '시험 문장: 아파서 오셨다면 조직검사결과지가 필요해요', 10),
    ],
    { id: 'TEST_DOCUMENT_RULES_TWO_THREE' },
  );
}

export const TWO_INJURY_THREE_ILLNESS_OUTCOME: ScopeOutcome = {
  common: ['OUTPATIENT_CONFIRMATION', 'TREATMENT_CONFIRMATION', 'RECEIPT_AND_ITEMIZED', 'ADMISSION_DISCHARGE_CONFIRMATION'],
  injuryOnly: ['INITIAL_EXAM_RECORD', 'MEDICAL_OPINION'],
  illnessOnly: ['DIAGNOSIS_CERT', 'IMAGING_READING', 'BIOPSY_RESULT'],
  required: ['DIAGNOSIS_CERT', 'OUTPATIENT_CONFIRMATION', 'RECEIPT_AND_ITEMIZED', 'INITIAL_EXAM_RECORD', 'MEDICAL_OPINION', 'IMAGING_READING', 'BIOPSY_RESULT'],
};

/** 상해 전용 0줄 + 질병 전용 4줄(진단서, 소견서, 판독지, 조직검사결과지). */
export function ruleSetZeroInjuryFourIllness(): DocumentRuleSet {
  return ruleSetOf(
    [
      ...commonOnlyRules(),
      rule('DIAGNOSIS_CERT', { cause: 'ILLNESS' }, '시험 문장: 아파서 오셨다면 진단서가 필요해요', 10),
      rule('MEDICAL_OPINION', { cause: 'ILLNESS' }, '시험 문장: 아파서 오셨다면 소견서가 필요해요', 10),
      rule('IMAGING_READING', { cause: 'ILLNESS' }, '시험 문장: 아파서 오셨다면 판독지가 필요해요', 10),
      rule('BIOPSY_RESULT', { cause: 'ILLNESS' }, '시험 문장: 아파서 오셨다면 조직검사결과지가 필요해요', 10),
    ],
    { id: 'TEST_DOCUMENT_RULES_ZERO_FOUR' },
  );
}

export const ZERO_INJURY_FOUR_ILLNESS_OUTCOME: ScopeOutcome = {
  common: ['OUTPATIENT_CONFIRMATION', 'TREATMENT_CONFIRMATION', 'RECEIPT_AND_ITEMIZED', 'INITIAL_EXAM_RECORD', 'ADMISSION_DISCHARGE_CONFIRMATION'],
  injuryOnly: [],
  illnessOnly: ['DIAGNOSIS_CERT', 'MEDICAL_OPINION', 'IMAGING_READING', 'BIOPSY_RESULT'],
  required: ['DIAGNOSIS_CERT', 'OUTPATIENT_CONFIRMATION', 'RECEIPT_AND_ITEMIZED', 'MEDICAL_OPINION', 'IMAGING_READING', 'BIOPSY_RESULT'],
};

/** 상해 전용 0줄 + 질병 전용 0줄: 원인에 따라 달라지는 규칙이 없다. */
export function ruleSetNoCauseLines(): DocumentRuleSet {
  return ruleSetOf(commonOnlyRules(), { id: 'TEST_DOCUMENT_RULES_ZERO_ZERO' });
}

export const NO_CAUSE_LINES_OUTCOME: ScopeOutcome = {
  common: [
    'DIAGNOSIS_CERT',
    'OUTPATIENT_CONFIRMATION',
    'TREATMENT_CONFIRMATION',
    'RECEIPT_AND_ITEMIZED',
    'INITIAL_EXAM_RECORD',
    'ADMISSION_DISCHARGE_CONFIRMATION',
    'MEDICAL_OPINION',
    'IMAGING_READING',
    'BIOPSY_RESULT',
  ],
  injuryOnly: [],
  illnessOnly: [],
  required: ['OUTPATIENT_CONFIRMATION', 'RECEIPT_AND_ITEMIZED'],
};

// ───────────────────────── 산출 입력 빌더 ─────────────────────────

/** 서류 표시가 모두 없는 치료. */
export function plainTreatment(): { documentFlags: DocumentFlags } {
  return { documentFlags: { imaging: false, biopsy: false, opinionRequired: false } };
}

/** 지정한 표시만 가진 치료. */
export function treatmentWith(flags: Partial<DocumentFlags>): { documentFlags: DocumentFlags } {
  return { documentFlags: { imaging: false, biopsy: false, opinionRequired: false, ...flags } };
}

/** deriveDocuments 입력. 기본값: 결과 ESTIMATED, 원인 UNKNOWN, 손해보험사, 치료 하나(표시 없음), 통원 전용, 기획서 §4 예시 묶음. */
export function documentInput(overrides: Partial<DeriveDocumentsInput> = {}): DeriveDocumentsInput {
  return {
    overallState: 'ESTIMATED',
    cause: 'UNKNOWN',
    insurerType: 'NON_LIFE',
    treatments: [plainTreatment()],
    clinicSetting: 'OUTPATIENT_ONLY',
    ruleSet: planningExampleRuleSet(),
    ...overrides,
  };
}
