import { documentRuleSetContent, profileContent } from '../../../src/engine/usability';
import type { DocumentRuleSet, StandardAssumptionProfile, TreatmentCoverageMapping } from '../../../src/engine/types';
import { canonicalDigest } from '../../../src/server/digest';
import type { ItemVersionRecordOf } from '../../../src/server/domain/items';
import { planningExampleRuleSet } from '../engine/document-rules.fixture';
import { makeMapping } from '../engine/mappings.fixture';
import { makeProfile } from '../engine/profiles.fixture';
import { TEST_FIXTURE_RV_AUTHOR } from './actors.fixture';
import { TEST_FIXTURE_NOW } from './entities.fixture';

// 시험 자료(TEST_FIXTURE). 엔진 시험 자료(tests/fixtures/engine)의 내용을 그대로 재사용해
// "state·approver 를 뺀 바뀌지 않는 내용" 기록으로 바꾸고, 내용 해시는 운영 해시(canonicalDigest)로 봉인한다.
// 엔진 쪽 자료의 데이터는 복사하지 않는다.

export function profileRecord(overrides: Partial<StandardAssumptionProfile> = {}): ItemVersionRecordOf<'PROFILE'> {
  const profile = makeProfile(overrides);
  const { state: _state, approver: _approver, ...content } = profile;
  return {
    ref: { kind: 'PROFILE', id: profile.id, version: profile.version },
    content: { ...content, contentHash: canonicalDigest(profileContent(profile)) },
    authorId: TEST_FIXTURE_RV_AUTHOR.id,
    createdAt: TEST_FIXTURE_NOW,
  };
}

export function mappingRecord(
  treatmentId = 'TEST_FIXTURE_TREATMENT_1',
  overrides: Partial<TreatmentCoverageMapping> = {},
): ItemVersionRecordOf<'MAPPING'> {
  const mapping = makeMapping(treatmentId, overrides);
  // 매핑의 approvedFingerprint 는 승인 시점의 사실이라 내용이 아니라 상태 기록이 갖는다 (M3.B 결정).
  const { state: _state, approver: _approver, approvedFingerprint: _approvedFingerprint, ...content } = mapping;
  return {
    ref: { kind: 'MAPPING', id: mapping.id, version: mapping.version },
    content,
    authorId: TEST_FIXTURE_RV_AUTHOR.id,
    createdAt: TEST_FIXTURE_NOW,
  };
}

export function documentRuleSetRecord(overrides: Partial<DocumentRuleSet> = {}): ItemVersionRecordOf<'DOCUMENT_RULE_SET'> {
  const ruleSet = planningExampleRuleSet(overrides);
  const { state: _state, approver: _approver, ...content } = ruleSet;
  return {
    ref: { kind: 'DOCUMENT_RULE_SET', id: ruleSet.id, version: ruleSet.version },
    content: { ...content, contentHash: canonicalDigest(documentRuleSetContent(ruleSet)) },
    authorId: TEST_FIXTURE_RV_AUTHOR.id,
    createdAt: TEST_FIXTURE_NOW,
  };
}
