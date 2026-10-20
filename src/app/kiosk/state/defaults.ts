import type { CatalogDto, OptionsDto } from './api-types';
import { resolveIdlePolicy } from './idle';
import type { ClinicData, DerivedData, OverlayState, PatientInputs } from './session-store';

// 빈 세션의 기본값과 병원 자료 묶음 만들기 (SPEC-REIMBURSEMENT-001 M5.A·M5.C). 런타임으로는 idle.ts 만 가져오는 잎 모듈이라서
// session-store.ts(초기화)와 refresh.ts(갱신 반영)가 서로를 가져오지 않고 같은 값을 쓴다.

export const NO_OVERLAY: OverlayState = { kind: 'NONE' };
export const EMPTY_INPUTS: PatientInputs = Object.freeze({ generation: null, insurerType: null, cause: null, treatmentIds: Object.freeze([]) });
export const EMPTY_DERIVED: DerivedData = Object.freeze({ estimate: null, documents: null, basis: null, returnContext: null });

/** 병원 자료 묶음을 만든다: 두 버전은 응답이 가진 값 그대로(없으면 null)이고, 무조작 정책은 catalog 응답의 `idlePolicy` 에서 읽는다(DD-19). */
export function createClinicData(catalog: CatalogDto, options: OptionsDto): ClinicData {
  return {
    catalog,
    options,
    versions: { catalogVersion: catalog.catalogVersion, ruleBundleVersion: options.ruleBundleVersion },
    idle: resolveIdlePolicy(catalog.idlePolicy),
  };
}
