// 관리자 화면이 읽는 관리자 API 응답의 모양 (src/server/admin/router.ts 와 admin/catalog-preview.ts 의 응답). 화면 코드는 서버 모듈을 가져오지 않고 이 형식만 쓴다.

export type BenefitType = 'BENEFIT' | 'NON_BENEFIT';

export interface TreatmentRow {
  treatmentId: string;
  displayName: string;
  description: string;
  benefitType: BenefitType;
  treatmentCode: string;
  procedureCodes: string[];
  patientAmount: number;
  priceCondition: string;
  order: number;
}

/** 새 치료 한 건(초안에 적은 표시 필드). 보장 분류·출처·치료 id 는 서버가 게시 때 정하므로 이 모양에 없다. 요청 본문(PUT additions[i])과 같은 모양이다. */
export interface TreatmentAdditionView {
  draftKey: string;
  displayName: string;
  description: string;
  benefitType: BenefitType;
  patientAmount: number;
  treatmentCode: string;
  procedureCodes: string[];
  documentFlags: { imaging: boolean; biopsy: boolean; opinionRequired: boolean };
  amountCondition: { patientType: string; assumption: string; referenceDate: string };
  effectiveDate: string;
}

/** 현재 게시된 공통 기본비용 한 줄(읽기 전용 표시 + 금액만 고칠 수 있다). baseFeeId 는 안정 식별자다. */
export interface BaseFeeRow {
  baseFeeId: string;
  displayName: string;
  benefitType: string;
  amount: number;
}

export interface DraftView {
  baseCatalogVersionId: string;
  priceEdits: Array<{ treatmentId: string; patientAmount: number }>;
  /** 공통 기본비용의 새 금액들. 기본비용을 건드리지 않은 초안은 빈 배열이다. */
  baseFeeEdits: Array<{ baseFeeId: string; amount: number }>;
  additions: TreatmentAdditionView[];
  deactivations: string[];
  /** null 이면 기본 순서(남는 기존 치료는 지금 순서 그대로, 새 치료는 뒤에). */
  order: string[] | null;
  updatedAt: string;
  updatedBy: string;
  draftDigest: string;
  stale: boolean;
}

export interface TreatmentsResponse {
  clinic: { id: string; slug: string; displayName: string };
  catalogVersion: string | null;
  treatments: TreatmentRow[];
  baseFees: BaseFeeRow[];
  draft: DraftView | null;
}

export interface SessionResponse {
  userId: string;
  memberships: Array<{ clinicId: string | null; role: 'HA' | 'RV' | 'PO' }>;
}

export interface CatalogVersionRow {
  id: string;
  publishedBy: string;
  publishedAt: string;
  /** 숨김·순서 변경은 구조 편집을 지원하는 서버에서만 온다. 없으면 0건으로 읽는다. */
  changeSummary: {
    addedTreatmentIds: string[];
    removedTreatmentIds: string[];
    priceChangedTreatmentIds: string[];
    baseFeesChanged: boolean;
    deactivatedTreatmentIds?: string[];
    reorderedTreatmentIds?: string[];
  };
  current: boolean;
}

export interface EstimateSide {
  result: {
    state: string;
    amounts: { hospitalPayment: number; expectedInsurancePayout: number | null; expectedOutOfPocketAfterPayout: number | null };
  };
}

export interface PreviewPriceChange {
  treatmentId: string;
  displayName: string;
  before: number;
  after: number;
}

/** 미리보기 목록 한 줄. 새 치료는 아직 치료 id 가 없어 treatmentId 가 null 이다. position 은 1부터. */
export interface PreviewListRow {
  key: string;
  treatmentId: string | null;
  displayName: string;
  patientAmount: number;
  position: number;
  isNew: boolean;
}

/** 새 치료를 같은 엔진으로 계산해 본 결과. 엔진이 말한 상태와 보류 사유뿐이고 보험금 같은 금액은 없다. */
export interface AddedCalculation {
  state: string;
  lineState: string;
  holdReasons: string[];
}

/** 공통 기본비용 한 건의 금액 변경(미리보기 변경 목록). */
export interface PreviewBaseFeeChange {
  baseFeeId: string;
  displayName: string;
  before: number;
  after: number;
}

export interface PreviewResponse {
  basedOnCatalogVersion: string;
  request: { generation: string; insurerType: string; cause: string; treatmentIds: string[] };
  priceChanges: PreviewPriceChange[];
  /** 가격을 바꾼 치료가 없고 계산할 치료도 고르지 않았으면 null(금액 비교를 만들지 않았다). */
  before: EstimateSide | null;
  after: EstimateSide | null;
  beforeList: PreviewListRow[];
  afterList: PreviewListRow[];
  changes: {
    priceChanges: PreviewPriceChange[];
    /** 금액이 바뀌는 공통 기본비용. 기본비용을 건드리지 않은 초안은 빈 목록이다. */
    baseFeeChanges: PreviewBaseFeeChange[];
    added: Array<{ draftKey: string; displayName: string; patientAmount: number; benefitType: string; calculation: AddedCalculation }>;
    deactivated: Array<{ treatmentId: string; displayName: string }>;
    /** before·after 는 beforeList·afterList 에서의 1부터 시작하는 위치. */
    reordered: Array<{ treatmentId: string; displayName: string; before: number; after: number }>;
  };
  /** 초안 내용 전체(가격·새 치료·숨김·순서)의 지문: 화면이 저장된 초안과 같은지 비교하는 상태 표지. 게시 권한이 아니다. */
  draftDigest: string;
  /** 서버가 이 관리자에게 이 초안의 미리보기를 만들어 줬다는 것을 게시 때 확인하는 값. 게시 요청 본문 { publishConfirmation } 에 그대로 보낸다. */
  publishConfirmation: string;
}

export interface OptionsResponse {
  generations: Array<{ code: string; label: string }>;
  insurerTypes: Array<{ code: string; label: string }>;
  causes: Array<{ code: string; label: string }>;
}

export interface ApiFailure {
  error: string;
  reason?: string;
  defects?: Array<{ code: string; path: string }>;
}
