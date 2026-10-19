import { describe, expect, it } from 'vitest';
import { assertBundleStructure, composeBundleSnapshot, loadBundleContent } from '../../src/server/api/bundle-content';
import type { BundleContent } from '../../src/server/api/bundle-content';
import { createBundleContentCache } from '../../src/server/api/bundle-content-cache';
import { ServerIntegrityError } from '../../src/server/api/integrity';
import { suspendItem } from '../../src/server/approval';
import { loadReadinessSnapshot } from '../../src/server/readiness';
import { TEST_FIXTURE_RV_APPROVER } from '../fixtures/server/actors.fixture';
import { buildWorld, specOf } from '../fixtures/server/estimate-world.fixture';
import { engineSnapshotOf, approveSpec } from '../fixtures/server/versioning.fixture';
import { repoWith } from './helpers';

// 규칙 묶음의 읽기 3단계 (M4.B, src/server/api/bundle-content.ts): 내용 읽기 -> 구조 검사 -> 현재 상태 합성.
// 합성은 준비 상태 계산(readiness)과 같은 projection.ts 의 단일 구현을 쓴다. 이 파일은 그 일치와 "상태는 내용에서 오지 않는다"를 단위 수준에서 확인한다
// (통합 수준의 읽기 횟수와 500 변환은 estimate-compute·estimate-integrity 가 본다).

function world() {
  const w = buildWorld();
  const content = loadBundleContent(w.world.repo, w.bundle!.id, createBundleContentCache());
  return { w, content };
}

describe('loadBundleContent: 바뀌지 않는 내용만 읽는다', () => {
  it('묶음 기록 1회와 항목 내용 5회(프로필 1 + 매핑 3 + 서류 규칙 1)를 읽고 항목 상태는 읽지 않는다', () => {
    const w = buildWorld();
    w.world.repo.spy.reset();
    const content = loadBundleContent(w.world.repo, w.bundle!.id, createBundleContentCache());
    expect(w.world.repo.spy.counts.getRuleBundleVersion).toBe(1);
    expect(w.world.repo.spy.counts.getItemVersion).toBe(5);
    expect(w.world.repo.spy.counts.readItemStates).toBe(0);
    expect(w.world.repo.spy.counts.getItemState).toBe(0);
    expect(w.world.repo.spy.counts.getBundleStatus).toBe(0);
    expect([content.profiles.length, content.mappings.length, content.documentRuleSet === null ? 0 : 1]).toEqual([1, 3, 1]);
  });

  it('내용에는 상태·승인자·승인 지문이 없다 (이 셋은 요청마다 새로 읽는 값이다)', () => {
    const { content } = world();
    for (const record of [...content.profiles, ...content.mappings, content.documentRuleSet!]) {
      for (const stateField of ['state', 'approver', 'approvedFingerprint']) {
        expect(Object.keys(record.content), `${record.ref.kind} ${stateField}`).not.toContain(stateField);
      }
    }
    expect(content.id).toBe('TEST_FIXTURE_BUNDLE_1');
    expect(content.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('없는 묶음이면 BUNDLE_MISSING, 항목 내용이 없으면 ITEM_CONTENT_MISSING 이다', () => {
    const w = buildWorld();
    expect(() => loadBundleContent(w.world.repo, 'NO_SUCH_BUNDLE', createBundleContentCache())).toThrow(new ServerIntegrityError('BUNDLE_MISSING'));
    const noItems = repoWith(w.world.repo, { getItemVersion: () => null });
    expect(() => loadBundleContent(noItems, w.bundle!.id, createBundleContentCache())).toThrow(new ServerIntegrityError('ITEM_CONTENT_MISSING'));
  });

  it('서류 규칙 묶음이 둘 이상 저장돼 있으면 itemRefs 순서의 첫 번째만 쓴다 (준비 상태 계산과 같다)', () => {
    const w = buildWorld();
    const second = approveSpec(w.world, specOf({ idSuffix: '_B' }));
    const bundle = w.bundle!;
    const doubled = { ...bundle, itemRefs: [...bundle.itemRefs, second.documentRuleSet!] };
    const content = loadBundleContent(repoWith(w.world.repo, { getRuleBundleVersion: () => doubled }), bundle.id, createBundleContentCache());
    expect(content.documentRuleSet!.ref.id).toBe('TEST_FIXTURE_DOCUMENT_RULE_SET_1');
  });
});

describe('composeBundleSnapshot: 내용 + 방금 읽은 상태 (projection.ts 의 단일 합성)', () => {
  it('준비 상태 계산이 같은 저장소에서 조립한 묶음과 깊이까지 같다 (합성 구현이 하나다)', () => {
    const { w, content } = world();
    const composed = composeBundleSnapshot(w.world.repo, content, 'ACTIVE');
    const reference = loadReadinessSnapshot(w.world.repo).bundles.find((bundle) => bundle.id === content.id);
    expect(composed).toEqual(reference);
    expect(composed).toEqual(engineSnapshotOf(w.world.repo, content.id));
  });

  it('항목 상태 읽기는 정확히 한 번이고 가용성은 읽지 않는다 (가용성은 호출하는 쪽이 넘긴다)', () => {
    const { w, content } = world();
    w.world.repo.spy.reset();
    composeBundleSnapshot(w.world.repo, content, 'ACTIVE');
    expect(w.world.repo.spy.counts.readItemStates).toBe(1);
    expect(w.world.repo.spy.counts.getBundleStatus).toBe(0);
    expect(w.world.repo.spy.counts.getItemVersion).toBe(0);
    expect(w.world.repo.spy.counts.getRuleBundleVersion).toBe(0);
  });

  it('같은 내용 객체로 다시 합성해도 상태는 그때 저장소의 값이다: 항목을 중지하면 다음 합성에 SUSPENDED 가 나온다 (상태가 내용에서 오지 않는다)', () => {
    const { w, content } = world();
    const before = composeBundleSnapshot(w.world.repo, content, 'ACTIVE');
    expect(before.mappings.map((mapping) => mapping.state)).toEqual(['PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
    const target = content.mappings[0]!.ref;
    suspendItem(w.world.deps, TEST_FIXTURE_RV_APPROVER, target, 'TEST_FIXTURE 중지 사유');
    const after = composeBundleSnapshot(w.world.repo, content, 'ACTIVE');
    expect(after.mappings.map((mapping) => mapping.state).sort()).toEqual(['PUBLISHED', 'PUBLISHED', 'SUSPENDED']);
    expect(after.mappings.find((mapping) => mapping.id === target.id)!.state).toBe('SUSPENDED');
    expect(after.profiles.map((profile) => profile.state)).toEqual(['PUBLISHED']);
  });

  it('가용성은 넘긴 값 그대로 담긴다', () => {
    const { w, content } = world();
    expect(composeBundleSnapshot(w.world.repo, content, 'SUSPENDED').status).toBe('SUSPENDED');
    expect(composeBundleSnapshot(w.world.repo, content, 'ACTIVE').status).toBe('ACTIVE');
  });

  it('내용을 바꾸지 않고, 결과는 내용과 분리된 복사본이다', () => {
    const { w, content } = world();
    const frozen = structuredClone(content);
    const snapshot = composeBundleSnapshot(w.world.repo, content, 'ACTIVE');
    expect(content).toEqual(frozen);
    snapshot.profiles[0]!.groups.length = 0;
    snapshot.mappings.length = 0;
    expect(content).toEqual(frozen);
  });

  it('항목이 없는 내용도 상태 읽기를 한 번 하고 빈 묶음을 만든다', () => {
    const w = buildWorld();
    const empty: BundleContent = { id: 'B', contentHash: 'H', profiles: [], mappings: [], documentRuleSet: null };
    w.world.repo.spy.reset();
    expect(composeBundleSnapshot(w.world.repo, empty, 'ACTIVE')).toEqual({ id: 'B', contentHash: 'H', status: 'ACTIVE', profiles: [], mappings: [], documentRuleSet: null });
    expect(w.world.repo.spy.counts.readItemStates).toBe(1);
  });

  it('상태 기록이 하나라도 없으면 ITEM_STATE_MISSING 이다 (상태를 추측하지 않는다)', () => {
    const { w, content } = world();
    const refs = [...content.profiles, ...content.mappings, content.documentRuleSet!].map((record) => record.ref);
    const real = w.world.repo.readItemStates(refs);
    expect(real.every((state) => state !== null)).toBe(true);
    const partial = repoWith(w.world.repo, { readItemStates: () => real.map((state, index) => (index === 3 ? null : state)) });
    expect(() => composeBundleSnapshot(partial, content, 'ACTIVE')).toThrow(new ServerIntegrityError('ITEM_STATE_MISSING'));
  });
});

describe('assertBundleStructure', () => {
  const ok = (): BundleContent => world().content;

  it('정상 내용과 빈 배열은 통과한다', () => {
    const { content } = world();
    expect(() => assertBundleStructure(content)).not.toThrow();
    expect(() => assertBundleStructure({ ...content, profiles: [], mappings: [] })).not.toThrow();
  });

  it('희소 배열의 빈 칸도 결함이다 (인덱스로 모든 칸을 본다)', () => {
    const content = ok();
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [content.profiles[0], , content.profiles[0]] as unknown as BundleContent['profiles'];
    expect(() => assertBundleStructure({ ...content, profiles: sparse })).toThrow(new ServerIntegrityError('BUNDLE_STRUCTURE_INVALID'));
  });

  it.each([
    ['content 가 문자열', { ...ok().profiles[0]!, content: 'x' }],
    ['content 가 undefined', { ...ok().profiles[0]!, content: undefined }],
    ['content 가 배열', { ...ok().profiles[0]!, content: [] }],
  ])('프로필 기록의 %s -> 결함', (_label, record) => {
    expect(() => assertBundleStructure({ ...ok(), profiles: [record as unknown as BundleContent['profiles'][number]] })).toThrow(new ServerIntegrityError('BUNDLE_STRUCTURE_INVALID'));
  });

  it('documentRuleSet 은 범위 밖이다: null 이어도 결함이 아니다', () => {
    expect(() => assertBundleStructure({ ...ok(), documentRuleSet: null })).not.toThrow();
  });
});
