// 관리자 화면이 읽는 관리자 API 응답의 모양 (src/server/admin/router.ts 와 admin/catalog-preview.ts 의 응답). 화면 코드는 서버 모듈을 가져오지 않고 이 형식만 쓴다.

export interface TreatmentRow {
  treatmentId: string;
  displayName: string;
  description: string;
  benefitType: 'BENEFIT' | 'NON_BENEFIT';
  treatmentCode: string;
  procedureCodes: string[];
  patientAmount: number;
  priceCondition: string;
  order: number;
}

export interface DraftView {
  baseCatalogVersionId: string;
  priceEdits: Array<{ treatmentId: string; patientAmount: number }>;
  updatedAt: string;
  updatedBy: string;
  draftDigest: string;
  stale: boolean;
}

export interface TreatmentsResponse {
  clinic: { id: string; slug: string; displayName: string };
  catalogVersion: string | null;
  treatments: TreatmentRow[];
  baseFees: Array<{ baseFeeId: string; displayName: string; benefitType: string; amount: number }>;
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
  changeSummary: { addedTreatmentIds: string[]; removedTreatmentIds: string[]; priceChangedTreatmentIds: string[]; baseFeesChanged: boolean };
  current: boolean;
}

export interface EstimateSide {
  result: {
    state: string;
    amounts: { hospitalPayment: number; expectedInsurancePayout: number | null; expectedOutOfPocketAfterPayout: number | null };
  };
}

export interface PreviewResponse {
  basedOnCatalogVersion: string;
  request: { generation: string; insurerType: string; cause: string; treatmentIds: string[] };
  priceChanges: Array<{ treatmentId: string; displayName: string; before: number; after: number }>;
  before: EstimateSide;
  after: EstimateSide;
  draftDigest: string;
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
