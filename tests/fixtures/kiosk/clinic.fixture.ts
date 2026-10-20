import type { CatalogDto, CatalogTreatmentDto, OptionsDto } from '../../../src/app/kiosk/state/api-types';

// 시험 자료(TEST_FIXTURE). 키오스크 상태 기계 시험이 쓰는 병원 자료(catalog·options 응답 모양, design.md DD-19)다.
// 운영 코드(src/)는 이 파일을 가져오지 않는다(tests/boundary/production-no-fixtures.test.ts).
// 치료 네 개의 합계는 예시 4종과 같다: 급여 14,000 · 비급여 110,000 · 합계 124,000 (AC-012f). 다섯째·여섯째 치료는 목록 페이지 나눔 시험용이다.

export const T_XRAY = 'TEST_FIXTURE_TREATMENT_1';
export const T_ULTRASOUND = 'TEST_FIXTURE_TREATMENT_2';
export const T_KIDNEY_SPRAY = 'TEST_FIXTURE_TREATMENT_3';
export const T_PHYSIO = 'TEST_FIXTURE_TREATMENT_4';
export const T_FIFTH = 'TEST_FIXTURE_TREATMENT_5';
export const T_SIXTH = 'TEST_FIXTURE_TREATMENT_6';

function treatment(treatmentId: string, displayName: string, benefitType: 'BENEFIT' | 'NON_BENEFIT', patientAmount: number, order: number): CatalogTreatmentDto {
  return { treatmentId, displayName, description: `TEST_FIXTURE 설명 ${displayName}`, benefitType, patientAmount, priceCondition: 'TEST_FIXTURE_PATIENT · TEST_FIXTURE_ASSUMPTION · 기준일 2026-10-16', order };
}

export const FOUR_TREATMENTS: readonly CatalogTreatmentDto[] = [
  treatment(T_XRAY, 'TEST_FIXTURE X-ray', 'BENEFIT', 10_000, 1),
  treatment(T_ULTRASOUND, 'TEST_FIXTURE 초음파', 'BENEFIT', 4_000, 2),
  treatment(T_KIDNEY_SPRAY, 'TEST_FIXTURE 신장분사치료', 'NON_BENEFIT', 40_000, 3),
  treatment(T_PHYSIO, 'TEST_FIXTURE 물리치료', 'NON_BENEFIT', 70_000, 4),
];

export const SIX_TREATMENTS: readonly CatalogTreatmentDto[] = [
  ...FOUR_TREATMENTS,
  treatment(T_FIFTH, 'TEST_FIXTURE 주사', 'NON_BENEFIT', 5_000, 5),
  treatment(T_SIXTH, 'TEST_FIXTURE 붕대', 'BENEFIT', 3_000, 6),
];

/** 서버 기본값(DD-10 표)과 같은 값을 담은 idlePolicy. 시험이 일부 화면 종류만 바꿔 쓴다. */
export const DD10_SCREENS = {
  INPUT: { warnSeconds: 100, resetSeconds: 120 },
  RESULT: { warnSeconds: 160, resetSeconds: 180 },
  BASIS_AND_DOCUMENTS: { warnSeconds: 160, resetSeconds: 180 },
  HOLD_RESULT: { warnSeconds: 160, resetSeconds: 180 },
  NOTICE_PROGRESS_ERROR: { warnSeconds: 100, resetSeconds: 120 },
} as const;

export function makeCatalog(overrides: Partial<CatalogDto> = {}): CatalogDto {
  return {
    clinic: { slug: 'test-fixture-clinic-1', displayName: 'TEST_FIXTURE 시험 의원', setting: 'OUTPATIENT_ONLY' },
    serviceDisplayName: '보담',
    catalogVersion: 'TEST_FIXTURE_CATALOG_V1',
    treatments: [...SIX_TREATMENTS],
    baseFees: [],
    baseFeeIncluded: 'NOT_REGISTERED',
    idlePolicy: { screens: { ...DD10_SCREENS }, completionHoldSeconds: null },
    ...overrides,
  };
}

export function makeOptions(overrides: Partial<OptionsDto> = {}): OptionsDto {
  return {
    ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V1',
    ruleBundleStatus: 'ACTIVE',
    generations: [
      { code: 'GEN1_AS', label: '1세대(A·S)', period: '2009.08.01 이전' },
      { code: 'GEN2_C1', label: '2세대(C1)', period: '2009.08.01~2015.09.01 이전' },
      { code: 'GEN2_5_C2', label: '2.5세대(C2)', period: '2015.09.01~2017.04.01 이전' },
      { code: 'GEN3_C3', label: '3세대(C3)', period: '2017.04.01~2021.07.01 이전' },
      { code: 'GEN4_C4', label: '4세대(C4)', period: '2021.07.01부터의 4세대 계약' },
    ],
    insurerTypes: [
      { code: 'NON_LIFE', label: '손해보험사', help: '손해보험사에서 가입한 실손보험' },
      { code: 'LIFE', label: '생명보험사', help: '생명보험사에서 가입한 실손보험' },
      { code: 'MUTUAL_AID', label: '그외 공제 조합', help: '우체국, 새마을금고 공제회, 농협' },
    ],
    causes: [
      { code: 'INJURY', label: '다쳐서 왔어요 (상해)', help: '갑작스러운 사고로 다친 경우' },
      { code: 'ILLNESS', label: '아파서 왔어요 (질병)', help: '몸에 생긴 병으로 치료받는 경우' },
      { code: 'UNKNOWN', label: '잘 모르겠어요', help: '상해일 때와 질병일 때 필요한 서류를 모두 안내' },
    ],
    guidance: { generationUnknown: '보험증권이나 보험사 앱에서 가입일을 확인해 주세요.' },
    ...overrides,
  };
}
