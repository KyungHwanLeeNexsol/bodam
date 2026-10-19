import type { BenefitType } from '../../engine/types';
import type { Clinic, IdleThreshold, InstitutionType } from '../domain/entities';
import { readIdlePolicy } from '../idle-policy';
import type { IdleScreenKind } from '../idle-policy';
import type { Repository } from '../repo/interfaces';
import { handleClinicRead } from './clinic';
import { readPublishedCatalog } from './published-catalog';
import type { ApiServices } from './services';

// GET /api/clinics/{slug}/catalog (SPEC-REIMBURSEMENT-001 M4.A, design.md DD-19, AC-018a).
// 표시 필드만 낸다. 검토 상태·지문·검토자·출처·보장 판단 필드(치료 코드·행위 코드·분류)·서류 표시·병원 연락처·내부 id 는 응답에 없다.
// 규칙 묶음과 항목은 읽지 않는다: 이 응답은 규칙 사용 범위나 묶음 중지와 무관하다(중지는 options 의 ruleBundleStatus 로 알린다).

/** 서비스 이름. 기획서 §4 가 확정한 이름이다. */
const SERVICE_DISPLAY_NAME = '보담';

/** 병원 종별 → 응답의 setting. 의원(CLINIC)은 통원 전용이다(기획서 §4 화면 3, DD-19 예시). 서류 산출의 clinicSetting(M4.B)도 이 표를 쓴다. */
export const SETTING_OF: Record<InstitutionType, 'OUTPATIENT_ONLY'> = { CLINIC: 'OUTPATIENT_ONLY' };

export interface CatalogTreatmentView {
  treatmentId: string;
  displayName: string;
  description: string;
  benefitType: BenefitType;
  patientAmount: number;
  priceCondition: string;
  order: number;
}

export interface CatalogBaseFeeView {
  baseFeeId: string;
  displayName: string;
  benefitType: BenefitType;
  amount: number;
}

export interface CatalogResponse {
  clinic: { slug: string; displayName: string; setting: 'OUTPATIENT_ONLY' };
  serviceDisplayName: string;
  /** 병원의 현재 카탈로그 버전 id. 게시한 적이 없으면 null. */
  catalogVersion: string | null;
  treatments: CatalogTreatmentView[];
  baseFees: CatalogBaseFeeView[];
  baseFeeIncluded: 'INCLUDED' | 'NOT_REGISTERED';
  idlePolicy: { screens: Record<IdleScreenKind, IdleThreshold>; completionHoldSeconds: number | null };
}

/**
 * 금액 적용 조건(환자 유형·가정·기준일)을 한 줄 문구로 만든다. [문서에 없음] DD-19 는 `priceCondition` 이 문자열이라고만 정한다.
 * 저장된 세 값을 가운뎃점으로 이어 붙이고 기준일에만 라벨을 붙인다. 값을 해석하거나 바꾸지 않는다.
 */
function priceConditionOf(condition: { patientType: string; assumption: string; referenceDate: string }): string {
  return `${condition.patientType} · ${condition.assumption} · 기준일 ${condition.referenceDate}`;
}

// @MX:NOTE: [AUTO] [문서에 없음] 카탈로그를 게시한 적 없는 병원은 404 가 아니라 200 이다: catalogVersion null, 치료·기본비용 빈 목록, baseFeeIncluded NOT_REGISTERED.
// 병원은 있으므로 CLINIC_NOT_FOUND 가 아니고, 키오스크는 고를 치료가 없어 계산 요청을 만들 수 없다(계산 요청은 문자열 catalogVersion 이 필수).
/** catalog 응답 본문을 만든다. 읽기만 하며 저장소를 바꾸지 않는다. */
export function buildCatalogResponse(repo: Repository, clinic: Clinic): CatalogResponse {
  const published = readPublishedCatalog(repo, clinic);
  const idle = readIdlePolicy(repo, clinic.id);
  return {
    clinic: { slug: clinic.slug, displayName: clinic.name, setting: SETTING_OF[clinic.institutionType] },
    serviceDisplayName: SERVICE_DISPLAY_NAME,
    catalogVersion: published.catalog === null ? null : published.catalog.id,
    treatments: published.treatments.map(({ treatment, version }) => ({
      treatmentId: treatment.id,
      displayName: version.displayName,
      description: version.description,
      benefitType: version.benefitType,
      patientAmount: version.patientAmount,
      priceCondition: priceConditionOf(version.amountCondition),
      order: treatment.sortOrder,
    })),
    baseFees: published.baseFees.map((fee) => ({ baseFeeId: fee.baseFeeId, displayName: fee.displayName, benefitType: fee.benefitType, amount: fee.amount })),
    baseFeeIncluded: published.baseFees.length > 0 ? 'INCLUDED' : 'NOT_REGISTERED',
    idlePolicy: { screens: idle.screens, completionHoldSeconds: idle.completionHoldSeconds },
  };
}

/** route.ts 의 GET 이 부르는 핸들러. */
export function handleCatalog(services: ApiServices, slug: string): Promise<Response> {
  return handleClinicRead(services, slug, (clinic) => buildCatalogResponse(services.repo, clinic));
}
