import type { ApproverRecord, DocumentRuleSet, LifecycleState, PublishedLine, StandardAssumptionProfile, TreatmentCoverageMapping } from '../../engine/types';
import { calcClassOfBaseFee, coverageFingerprintOf, coverageFingerprintOfBaseFee } from '../fingerprint';
import type { CommonBaseFee, TreatmentVersion } from './entities';
import { DomainError } from './errors';
import type { ItemContentByKind, ItemKind, ItemStateSnapshot, ItemVersionRecordOf } from './items';

// 바뀌지 않는 항목 내용 + 방금 읽은 현재 상태 → 엔진이 읽는 항목 형식 (design.md DD-14 "항목 생명주기 상태와 캐시 계약").
// 계산 요청마다 서버는 (캐시해도 되는) 내용에 (캐시하지 않는) 현재 상태를 채워 RuleBundleSnapshot 을 조립한다(M3.D·M3.E·M4).
// 이 모듈이 그 합성의 단일 구현이다: state 와 approver 는 내용이 아니라 상태 기록에서만 온다.
// 순수 함수이며 입력을 바꾸지 않고, 결과는 입력과 깊이 분리된 복사본이다.

type Assembled<K extends ItemKind> = ItemContentByKind[K] & { state: LifecycleState; approver: ApproverRecord | null };

function assemble<K extends ItemKind>(record: ItemVersionRecordOf<K>, state: ItemStateSnapshot): Assembled<K> {
  const same = state.ref.kind === record.ref.kind && state.ref.id === record.ref.id && state.ref.version === record.ref.version;
  if (!same) {
    throw new DomainError(
      'REF_CONTENT_MISMATCH',
      `상태 기록(${state.ref.kind}/${state.ref.id}/${state.ref.version})이 내용(${record.ref.kind}/${record.ref.id}/${record.ref.version})의 것이 아니다`,
    );
  }
  return {
    ...structuredClone(record.content),
    state: state.state,
    approver: state.approver === null ? null : { ...state.approver },
  };
}

// @MX:ANCHOR: [AUTO] 프로필 내용 + 현재 상태 합성. 규칙 묶음 조립(M3.D)·준비 상태 계산(M3.E)·계산 요청(M4)이 같은 합성을 부른다.
// @MX:REASON: state 를 내용에서 읽거나 캐시하면 항목 중지·재검토가 다음 요청에 반영되지 않는다(DD-14). 합성 구현이 둘이면 그 차이가 판정 차이가 된다.
export function toEngineProfile(record: ItemVersionRecordOf<'PROFILE'>, state: ItemStateSnapshot): StandardAssumptionProfile {
  return assemble(record, state);
}

// 매핑의 approvedFingerprint 는 승인 시점의 사실이라 내용이 아니라 상태 기록에서 온다(items.ts 머리말). 아직 고정되지 않았으면(null)
// 엔진 형식에는 빈 문자열이 들어가고, 엔진의 무결성 판정(isUsable)이 빈 지문을 INTEGRITY_MISMATCH 로 막는다.
export function toEngineMapping(record: ItemVersionRecordOf<'MAPPING'>, state: ItemStateSnapshot): TreatmentCoverageMapping {
  return { ...assemble(record, state), approvedFingerprint: state.approvedFingerprint ?? '' };
}

export function toEngineDocumentRuleSet(record: ItemVersionRecordOf<'DOCUMENT_RULE_SET'>, state: ItemStateSnapshot): DocumentRuleSet {
  return assemble(record, state);
}

// ───────────────────────── 게시된 줄 ─────────────────────────
// 병원의 현재 카탈로그 버전에 든 치료 버전과 공통 기본비용을 엔진의 게시 줄로 바꾼다. 준비 상태 계산(M3.E)과 계산 경로(M4)가 같은 변환을 쓴다.

/** 치료 버전 → 줄. 지문은 보장 판단 필드에서 나온다(DD-15). 값은 복사본이며 입력을 바꾸지 않는다. */
export function toEnginePublishedLine(version: TreatmentVersion): PublishedLine {
  return {
    treatmentId: version.treatmentId,
    treatmentVersionId: version.id,
    displayName: version.displayName,
    benefitType: version.benefitType,
    calcClass: version.calcClass,
    patientAmount: version.patientAmount,
    coverageFingerprint: coverageFingerprintOf(version),
    isBaseFee: false,
    documentFlags: { ...version.documentFlags },
    origin: version.origin,
  };
}

// @MX:NOTE: [AUTO] [문서에 없음] 공통 기본비용(CommonBaseFee)에는 분류·지문·치료 버전이 없다. DD-03 은 기본비용 줄이 치료와 같은 매핑 판정을 거친다고만 적는다.
// 여기서 정한 변환: 줄 id 는 기본비용의 안정 식별자(baseFeeId, 매핑의 treatmentId 가 가리키는 값)이고 줄의 버전 id 는 기본비용 버전 id,
// 분류는 급여 구분에서(급여 → GENERAL_BENEFIT, 비급여 → GENERAL_NON_BENEFIT, 확인 필요로 두지 않는다 — fingerprint.ts 의 calcClassOfBaseFee 한 곳),
// 서류 표시는 모두 false, 지문은 coverageFingerprintOfBaseFee(매핑 승인이 고정하는 값과 같은 함수)다.
/** 공통 기본비용 → 줄. */
export function toEngineBaseFeeLine(fee: CommonBaseFee): PublishedLine {
  return {
    treatmentId: fee.baseFeeId,
    treatmentVersionId: fee.id,
    displayName: fee.displayName,
    benefitType: fee.benefitType,
    calcClass: calcClassOfBaseFee(fee.benefitType),
    patientAmount: fee.amount,
    coverageFingerprint: coverageFingerprintOfBaseFee(fee),
    isBaseFee: true,
    documentFlags: { imaging: false, biopsy: false, opinionRequired: false },
    origin: fee.origin,
  };
}
