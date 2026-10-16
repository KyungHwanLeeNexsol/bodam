import { describe, expect, it } from 'vitest';
import { documentRuleSetToRuleItem, isUsable, mappingHoldCode, mappingToRuleItem, profileToRuleItem } from '../../src/engine/usability';
import type { ItemUsabilityReason, UsabilityContext } from '../../src/engine/usability';
import { approve, markExpired, markPublished, markSuperseded, reject, submitForReview, suspendItem } from '../../src/server/approval';
import { editDraft } from '../../src/server/authoring';
import { canonicalDigest } from '../../src/server/digest';
import type { TreatmentVersion } from '../../src/server/domain/entities';
import type { ItemVersionRecordOf, ItemVersionRef } from '../../src/server/domain/items';
import { toEngineDocumentRuleSet, toEngineMapping, toEngineProfile } from '../../src/server/domain/projection';
import { coverageFingerprintOf } from '../../src/server/fingerprint';
import { triggerReReview } from '../../src/server/re-review';
import { TEST_AT } from '../fixtures/engine/profiles.fixture';
import { TEST_FIXTURE_HA_1, TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_APPROVER_2, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { adoptTreatmentVersion, approvedOf, draftOf, newWorld, publishedOf, reviewRequestedOf, seedTreatment } from '../fixtures/server/lifecycle.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';

// 서비스로 만든 항목이 엔진의 단일 판정 isUsable 에서 기대대로 판정되는지 본다 (생명주기 ↔ 엔진 접합).
// 해시 함수는 운영 해시 canonicalDigest, 항목은 "저장된 내용 + 요청마다 새로 읽은 상태"를 projection 으로 합쳐 만든다.
// 게시(APPROVED → PUBLISHED)는 M3.D 의 규칙 묶음 게시를 흉내 내는 내부 전이 markPublished 로 한다.

const ctx: UsabilityContext = { at: TEST_AT, acceptedOrigins: ['TEST_FIXTURE'], digest: canonicalDigest };

interface Setup {
  w: World;
  current: { version: TreatmentVersion };
}

function setup(): Setup {
  const w = newWorld();
  const { treatmentVersion } = seedTreatment(w.repo);
  return { w, current: { version: treatmentVersion } };
}

/** 요청마다 하는 일: 내용(캐시 가능)을 읽고, 상태를 새로 읽어 합친 뒤, 줄이 가진 현재 지문과 함께 엔진에 묻는다. */
function judgeMapping(s: Setup, ref: ItemVersionRef): ReturnType<typeof isUsable> {
  const record = s.w.repo.getItemVersion(ref) as ItemVersionRecordOf<'MAPPING'>;
  const [state] = s.w.repo.readItemStates([ref]);
  return isUsable(mappingToRuleItem(toEngineMapping(record, state!), coverageFingerprintOf(s.current.version)), ctx);
}

function reasonOf(result: ReturnType<typeof isUsable>): ItemUsabilityReason | 'USABLE' {
  return result.usable ? 'USABLE' : result.reason;
}

/** 새 치료 버전을 게시한 것처럼: 현재 카탈로그로 삼고 재검토 전환을 부른다 (카탈로그 게시 서비스는 M3.D). */
function publishTreatmentVersion(s: Setup, version: TreatmentVersion): ItemVersionRef[] {
  adoptTreatmentVersion(s.w.repo, version);
  s.current.version = version;
  return triggerReReview(s.w.deps, TEST_FIXTURE_HA_1, version);
}

describe('매핑: 상태별 엔진 판정', () => {
  it('PUBLISHED 이고 고정 지문이 현재 지문과 같으면 사용 가능하다', () => {
    const s = setup();
    const ref = publishedOf(s.w, 'MAPPING');
    expect(judgeMapping(s, ref)).toEqual({ usable: true });
  });

  it('생명주기를 따라 가는 동안 PUBLISHED 가 되기 전에는 사용할 수 없고 사유가 DD-04 표와 맞는다', () => {
    const s = setup();
    const ref = draftOf(s.w, 'MAPPING');
    const reasons: Array<[string, ItemUsabilityReason | 'USABLE']> = [['DRAFT', reasonOf(judgeMapping(s, ref))]];
    submitForReview(s.w.deps, TEST_FIXTURE_RV_AUTHOR, ref);
    reasons.push(['REVIEW_REQUESTED', reasonOf(judgeMapping(s, ref))]);
    approve(s.w.deps, TEST_FIXTURE_RV_APPROVER, ref);
    reasons.push(['APPROVED', reasonOf(judgeMapping(s, ref))]);
    markPublished(s.w.deps, TEST_FIXTURE_RV_APPROVER, ref);
    reasons.push(['PUBLISHED', reasonOf(judgeMapping(s, ref))]);
    expect(reasons).toEqual([
      ['DRAFT', 'STATE_DRAFT'],
      ['REVIEW_REQUESTED', 'STATE_UNAPPROVED'],
      ['APPROVED', 'STATE_UNAPPROVED'],
      ['PUBLISHED', 'USABLE'],
    ]);
  });

  it('반려·중지·대체·만료는 사용할 수 없다 (STATE_REJECTED / STATE_INVALID)', () => {
    const s = setup();
    const rejected = reviewRequestedOf(s.w, 'MAPPING', 1);
    reject(s.w.deps, TEST_FIXTURE_RV_APPROVER, rejected, 'TEST_FIXTURE 반려');
    const suspended = publishedOf(s.w, 'MAPPING', 2);
    suspendItem(s.w.deps, TEST_FIXTURE_RV_APPROVER, suspended, 'TEST_FIXTURE 중지');
    const superseded = publishedOf(s.w, 'MAPPING', 3);
    markSuperseded(s.w.deps, TEST_FIXTURE_RV_APPROVER, superseded);
    const expired = publishedOf(s.w, 'MAPPING', 4);
    markExpired(s.w.deps, TEST_FIXTURE_RV_APPROVER, expired);
    expect([rejected, suspended, superseded, expired].map((ref) => reasonOf(judgeMapping(s, ref)))).toEqual([
      'STATE_REJECTED',
      'STATE_INVALID',
      'STATE_INVALID',
      'STATE_INVALID',
    ]);
  });

  it('항목 중지는 이미 읽어 둔 내용(캐시)과 상관없이 다음 판정부터 반영된다 (상태는 요청마다 새로 읽는다)', () => {
    const s = setup();
    const ref = publishedOf(s.w, 'MAPPING');
    const cachedContent = s.w.repo.getItemVersion(ref) as ItemVersionRecordOf<'MAPPING'>;
    const fingerprint = coverageFingerprintOf(s.current.version);
    const before = isUsable(mappingToRuleItem(toEngineMapping(cachedContent, s.w.repo.readItemStates([ref])[0]!), fingerprint), ctx);
    suspendItem(s.w.deps, TEST_FIXTURE_RV_APPROVER, ref, 'TEST_FIXTURE 중지');
    const after = isUsable(mappingToRuleItem(toEngineMapping(cachedContent, s.w.repo.readItemStates([ref])[0]!), fingerprint), ctx);
    expect(before).toEqual({ usable: true });
    expect(reasonOf(after)).toBe('STATE_INVALID');
  });
});

describe('재검토 전환과 엔진 판정 (DD-15·DD-16)', () => {
  it('보장 판단 필드가 바뀐 치료 버전을 게시하면 매핑이 UNDER_REREVIEW 가 되고 엔진이 MAPPING_UNDER_REREVIEW 를 낸다', () => {
    const s = setup();
    const ref = publishedOf(s.w, 'MAPPING');
    expect(judgeMapping(s, ref)).toEqual({ usable: true });

    const moved = publishTreatmentVersion(s, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', procedureCodes: ['TEST_FIXTURE_PROC_NEW'] }));

    expect(moved).toEqual([ref]);
    const result = judgeMapping(s, ref);
    expect(reasonOf(result)).toBe('STATE_UNDER_REREVIEW');
    expect(result.usable ? null : mappingHoldCode(result.reason)).toBe('MAPPING_UNDER_REREVIEW');
  });

  it('가격·표시 이름만 바뀐 치료 버전은 매핑을 그대로 쓸 수 있게 둔다', () => {
    const s = setup();
    const ref = publishedOf(s.w, 'MAPPING');
    const moved = publishTreatmentVersion(s, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', patientAmount: 77_000, displayName: 'TEST_FIXTURE 바뀐 이름' }));
    expect(moved).toEqual([]);
    expect(s.w.repo.getItemState(ref)?.state).toBe('PUBLISHED');
    expect(judgeMapping(s, ref)).toEqual({ usable: true });
  });

  it('상태 전환이 빠졌어도 지문 불일치만으로 엔진이 보류한다 (DD-15 백스톱)', () => {
    const s = setup();
    const ref = publishedOf(s.w, 'MAPPING');
    // 재검토 전환을 부르지 않은 채 현재 치료 버전만 바뀐 경우.
    s.current.version = makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', treatmentCode: 'TEST_FIXTURE_TC_CHANGED' });
    expect(s.w.repo.getItemState(ref)?.state).toBe('PUBLISHED');
    const result = judgeMapping(s, ref);
    expect(reasonOf(result)).toBe('INTEGRITY_MISMATCH');
    expect(result.usable ? null : mappingHoldCode(result.reason)).toBe('MAPPING_UNDER_REREVIEW');
  });

  it('재승인(다른 승인자)은 새 지문을 고정하고, 게시하면 다시 사용할 수 있다', () => {
    const s = setup();
    const ref = publishedOf(s.w, 'MAPPING');
    const oldFingerprint = s.w.repo.getItemState(ref)?.approvedFingerprint;
    const next = makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', calcClass: 'NEEDS_REVIEW' });
    publishTreatmentVersion(s, next);
    expect(reasonOf(judgeMapping(s, ref))).toBe('STATE_UNDER_REREVIEW');

    // 옛 승인자(작성자가 아닌 다른 RV)도, 새 승인자도 재승인할 수 있지만 작성자는 안 된다.
    expect(() => approve(s.w.deps, TEST_FIXTURE_RV_AUTHOR, ref)).toThrow();
    approve(s.w.deps, TEST_FIXTURE_RV_APPROVER_2, ref);
    expect(reasonOf(judgeMapping(s, ref))).toBe('STATE_UNAPPROVED');
    expect(s.w.repo.getItemState(ref)?.approvedFingerprint).toBe(coverageFingerprintOf(next));
    expect(coverageFingerprintOf(next)).not.toBe(oldFingerprint);

    markPublished(s.w.deps, TEST_FIXTURE_RV_APPROVER_2, ref);
    expect(judgeMapping(s, ref)).toEqual({ usable: true });
    expect(s.w.repo.getItemState(ref)?.approver?.approverId).toBe('TEST_FIXTURE_RV_APPROVER_2');
  });

  it('내용을 미리 읽어 두었어도(캐시) 합성은 새로 읽은 상태의 지문을 쓴다 (낡은 지문을 내지 않는다)', () => {
    const s = setup();
    const ref = publishedOf(s.w, 'MAPPING');
    const cachedContent = s.w.repo.getItemVersion(ref) as ItemVersionRecordOf<'MAPPING'>;
    const staleState = s.w.repo.readItemStates([ref])[0]!;
    const next = makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', benefitType: 'NON_BENEFIT' });
    publishTreatmentVersion(s, next);
    approve(s.w.deps, TEST_FIXTURE_RV_APPROVER_2, ref);
    const freshState = s.w.repo.readItemStates([ref])[0]!;

    expect(toEngineMapping(cachedContent, staleState).approvedFingerprint).toBe(coverageFingerprintOf(makeTreatmentVersion()));
    expect(toEngineMapping(cachedContent, freshState).approvedFingerprint).toBe(coverageFingerprintOf(next));
  });

  it('재검토 중 반려되면 사용할 수 없고 새 버전 DRAFT 가 아니면 되살릴 수 없다', () => {
    const s = setup();
    const ref = publishedOf(s.w, 'MAPPING');
    publishTreatmentVersion(s, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }));
    reject(s.w.deps, TEST_FIXTURE_RV_APPROVER, ref, 'TEST_FIXTURE 더는 보장하지 않음');
    expect(reasonOf(judgeMapping(s, ref))).toBe('STATE_REJECTED');
    expect(() => approve(s.w.deps, TEST_FIXTURE_RV_APPROVER_2, ref)).toThrow();
  });
});

describe('프로필·서류 규칙 묶음: 서비스가 봉인한 내용 해시가 엔진 무결성 판정을 통과한다', () => {
  it('프로필: 작성(봉인) → 수정(다시 봉인) → 승인 → 게시한 항목이 isUsable 을 통과한다', () => {
    const s = setup();
    const created = draftOf(s.w, 'PROFILE');
    const record = s.w.repo.getItemVersion(created) as ItemVersionRecordOf<'PROFILE'>;
    const changed = structuredClone(record.content);
    changed.groups[0]!.deduction = { kind: 'FIXED', fixed: 9_999 };
    editDraft(s.w.deps, TEST_FIXTURE_RV_AUTHOR, created, changed, 'TEST_FIXTURE 수정');
    submitForReview(s.w.deps, TEST_FIXTURE_RV_AUTHOR, created);
    approve(s.w.deps, TEST_FIXTURE_RV_APPROVER, created);
    markPublished(s.w.deps, TEST_FIXTURE_RV_APPROVER, created);

    const stored = s.w.repo.getItemVersion(created) as ItemVersionRecordOf<'PROFILE'>;
    const engine = toEngineProfile(stored, s.w.repo.readItemStates([created])[0]!);
    expect(engine.groups[0]?.deduction).toEqual({ kind: 'FIXED', fixed: 9_999 });
    expect(isUsable(profileToRuleItem(engine), ctx)).toEqual({ usable: true });
  });

  it('서류 규칙 묶음: 게시한 항목이 isUsable 을 통과하고, 중지하면 STATE_INVALID 이다', () => {
    const s = setup();
    const ref = publishedOf(s.w, 'DOCUMENT_RULE_SET');
    const stored = s.w.repo.getItemVersion(ref) as ItemVersionRecordOf<'DOCUMENT_RULE_SET'>;
    expect(isUsable(documentRuleSetToRuleItem(toEngineDocumentRuleSet(stored, s.w.repo.readItemStates([ref])[0]!)), ctx)).toEqual({ usable: true });
    suspendItem(s.w.deps, TEST_FIXTURE_RV_APPROVER, ref, 'TEST_FIXTURE 중지');
    expect(reasonOf(isUsable(documentRuleSetToRuleItem(toEngineDocumentRuleSet(stored, s.w.repo.readItemStates([ref])[0]!)), ctx))).toBe('STATE_INVALID');
  });

  it('프로필: 승인 직후(게시 전)에는 STATE_UNAPPROVED 이다', () => {
    const s = setup();
    const ref = approvedOf(s.w, 'PROFILE');
    const stored = s.w.repo.getItemVersion(ref) as ItemVersionRecordOf<'PROFILE'>;
    expect(reasonOf(isUsable(profileToRuleItem(toEngineProfile(stored, s.w.repo.readItemStates([ref])[0]!)), ctx))).toBe('STATE_UNAPPROVED');
  });
});
