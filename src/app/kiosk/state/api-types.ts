import type { DocumentsResult, EstimateResult as EngineEstimateResult, Origin } from '../../../engine/types';

// 키오스크가 읽는 공개 API 응답의 클라이언트 쪽 형식 (SPEC-REIMBURSEMENT-001 design.md DD-19).
// 서버 코드(src/server)를 가져오지 않는다: 키오스크는 화면 쪽 코드이고 서버 모듈에 닿는 길이 없어야 한다.
// 계산 응답의 결과·서류 형식만은 서버와 키오스크가 같은 엔진 모듈(src/engine)을 쓰므로 그 형식(타입)을 그대로 가져온다(형식만이고 런타임 코드는 없다).
// 두 쪽이 같은 모양임은 시험이 실제 Route Handler 응답을 이 형식으로 읽어 보며 확인한다(tests/kiosk/state/idle-policy-integration.test.ts).
// 형식만 담는다. 판정·계산 함수는 두지 않는다.

export type GenerationCode = 'GEN1_AS' | 'GEN2_C1' | 'GEN2_5_C2' | 'GEN3_C3' | 'GEN4_C4';
export type InsurerTypeCode = 'NON_LIFE' | 'LIFE' | 'MUTUAL_AID';
export type CauseCode = 'INJURY' | 'ILLNESS' | 'UNKNOWN';
export type BenefitTypeCode = 'BENEFIT' | 'NON_BENEFIT';

/** 무조작 정책의 화면 종류 다섯 개 (DD-10 표, DD-19 `idlePolicy.screens` 의 키). */
export type IdleScreenKind = 'INPUT' | 'RESULT' | 'BASIS_AND_DOCUMENTS' | 'HOLD_RESULT' | 'NOTICE_PROGRESS_ERROR';

export interface IdleThresholdDto {
  readonly warnSeconds: number;
  readonly resetSeconds: number;
}

/**
 * catalog 응답의 `idlePolicy`. 응답이 화면 종류를 빠뜨리거나 정책 자체가 없어도 키오스크는 DD-10 표의 값으로 동작하므로
 * 모든 칸을 선택으로 둔다(서버는 항상 다섯 종류를 채워 보내지만 클라이언트는 그에 기대지 않는다).
 */
export interface IdlePolicyDto {
  readonly screens?: Partial<Record<IdleScreenKind, IdleThresholdDto>>;
  readonly completionHoldSeconds?: number | null;
}

export interface CatalogTreatmentDto {
  readonly treatmentId: string;
  readonly displayName: string;
  readonly description: string;
  readonly benefitType: BenefitTypeCode;
  readonly patientAmount: number;
  readonly priceCondition: string;
  readonly order: number;
}

export interface CatalogBaseFeeDto {
  readonly baseFeeId: string;
  readonly displayName: string;
  readonly benefitType: BenefitTypeCode;
  readonly amount: number;
}

/** `GET /api/clinics/{slug}/catalog` 응답. */
export interface CatalogDto {
  readonly clinic: { readonly slug: string; readonly displayName: string; readonly setting: 'OUTPATIENT_ONLY' };
  readonly serviceDisplayName: string;
  /** 병원의 현재 카탈로그 버전. 게시한 적이 없으면 null. */
  readonly catalogVersion: string | null;
  readonly treatments: readonly CatalogTreatmentDto[];
  readonly baseFees: readonly CatalogBaseFeeDto[];
  readonly baseFeeIncluded: 'INCLUDED' | 'NOT_REGISTERED';
  readonly idlePolicy?: IdlePolicyDto;
}

export interface GenerationCardDto {
  readonly code: GenerationCode;
  readonly label: string;
  readonly period: string;
}

export interface InsurerTypeCardDto {
  readonly code: InsurerTypeCode;
  readonly label: string;
  readonly help: string;
}

export interface CauseCardDto {
  readonly code: CauseCode;
  readonly label: string;
  readonly help: string;
}

/** `GET /api/clinics/{slug}/insurance/options` 응답. */
export interface OptionsDto {
  /** 규칙 사용 범위가 가리키는 묶음 id. 범위가 없으면 null. */
  readonly ruleBundleVersion: string | null;
  readonly ruleBundleStatus: 'ACTIVE' | 'SUSPENDED' | null;
  readonly generations: readonly GenerationCardDto[];
  readonly insurerTypes: readonly InsurerTypeCardDto[];
  readonly causes: readonly CauseCardDto[];
  readonly guidance: { readonly generationUnknown: string };
}

// ───────────────────────── 파생 데이터의 형식 (최소형) ─────────────────────────
// 상태 기계는 결과가 저장돼 있는가, 어느 종류의 결과인가(`state`)만 읽는다. 화면(M6)이 읽을 응답 전체는 `response` 에 그대로 둔다.

export type EstimateResultState = 'ESTIMATED' | 'ESTIMATED_WITH_EXCLUSIONS' | 'ON_HOLD';

/** `POST /api/clinics/{slug}/estimate` 200 응답 본문 (DD-19 성공 응답, 보류 포함). 요청에 쓴 버전, 출처 요약, 엔진 결과, 서류(보류이면 null). */
export interface EstimateResponseDto {
  readonly versions: {
    readonly catalogVersion: string;
    readonly ruleBundleVersion: string | null;
    readonly ruleBundleStatus: 'ACTIVE' | 'SUSPENDED' | null;
    readonly profile: { readonly id: string; readonly version: string; readonly origin: Origin } | null;
  };
  readonly origin: Origin;
  readonly result: EngineEstimateResult;
  readonly documents: DocumentsResult | null;
}

/** 저장된 계산 결과. 상태 기계는 결과 종류(`state`)만 읽고, `response` 는 요청 생명주기가 200 응답을 저장할 때 채운다. */
export interface EstimateResult {
  readonly state: EstimateResultState;
  readonly response?: EstimateResponseDto;
}

/** 서류 화면용 값(계산 응답의 `documents`). 형식은 M5.B·M6 이 정한다. */
export type DocumentsView = Readonly<Record<string, unknown>>;

/** 계산 근거 화면용 값. (결과, 결과 종류)의 순수 함수로 만든다(DD-11). 형식은 M6 이 정한다. */
export type BasisView = Readonly<Record<string, unknown>>;
