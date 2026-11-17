import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_WON } from '../../src/engine/limits';
import type { LifecycleState } from '../../src/engine/types';
import { approve, markExpired, markPublished, markSuperseded, reject, submitForReview, suspendItem } from '../../src/server/approval';
import { createDraft, createNextDraft } from '../../src/server/authoring';
import { bundleContentHashOf, computeBundleContentHash, publishRuleBundle } from '../../src/server/bundle-publish';
import { canonicalDigest } from '../../src/server/digest';
import type { Defect } from '../../src/server/domain/errors';
import type { ItemKind, ItemVersionRef, ProfileContent } from '../../src/server/domain/items';
import { triggerReReview } from '../../src/server/re-review';
import { TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_APPROVER_2, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { profileRecord } from '../fixtures/server/items.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { adoptTreatmentVersion, baseContent, forceState } from '../fixtures/server/lifecycle.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { deepFreeze, setAt, unsetAt } from '../fixtures/server/mutate.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';
import {
  TEST_FIXTURE_RV_PUBLISHER,
  approveSpec,
  bundleWorld,
  publishRefs,
  publishedBundleOf,
  validSpec,
} from '../fixtures/server/versioning.fixture';
import type { BundleRefs, BundleSpec } from '../fixtures/server/versioning.fixture';

// 규칙 묶음 게시 서비스 (M3.D1, design.md DD-14·DD-17, 역할 RV). 검증기(publish-validate)를 저장소 트랜잭션 안에서 부르고,
// 검증기가 보지 않는 전제(항목 상태·유효 기간·참조-내용 일치·매핑 지문)를 서비스가 확인한다. 거절은 전부 저장소 전후 비교가 같아야 한다.
// 이 파일은 AC-007f, AC-011h(규칙 묶음), AC-011i 와 묶음 내용 해시를 시험한다. 모든 id·주체는 TEST_FIXTURE 다.

const KINDS: readonly ItemKind[] = ['PROFILE', 'MAPPING', 'DOCUMENT_RULE_SET'];

function slotOf(kind: ItemKind): string {
  return kind === 'PROFILE' ? 'bundle.profiles[0]' : kind === 'MAPPING' ? 'bundle.mappings[0]' : 'bundle.documentRuleSet';
}

function requestOfKind(kind: ItemKind, ref: ItemVersionRef): BundleRefs {
  return { profiles: kind === 'PROFILE' ? [ref] : [], mappings: kind === 'MAPPING' ? [ref] : [], documentRuleSet: kind === 'DOCUMENT_RULE_SET' ? ref : null };
}

const emptyRequest = (): BundleRefs => ({ profiles: [], mappings: [], documentRuleSet: null });

describe('규칙 묶음 게시: 정상 경로', () => {
  it('RV 가 게시하면 새 id 의 묶음이 쓰이고 항목 참조가 (종류, id, 버전) 코드 포인트 순으로 담긴다', () => {
    const w = bundleWorld();
    const refs = approveSpec(w, validSpec(1));

    const bundle = publishRefs(w, refs);

    expect(bundle).toEqual({
      id: 'TEST_FIXTURE_BUNDLE_1',
      itemRefs: [refs.documentRuleSet, refs.mappings[0], refs.profiles[0]], // DOCUMENT_RULE_SET < MAPPING < PROFILE
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      publishedBy: { id: 'TEST_FIXTURE_RV_PUBLISHER', role: 'RV' },
      publishedAt: '2026-10-16T09:00:00.000Z',
    });
    expect(w.repo.getRuleBundleVersion(bundle.id)).toEqual(bundle);
  });

  it('같은 트랜잭션에서 첫 ACTIVE 가용성 기록을 쓴다 (수행자 id·역할·일시, 이전 상태 null)', () => {
    const w = bundleWorld();
    const { bundle } = publishedBundleOf(w);
    expect(w.repo.listBundleStatusEvents(bundle.id)).toEqual([
      { bundleId: bundle.id, status: 'ACTIVE', actorId: 'TEST_FIXTURE_RV_PUBLISHER', role: 'RV', at: '2026-10-16T09:00:00.000Z', reason: null, previousStatus: null },
    ]);
    expect(w.repo.getBundleStatus(bundle.id)).toBe('ACTIVE');
  });

  it('APPROVED 항목은 게시와 함께 PUBLISHED 가 되고 전이는 이력에 남는다 (승인자와 고정 지문은 그대로)', () => {
    const w = bundleWorld();
    const refs = approveSpec(w, validSpec(1));
    const approvedState = new Map([...refs.profiles, ...refs.mappings, refs.documentRuleSet!].map((ref) => [ref.kind, w.repo.getItemState(ref)!]));
    w.clock.set('2026-10-20T00:00:00.000Z');

    publishRefs(w, refs);

    for (const ref of [...refs.profiles, ...refs.mappings, refs.documentRuleSet!]) {
      const state = w.repo.getItemState(ref)!;
      const approved = approvedState.get(ref.kind)!;
      expect(state.state).toBe('PUBLISHED');
      expect(state.approver).toEqual(approved.approver);
      expect(state.approvedFingerprint).toBe(approved.approvedFingerprint);
      expect(state.history.at(-1)).toEqual({
        from: 'APPROVED',
        to: 'PUBLISHED',
        actorId: 'TEST_FIXTURE_RV_PUBLISHER',
        role: 'RV',
        at: '2026-10-20T00:00:00.000Z',
        reason: null,
        approver: approved.approver,
        approvedFingerprint: approved.approvedFingerprint,
      });
    }
  });

  it('감사 기록: 묶음 게시 한 건(수행자 id·역할)과 항목 게시 세 건', () => {
    const w = bundleWorld();
    const { bundle } = publishedBundleOf(w);
    const entries = w.repo.listAuditLog();
    const publish = entries.filter((entry) => entry.action === 'BUNDLE_PUBLISH');
    expect(publish).toEqual([
      { id: expect.any(String), actorId: 'TEST_FIXTURE_RV_PUBLISHER', role: 'RV', action: 'BUNDLE_PUBLISH', target: `BUNDLE/${bundle.id}`, beforeVersion: null, afterVersion: bundle.id, reason: null, at: '2026-10-16T09:00:00.000Z' },
    ]);
    const items = entries.filter((entry) => entry.action === 'ITEM_PUBLISH');
    expect(items).toHaveLength(3);
    expect(items.every((entry) => entry.actorId === 'TEST_FIXTURE_RV_PUBLISHER' && entry.role === 'RV' && entry.beforeVersion === 'APPROVED' && entry.afterVersion === 'PUBLISHED')).toBe(true);
  });

  it('이미 PUBLISHED 인 항목 버전은 다른 묶음에 전이 없이 담긴다 (같은 항목을 담은 두 번째 묶음)', () => {
    const w = bundleWorld();
    const first = publishedBundleOf(w, 1);
    const histories = [...first.refs.profiles, ...first.refs.mappings, first.refs.documentRuleSet!].map((ref) => w.repo.getItemState(ref)!.history.length);

    const second = publishRefs(w, first.refs);

    expect(second.id).not.toBe(first.bundle.id);
    expect(second.itemRefs).toEqual(first.bundle.itemRefs);
    expect([...first.refs.profiles, ...first.refs.mappings, first.refs.documentRuleSet!].map((ref) => w.repo.getItemState(ref)!.history.length)).toEqual(histories);
    expect(w.repo.listAuditLog().filter((entry) => entry.action === 'ITEM_PUBLISH')).toHaveLength(3); // 첫 묶음에서만
    expect(w.repo.getBundleStatus(first.bundle.id)).toBe('ACTIVE');
    expect(w.repo.getBundleStatus(second.id)).toBe('ACTIVE');
  });

  it('요청 객체를 바꾸지 않는다 (깊이 얼린 요청도 게시된다)', () => {
    const w = bundleWorld();
    const refs = deepFreeze(approveSpec(w, validSpec(1)));
    const before = structuredClone(refs);
    expect(() => publishRefs(w, refs)).not.toThrow();
    expect(refs).toEqual(before);
  });

  it('빈 목록과 서류 규칙 묶음 없음(null)만 있는 묶음도 게시된다 (빈 배열은 형식 결함이 아니다)', () => {
    const w = bundleWorld();
    const bundle = publishRefs(w, emptyRequest());
    expect(bundle.itemRefs).toEqual([]);
    expect(w.repo.getBundleStatus(bundle.id)).toBe('ACTIVE');
  });

  it('서류 규칙 묶음 없이 프로필·매핑만 게시할 수 있다', () => {
    const w = bundleWorld();
    const refs = approveSpec(w, { ...validSpec(1), documentRuleSet: null });
    const bundle = publishRefs(w, refs);
    expect(bundle.itemRefs.map((ref) => ref.kind)).toEqual(['MAPPING', 'PROFILE']);
  });

  it.each([
    ['HA', TEST_FIXTURE_HA_1],
    ['PO', TEST_FIXTURE_PO_1],
  ])('%s 는 규칙 묶음을 게시할 수 없다 (ROLE_NOT_PERMITTED, 저장소 변화 없음)', (_role, actor) => {
    const w = bundleWorld();
    const refs = approveSpec(w, validSpec(1));
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => publishRefs(w, refs, actor)).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});

// ───────────────────────── 항목 상태 전제 (DD-17) ─────────────────────────

/** 서비스 경로(없는 경로는 저장소 원시 동작)로 항목을 state 에 데려간다. 승인자 기록이 있는 상태는 서비스로 만든다. */
function itemIn(w: World, kind: ItemKind, state: LifecycleState, n = 1): ItemVersionRef {
  const ref = createDraft(w.deps, TEST_FIXTURE_RV_AUTHOR, kind, baseContent(kind, n)).ref;
  if (state === 'DRAFT') return ref;
  submitForReview(w.deps, TEST_FIXTURE_RV_AUTHOR, ref);
  if (state === 'REVIEW_REQUESTED') return ref;
  if (state === 'REJECTED') {
    reject(w.deps, TEST_FIXTURE_RV_APPROVER, ref, 'TEST_FIXTURE 반려');
    return ref;
  }
  approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref);
  if (state === 'APPROVED') return ref;
  if (state === 'UNDER_REREVIEW') {
    forceState(w.repo, ref, 'UNDER_REREVIEW');
    return ref;
  }
  markPublished(w.deps, TEST_FIXTURE_RV_APPROVER, ref);
  if (state === 'SUSPENDED') suspendItem(w.deps, TEST_FIXTURE_RV_APPROVER, ref, 'TEST_FIXTURE 중지');
  if (state === 'SUPERSEDED') markSuperseded(w.deps, TEST_FIXTURE_RV_APPROVER, ref);
  if (state === 'EXPIRED') markExpired(w.deps, TEST_FIXTURE_RV_APPROVER, ref);
  return ref;
}

const ALL_STATES: readonly LifecycleState[] = ['DRAFT', 'REVIEW_REQUESTED', 'APPROVED', 'PUBLISHED', 'REJECTED', 'UNDER_REREVIEW', 'SUSPENDED', 'SUPERSEDED', 'EXPIRED'];

describe('항목 상태 전제: 묶음에는 APPROVED(게시와 함께 PUBLISHED 가 된다)와 이미 PUBLISHED 인 항목만 담을 수 있다 (DD-17)', () => {
  for (const kind of KINDS) {
    it.each(ALL_STATES)(`${kind} 항목이 %s 이면 APPROVED·PUBLISHED 만 게시된다`, (state) => {
      const w = bundleWorld();
      const ref = itemIn(w, kind, state);
      const request = requestOfKind(kind, ref);
      const before = snapshotOf(w.repo);

      if (state === 'APPROVED' || state === 'PUBLISHED') {
        const bundle = publishRefs(w, request);
        expect(bundle.itemRefs).toEqual([ref]);
        expect(w.repo.getItemState(ref)?.state).toBe('PUBLISHED');
        return;
      }
      const error = catchDomainError(() => publishRefs(w, request));
      expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
      expect(error.defects).toContainEqual({ code: 'ITEM_STATE_NOT_PUBLISHABLE', path: `${slotOf(kind)}.state` });
      expect(snapshotOf(w.repo)).toEqual(before);
      expect(w.repo.getItemState(ref)?.state).toBe(state);
    });
  }
});

describe('상태 기록이 없는 항목 버전', () => {
  it('내용만 있고 상태 기록이 없는 참조는 해석되지 않는다 (REF_UNRESOLVABLE, 저장소 변화 없음)', () => {
    const w = bundleWorld();
    const record = profileRecord({ id: 'TEST_FIXTURE_PROFILE_STATELESS' });
    w.repo.putItemVersion(record); // 서비스를 거치지 않은 원시 쓰기: 상태 기록(최초 DRAFT 이력)이 없다
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => publishRefs(w, requestOfKind('PROFILE', record.ref)));
    expect(error.defects).toEqual([{ code: 'REF_UNRESOLVABLE', path: 'bundle.profiles[0]' }]);
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});

// ───────────────────────── 유효 기간 전제 ─────────────────────────

describe('유효 기간 전제 [문서에 없음]: 형식이 맞고 게시일에 이미 끝난 항목이 아니어야 한다', () => {
  const REJECTED_VALIDITY: Array<[string, unknown]> = [
    ['게시일 전날에 끝남', { from: '2026-01-01', to: '2026-10-15' }],
    ['한참 전에 끝남', { from: '2025-01-01', to: '2025-12-31' }],
    ['시작일이 날짜 형식이 아님', { from: 'TEST_FIXTURE_NOT_A_DATE', to: '2026-12-31' }],
    ['종료일이 달력에 없는 날짜', { from: '2026-01-01', to: '2026-02-30' }],
    ['시작일이 종료일보다 늦음', { from: '2026-12-31', to: '2026-01-01' }],
    ['날짜가 문자열이 아님', { from: 20260101, to: 20261231 }],
    ['유효 기간이 null', null],
  ];

  for (const kind of KINDS) {
    it.each(REJECTED_VALIDITY)(`${kind}: %s → OUTSIDE_VALIDITY`, (_name, validity) => {
      const w = bundleWorld();
      const ref = createAndApprove(w, kind, setAt(baseContent(kind, 1), ['validity'], validity));
      const before = snapshotOf(w.repo);
      const error = catchDomainError(() => publishRefs(w, requestOfKind(kind, ref)));
      expect(error.defects).toContainEqual({ code: 'OUTSIDE_VALIDITY', path: `${slotOf(kind)}.validity` });
      expect(snapshotOf(w.repo)).toEqual(before);
    });
  }

  it('유효 기간 필드가 아예 없어도 OUTSIDE_VALIDITY', () => {
    const w = bundleWorld();
    const ref = createAndApprove(w, 'PROFILE', unsetAt(baseContent('PROFILE', 1), ['validity']));
    const error = catchDomainError(() => publishRefs(w, requestOfKind('PROFILE', ref)));
    expect(error.defects).toContainEqual({ code: 'OUTSIDE_VALIDITY', path: 'bundle.profiles[0].validity' });
  });

  it.each([
    ['종료일이 게시일 당일', { from: '2026-01-01', to: '2026-10-16' }],
    ['시작일이 게시일 이후(미래 시행)', { from: '2026-10-17', to: '2027-12-31' }],
    ['시작일과 종료일이 같은 하루', { from: '2026-10-16', to: '2026-10-16' }],
  ])('%s 는 게시된다 (미래 시행 항목을 미리 게시할 수 있다)', (_name, validity) => {
    const w = bundleWorld();
    const ref = createAndApprove(w, 'PROFILE', setAt(baseContent('PROFILE', 1), ['validity'], validity));
    expect(() => publishRefs(w, requestOfKind('PROFILE', ref))).not.toThrow();
  });
});

function createAndApprove(w: World, kind: ItemKind, content: unknown): ItemVersionRef {
  const ref = createDraft(w.deps, TEST_FIXTURE_RV_AUTHOR, kind, content as never).ref;
  submitForReview(w.deps, TEST_FIXTURE_RV_AUTHOR, ref);
  approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref);
  return ref;
}

// ───────────────────────── 참조-내용 일치 ─────────────────────────

describe('해석된 항목의 id·버전은 참조와 같아야 한다 [검증기가 보지 않는 전제]', () => {
  it.each(KINDS)('%s: 저장소가 참조와 다른 내용을 돌려주면 ITEM_REF_MISMATCH (저장소 변화 없음)', (kind) => {
    const w = bundleWorld();
    const ref = createAndApprove(w, kind, baseContent(kind, 1));
    const lying = new Proxy(w.repo, {
      get(target, property) {
        if (property === 'getItemVersion') {
          return (requested: ItemVersionRef) => {
            const record = target.getItemVersion(requested);
            return record === null ? null : { ...record, content: { ...record.content, version: 'TEST_FIXTURE_OTHER_VERSION' } };
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const before = snapshotOf(w.repo);

    const error = catchDomainError(() => publishRuleBundle({ ...w.deps, repo: lying }, TEST_FIXTURE_RV_PUBLISHER, requestOfKind(kind, ref)));

    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(error.defects).toContainEqual({ code: 'ITEM_REF_MISMATCH', path: slotOf(kind) });
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});

// ───────────────────────── 매핑 지문 ─────────────────────────

describe('매핑의 고정 지문은 그 치료의 현재 치료 버전 지문과 같아야 한다 [검증기가 보지 않는 전제]', () => {
  it('재검토 전환이 빠져 APPROVED 로 남은 낡은 지문은 FINGERPRINT_STALE 이고, 재검토와 재승인 뒤에는 게시된다', () => {
    const w = bundleWorld(); // 치료 버전 TV_1 이 현재 카탈로그에 있다
    const refs = approveSpec(w, validSpec(1));
    const changed = makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', treatmentCode: 'TEST_FIXTURE_TC_CHANGED' });
    adoptTreatmentVersion(w.repo, changed); // 저장소 원시 동작: 재검토 전환을 부르지 않았다
    expect(w.repo.getItemState(refs.mappings[0]!)?.state).toBe('APPROVED');
    const before = snapshotOf(w.repo);

    const error = catchDomainError(() => publishRefs(w, refs));

    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(error.defects).toEqual([{ code: 'FINGERPRINT_STALE', path: 'bundle.mappings[0].approvedFingerprint' }]);
    expect(snapshotOf(w.repo)).toEqual(before);

    // 교정: 재검토 전환 → 다른 승인자의 재승인(새 지문 고정) → 게시.
    triggerReReview(w.deps, TEST_FIXTURE_HA_1, changed);
    approve(w.deps, TEST_FIXTURE_RV_APPROVER_2, refs.mappings[0]!);
    expect(() => publishRefs(w, refs)).not.toThrow();
  });

  it('치료 버전이 하나도 없는 치료의 매핑은 TREATMENT_VERSION_ABSENT 이고 지문 불일치는 따로 보고하지 않는다', () => {
    const w = bundleWorld();
    const ref = createDraft(w.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', baseContent('MAPPING', 1, 'TEST_FIXTURE_TREATMENT_9')).ref;
    forceState(w.repo, ref, 'APPROVED'); // 서비스는 지문을 고정할 치료 버전 없이 승인하지 않는다 (M3.B)
    const before = snapshotOf(w.repo);

    const error = catchDomainError(() => publishRefs(w, requestOfKind('MAPPING', ref)));

    expect(error.defects).toContainEqual({ code: 'TREATMENT_VERSION_ABSENT', path: 'bundle.mappings[0].treatmentId' });
    expect(error.defects.map((defect) => defect.code)).not.toContain('FINGERPRINT_STALE');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('고정 지문이 현재 치료 버전과 같으면 아무 결함도 없다 (승인 때 현재 카탈로그의 버전을 고정했다)', () => {
    const w = bundleWorld();
    const refs = approveSpec(w, validSpec(1));
    expect(() => publishRefs(w, refs)).not.toThrow();
  });
});

// ───────────────────────── 거절 표 (AC-007f, AC-011i) ─────────────────────────

const GROUP_A = 'TEST_GROUP_BENEFIT';
const GROUP_B = 'TEST_GROUP_NON_BENEFIT';
const POOL = { poolKey: 'TEST_POOL_1', limit: { kind: 'ANNUAL', amount: 500_000, limitBasis: 'PAYOUT' } };

const onProfile = (mutate: (profile: ProfileContent) => unknown) => (spec: BundleSpec): BundleSpec => ({ ...spec, profiles: [mutate(spec.profiles[0]!) as ProfileContent] });
const onMapping = (mutate: (mapping: BundleSpec['mappings'][number]) => unknown) => (spec: BundleSpec): BundleSpec => ({ ...spec, mappings: [mutate(spec.mappings[0]!) as BundleSpec['mappings'][number]] });
const onRuleSet = (mutate: (ruleSet: NonNullable<BundleSpec['documentRuleSet']>) => unknown) => (spec: BundleSpec): BundleSpec => ({
  ...spec,
  documentRuleSet: mutate(spec.documentRuleSet!) as NonNullable<BundleSpec['documentRuleSet']>,
});

interface RejectRow {
  name: string;
  defect: Defect;
  spec?: (spec: BundleSpec) => BundleSpec;
  request?: (refs: BundleRefs) => unknown;
}

/**
 * 거절 한 건의 공통 확인: 이전 게시 묶음이 있는 세계에서 결함 있는 요청을 게시한다.
 * 유형 있는 오류에 경로가 담기고, 저장소 전후 비교가 같고(가용성 기록 포함), 이전 묶음과 그 항목이 그대로이며,
 * 결함을 고친 묶음은 그다음에 게시된다 (거절이 id 생성기를 소비하지 않으므로 다음 묶음 id 가 이어진다).
 */
function expectRejectedThenCorrected(row: RejectRow): void {
  const w = bundleWorld();
  const previous = publishedBundleOf(w, 2);
  const previousEvents = w.repo.listBundleStatusEvents(previous.bundle.id);
  const refs = approveSpec(w, row.spec ? row.spec(validSpec(1)) : validSpec(1));
  const request = row.request ? row.request(refs) : refs;
  const before = snapshotOf(w.repo);

  const error = catchDomainError(() => publishRefs(w, request));

  expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
  expect(error.defects).toContainEqual(row.defect);
  expect(snapshotOf(w.repo)).toEqual(before); // 저장소 전후 비교가 같다
  expect(w.repo.listRuleBundleVersions()).toEqual([previous.bundle]);
  expect(w.repo.listBundleStatusEvents('TEST_FIXTURE_BUNDLE_2')).toEqual([]); // 가용성 기록이 쓰이지 않았다
  expect(w.repo.listBundleStatusEvents(previous.bundle.id)).toEqual(previousEvents); // 이전 묶음 가용성 그대로
  expect(w.repo.getBundleStatus(previous.bundle.id)).toBe('ACTIVE');
  expect(w.repo.getItemState(previous.refs.profiles[0]!)?.state).toBe('PUBLISHED'); // 이전 묶음의 항목도 그대로

  const corrected = publishRefs(w, approveSpec(w, validSpec(3)));
  expect(corrected.id).toBe('TEST_FIXTURE_BUNDLE_2');
  expect(w.repo.getBundleStatus(corrected.id)).toBe('ACTIVE');
  expect(w.repo.listRuleBundleVersions()).toHaveLength(2);
}

describe('AC-007f 서류 규칙 묶음 게시: 구조 결함은 엔진 결함 경로와 함께 거절되고 아무것도 저장되지 않는다', () => {
  const ok = { documentCode: 'RECEIPT', when: {}, reason: 'TEST_FIXTURE 시험 사유', priority: 1 };
  const D = 'bundle.documentRuleSet';
  const withRules = (rules: unknown[]) => onRuleSet((ruleSet) => setAt(ruleSet, ['rules'], rules));
  const rows: RejectRow[] = [
    { name: '공백뿐인 reason', defect: { code: 'REASON_INVALID', path: `${D}.rules[1].reason` }, spec: withRules([ok, { ...ok, reason: ' \t\n　' }]) },
    { name: '빈 reason', defect: { code: 'REASON_INVALID', path: `${D}.rules[0].reason` }, spec: withRules([{ ...ok, reason: '' }]) },
    { name: '닫힌 10종 밖의 문서 코드', defect: { code: 'DOCUMENT_CODE_INVALID', path: `${D}.rules[0].documentCode` }, spec: withRules([{ ...ok, documentCode: 'XRAY_REPORT' }]) },
    { name: '음수 priority', defect: { code: 'PRIORITY_INVALID', path: `${D}.rules[3].priority` }, spec: withRules([ok, ok, ok, { ...ok, priority: -1 }]) },
    { name: '안전 정수를 넘는 priority', defect: { code: 'PRIORITY_INVALID', path: `${D}.rules[0].priority` }, spec: withRules([{ ...ok, priority: Number.MAX_SAFE_INTEGER + 1 }]) },
    { name: 'when 의 알 수 없는 키', defect: { code: 'WHEN_UNKNOWN_KEY', path: `${D}.rules[0].when.region` }, spec: withRules([{ ...ok, when: { region: 'KR' } }]) },
    { name: 'true 가 아닌 imaging 플래그', defect: { code: 'WHEN_VALUE_INVALID', path: `${D}.rules[3].when.imaging` }, spec: withRules([ok, ok, ok, { ...ok, when: { imaging: false } }]) },
    { name: '객체가 아닌 when', defect: { code: 'WHEN_NOT_OBJECT', path: `${D}.rules[0].when` }, spec: withRules([{ ...ok, when: null }]) },
    { name: '객체가 아닌 규칙 항목', defect: { code: 'RULE_ENTRY_INVALID', path: `${D}.rules[1]` }, spec: withRules([ok, null]) },
    { name: '배열이 아닌 rules', defect: { code: 'RULES_NOT_ARRAY', path: `${D}.rules` }, spec: withRules(null as never) },
  ];

  it.each(rows)('$name → $defect.code @ $defect.path, 저장소 전후 비교가 같고 이전 묶음이 남으며 고친 묶음은 게시된다', (row) => {
    expectRejectedThenCorrected(row);
  });

  it('규칙이 하나도 없는 rules: [] 는 거절 사유가 아니다', () => {
    const w = bundleWorld();
    const refs = approveSpec(w, onRuleSet((ruleSet) => setAt(ruleSet, ['rules'], []))(validSpec(1)));
    expect(() => publishRefs(w, refs)).not.toThrow();
  });

  it('상해 전용·질병 전용 줄이 여럿이어도 거절하지 않는다 (전용 줄 수는 거절 사유가 아니다)', () => {
    const only = (documentCode: string, cause: string) => ({ ...ok, documentCode, when: { cause } });
    const rules = [only('DIAGNOSIS_CERT', 'INJURY'), only('INITIAL_EXAM_RECORD', 'INJURY'), only('MEDICAL_OPINION', 'INJURY'), only('IMAGING_READING', 'ILLNESS'), only('BIOPSY_RESULT', 'ILLNESS')];
    const w = bundleWorld();
    expect(() => publishRefs(w, approveSpec(w, withRules(rules)(validSpec(1))))).not.toThrow();
  });

  it('유효한 reason 의 원문은 저장에서 다듬지 않는다', () => {
    const w = bundleWorld();
    const reason = '  앞뒤 공백 사유  ';
    const refs = approveSpec(w, withRules([{ ...ok, reason }])(validSpec(1)));
    publishRefs(w, refs);
    const stored = w.repo.getItemVersion(refs.documentRuleSet!);
    expect((stored?.content as { rules: Array<{ reason: string }> }).rules[0]?.reason).toBe(reason);
  });
});

describe('AC-011i 규칙 묶음 게시: 매핑 필드 규칙', () => {
  const M = 'bundle.mappings[0]';
  const excluded = <T extends object>(mapping: T): T => setAt(mapping, ['decision'], 'EXCLUDED');
  const rows: RejectRow[] = [
    { name: 'decision 이 COVERED·EXCLUDED 밖의 값', defect: { code: 'DECISION_INVALID', path: `${M}.decision` }, spec: onMapping((m) => setAt(m, ['decision'], 'MAYBE')) },
    { name: 'COVERED 에 groupKey 가 없음', defect: { code: 'GROUP_KEY_REQUIRED', path: `${M}.groupKey` }, spec: onMapping((m) => unsetAt(m, ['groupKey'])) },
    { name: 'COVERED 의 groupKey 가 빈 문자열', defect: { code: 'GROUP_KEY_REQUIRED', path: `${M}.groupKey` }, spec: onMapping((m) => setAt(m, ['groupKey'], '')) },
    { name: 'COVERED 에 exclusionReason 이 있음', defect: { code: 'EXCLUSION_REASON_FORBIDDEN', path: `${M}.exclusionReason` }, spec: onMapping((m) => setAt(m, ['exclusionReason'], 'TEST_FIXTURE 있으면 안 된다')) },
    { name: 'EXCLUDED 에 groupKey 가 있음', defect: { code: 'GROUP_KEY_FORBIDDEN', path: `${M}.groupKey` }, spec: onMapping((m) => setAt(excluded(m), ['exclusionReason'], 'TEST_FIXTURE 사유')) },
    { name: 'EXCLUDED 에 exclusionReason 이 없음', defect: { code: 'EXCLUSION_REASON_REQUIRED', path: `${M}.exclusionReason` }, spec: onMapping((m) => unsetAt(excluded(m), ['groupKey'])) },
    { name: 'EXCLUDED 의 exclusionReason 이 빈 문자열', defect: { code: 'EXCLUSION_REASON_REQUIRED', path: `${M}.exclusionReason` }, spec: onMapping((m) => setAt(unsetAt(excluded(m), ['groupKey']), ['exclusionReason'], '')) },
    { name: 'COVERED 의 약관 출처가 비어 있음', defect: { code: 'POLICY_SOURCES_MISSING', path: `${M}.policySources` }, spec: onMapping((m) => setAt(m, ['policySources'], [])) },
    { name: 'EXCLUDED 의 약관 출처가 비어 있음', defect: { code: 'POLICY_SOURCES_MISSING', path: `${M}.policySources` }, spec: onMapping((m) => setAt(setAt(unsetAt(excluded(m), ['groupKey']), ['exclusionReason'], 'TEST_FIXTURE 사유'), ['policySources'], [])) },
  ];

  it.each(rows)('$name → $defect.code @ $defect.path, 저장소 전후 비교가 같고 고친 묶음은 게시된다', (row) => {
    expectRejectedThenCorrected(row);
  });

  it('올바른 EXCLUDED 매핑(groupKey 없음, 사유 있음)은 게시된다 (확인된 제외도 같은 요건)', () => {
    const w = bundleWorld();
    const spec = onMapping((m) => setAt(unsetAt(setAt(m, ['decision'], 'EXCLUDED'), ['groupKey']), ['exclusionReason'], 'TEST_FIXTURE 확인된 제외 사유'))(validSpec(1));
    expect(() => publishRefs(w, approveSpec(w, spec))).not.toThrow();
  });
});

describe('AC-011i 규칙 묶음 게시: 프로필 구조', () => {
  const P = 'bundle.profiles[0]';
  const group = (key: string) => ({ groupKey: key, deduction: { kind: 'FIXED', fixed: 1_000 }, limit: { kind: 'PER_VISIT_PAYOUT', amount: 100_000, limitBasis: 'PAYOUT' } });
  const rows: RejectRow[] = [
    { name: '빈 프로필', defect: { code: 'EMPTY_PROFILE', path: `${P}.groups` }, spec: onProfile((p) => setAt(setAt(p, ['groups'], []), ['groupOrder'], [])) },
    { name: '빈 groupKey', defect: { code: 'EMPTY_GROUP_KEY', path: `${P}.groups[1].groupKey` }, spec: onProfile((p) => setAt(setAt(p, ['groups'], [group(GROUP_A), group('')]), ['groupOrder'], [GROUP_A, ''])) },
    { name: '중복 groupKey', defect: { code: 'DUPLICATE_GROUP_KEY', path: `${P}.groups[1].groupKey` }, spec: onProfile((p) => setAt(setAt(p, ['groups'], [group(GROUP_A), group(GROUP_A)]), ['groupOrder'], [GROUP_A])) },
    { name: '빈 poolKey', defect: { code: 'EMPTY_POOL_KEY', path: `${P}.sharedLimitPools[0].poolKey` }, spec: onProfile((p) => setAt(p, ['sharedLimitPools'], [{ ...POOL, poolKey: '' }])) },
    { name: '중복 poolKey', defect: { code: 'DUPLICATE_POOL_KEY', path: `${P}.sharedLimitPools[1].poolKey` }, spec: onProfile((p) => setAt(p, ['sharedLimitPools'], [POOL, { ...POOL }])) },
    { name: '없는 풀을 가리키는 sharedLimitPoolKey', defect: { code: 'UNKNOWN_POOL_REFERENCE', path: `${P}.groups[0].sharedLimitPoolKey` }, spec: onProfile((p) => setAt(p, ['groups', 0, 'sharedLimitPoolKey'], 'TEST_FIXTURE_NO_SUCH_POOL')) },
    { name: 'groupOrder 에서 빠진 키', defect: { code: 'GROUP_ORDER_MISSING_KEY', path: `${P}.groupOrder` }, spec: onProfile((p) => setAt(p, ['groupOrder'], [GROUP_A])) },
    { name: 'groupOrder 의 중복 키', defect: { code: 'GROUP_ORDER_DUPLICATE_KEY', path: `${P}.groupOrder[2]` }, spec: onProfile((p) => setAt(p, ['groupOrder'], [GROUP_A, GROUP_B, GROUP_A])) },
    { name: 'groupOrder 의 없는 키', defect: { code: 'GROUP_ORDER_UNKNOWN_KEY', path: `${P}.groupOrder[2]` }, spec: onProfile((p) => setAt(p, ['groupOrder'], [GROUP_A, GROUP_B, 'TEST_FIXTURE_NO_SUCH_GROUP'])) },
    { name: '풀의 금액이 범위 밖 (그룹 값과 같이 거절)', defect: { code: 'VALUE_INVALID', path: `${P}.sharedLimitPools[0].limit.amount` }, spec: onProfile((p) => setAt(p, ['sharedLimitPools'], [{ ...POOL, limit: { ...POOL.limit, amount: -1 } }])) },
  ];

  it.each(rows)('$name → $defect.code @ $defect.path, 저장소 전후 비교가 같고 고친 묶음은 게시된다', (row) => {
    expectRejectedThenCorrected(row);
  });

  it('멤버가 없는 풀은 거절하지 않는다', () => {
    const w = bundleWorld();
    const spec = onProfile((p) => setAt(p, ['sharedLimitPools'], [POOL]))(validSpec(1));
    expect(() => publishRefs(w, approveSpec(w, spec))).not.toThrow();
  });

  it('공식 지원 밖의 한도 종류와 limitBasis 는 게시 거절 사유가 아니다 (계산 때의 보류 사유)', () => {
    const w = bundleWorld();
    const spec = onProfile((p) => setAt(setAt(p, ['groups', 0, 'limit'], { kind: 'PER_VISIT_PAYOUT', amount: 100_000, limitBasis: 'COVERED_COST' }), ['groups', 1, 'limit'], { kind: 'UNLIMITED_DECLARED', policyClauseRef: '' }))(validSpec(1));
    expect(() => publishRefs(w, approveSpec(w, spec))).not.toThrow();
  });
});

describe('AC-011i 규칙 묶음 게시: 묶음 교차 검사', () => {
  const second = (n: number): BundleSpec => validSpec(n);
  const rows: RejectRow[] = [
    {
      name: '프로필에 없는 groupKey 를 가진 COVERED 매핑',
      defect: { code: 'MAPPING_GROUP_NOT_IN_PROFILE', path: 'bundle.mappings[0].groupKey' },
      spec: onMapping((m) => setAt(m, ['groupKey'], 'TEST_FIXTURE_NO_SUCH_GROUP')),
    },
    {
      name: '같은 (세대, 보험사 형태) 칸에 프로필 둘',
      defect: { code: 'CELL_PROFILE_DUPLICATE', path: 'bundle.profiles[1]' },
      spec: (spec) => ({ ...spec, profiles: [spec.profiles[0]!, second(5).profiles[0]!] }),
    },
    {
      name: '같은 매핑 id 의 버전 둘',
      defect: { code: 'MAPPING_ID_DUPLICATE', path: 'bundle.mappings[1].id' },
      spec: (spec) => ({ ...spec, mappings: [spec.mappings[0]!, setAt(spec.mappings[0]!, ['version'], 'v2')] }),
    },
  ];

  it.each(rows)('$name → $defect.code @ $defect.path, 저장소 전후 비교가 같고 고친 묶음은 게시된다', (row) => {
    expectRejectedThenCorrected(row);
  });

  it('같은 묶음에 프로필이 없는 칸을 scope 로 가진 매핑은 거절하지 않고 게시된다', () => {
    const w = bundleWorld();
    const spec = onMapping((m) => setAt(setAt(m, ['scope'], [{ generation: 'GEN1_AS', insurerType: 'MUTUAL_AID' }]), ['groupKey'], 'TEST_FIXTURE_NO_SUCH_GROUP'))(validSpec(1));
    expect(() => publishRefs(w, approveSpec(w, spec))).not.toThrow();
  });
});

describe('AC-011i 규칙 묶음 게시: 묶음 항목의 형식 (M3 · 미구현 하위 기준)', () => {
  const NOT_ARRAY_VALUES: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['객체', {}],
    ['문자열', 'TEST_FIXTURE'],
    ['숫자', 5],
    ['불리언', true],
  ];
  const BAD_ITEMS: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['숫자', 5],
    ['문자열', 'x'],
    ['불리언', false],
    ['배열', []],
  ];

  const rows: RejectRow[] = [
    ...NOT_ARRAY_VALUES.map(([name, value]): RejectRow => ({ name: `profiles = ${name}`, defect: { code: 'NOT_ARRAY', path: 'bundle.profiles' }, request: (refs) => ({ ...refs, profiles: value }) })),
    ...NOT_ARRAY_VALUES.map(([name, value]): RejectRow => ({ name: `mappings = ${name}`, defect: { code: 'NOT_ARRAY', path: 'bundle.mappings' }, request: (refs) => ({ ...refs, mappings: value }) })),
    ...BAD_ITEMS.map(([name, value]): RejectRow => ({ name: `profiles 항목 = ${name}`, defect: { code: 'NOT_OBJECT', path: 'bundle.profiles[1]' }, request: (refs) => ({ ...refs, profiles: [...refs.profiles, value] }) })),
    ...BAD_ITEMS.map(([name, value]): RejectRow => ({ name: `mappings 항목 = ${name}`, defect: { code: 'NOT_OBJECT', path: 'bundle.mappings[1]' }, request: (refs) => ({ ...refs, mappings: [...refs.mappings, value] }) })),
    { name: 'documentRuleSet 필드가 없음', defect: { code: 'VALUE_MISSING', path: 'bundle.documentRuleSet' }, request: (refs) => ({ profiles: refs.profiles, mappings: refs.mappings }) },
    { name: '저장소에 없는 참조', defect: { code: 'REF_UNRESOLVABLE', path: 'bundle.profiles[1]' }, request: (refs) => ({ ...refs, profiles: [...refs.profiles, { kind: 'PROFILE', id: 'TEST_FIXTURE_NO_SUCH', version: 'v1' }] }) },
    { name: '종류가 어긋난 참조', defect: { code: 'VALUE_INVALID', path: 'bundle.profiles[1].kind' }, request: (refs) => ({ ...refs, profiles: [...refs.profiles, { ...refs.mappings[0]! }] }) },
  ];

  it.each(rows)('$name → $defect.code @ $defect.path, 저장소 전후 비교가 같고 고친 묶음은 게시된다', (row) => {
    expectRejectedThenCorrected(row);
  });

  it('정상적인 빈 배열 [] 은 형식 결함이 아니다 (profiles = [] 와 mappings = [] 각각)', () => {
    const w = bundleWorld();
    const refs = approveSpec(w, validSpec(1));
    expect(() => publishRefs(w, { ...refs, profiles: [] })).not.toThrow();
    expect(() => publishRefs(w, { ...refs, mappings: [] })).not.toThrow();
  });

  it('요청 자체가 객체가 아니면(null·배열·문자열·숫자·undefined) NOT_OBJECT @ bundle 이고 저장소는 그대로다', () => {
    const w = bundleWorld();
    const before = snapshotOf(w.repo);
    for (const request of [null, undefined, [], 'x', 5]) {
      const error = catchDomainError(() => publishRefs(w, request));
      expect(error.defects).toEqual([{ code: 'NOT_OBJECT', path: 'bundle' }]);
    }
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});

// ───────────────────────── AC-011h 규칙 묶음 값 범위 ─────────────────────────

describe('AC-011h 규칙 묶음 게시: 범위 밖 프로필 값은 필드 경로와 함께 거절되고 아무것도 저장되지 않는다', () => {
  const BAD_WON: Array<[string, unknown]> = [
    ['음수', -1],
    ['소수', 1.5],
    ['NaN', Number.NaN],
    ['문자열', '1000'],
    ['MAX_AMOUNT_WON + 1', MAX_AMOUNT_WON + 1],
  ];
  const BAD_RATES: Array<[string, unknown]> = [
    ['0 미만', -1],
    ['10000 초과', 10_001],
    ['소수', 1.5],
    ['NaN', Number.NaN],
    ['문자열', '500'],
  ];

  type Target = [string, (profile: ProfileContent, value: unknown) => ProfileContent, string];
  const wonTargets: Target[] = [
    ['그룹 공제 fixed', (p, v) => setAt(p, ['groups', 0, 'deduction'], { kind: 'FIXED', fixed: v }), 'groups[0].deduction.fixed'],
    ['그룹 한도 amount', (p, v) => setAt(p, ['groups', 0, 'limit'], { kind: 'PER_VISIT_PAYOUT', amount: v, limitBasis: 'PAYOUT' }), 'groups[0].limit.amount'],
    ['그룹 한도 perUseAmount', (p, v) => setAt(p, ['groups', 0, 'limit'], { kind: 'COUNT', perUseAmount: v, limitBasis: 'PAYOUT' }), 'groups[0].limit.perUseAmount'],
    [
      '공유 한도 풀 amount',
      (p, v) => setAt(setAt(p, ['groups', 0, 'sharedLimitPoolKey'], POOL.poolKey), ['sharedLimitPools'], [{ poolKey: POOL.poolKey, limit: { kind: 'ANNUAL', amount: v, limitBasis: 'PAYOUT' } }]),
      'sharedLimitPools[0].limit.amount',
    ],
  ];
  const rateTargets: Target[] = [
    ['RATE_WITH_FIXED_FLOOR rate', (p, v) => setAt(p, ['groups', 0, 'deduction'], { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 1_000, rate: v, rounding: 'TRUNCATE' }), 'groups[0].deduction.rate'],
    ['CAPPED_RATE_WITH_FIXED_FLOOR rate', (p, v) => setAt(p, ['groups', 0, 'deduction'], { kind: 'CAPPED_RATE_WITH_FIXED_FLOOR', fixed: 1_000, rate: v, rounding: 'ROUND_HALF_UP' }), 'groups[0].deduction.rate'],
    ['SPLIT rateBenefit', (p, v) => setAt(p, ['groups', 0, 'deduction'], { kind: 'SPLIT_RATE_WITH_FIXED_FLOOR', fixed: 1_000, rateBenefit: v, rateNonBenefit: 100, rounding: 'TRUNCATE' }), 'groups[0].deduction.rateBenefit'],
    ['SPLIT rateNonBenefit', (p, v) => setAt(p, ['groups', 0, 'deduction'], { kind: 'SPLIT_RATE_WITH_FIXED_FLOOR', fixed: 1_000, rateBenefit: 100, rateNonBenefit: v, rounding: 'TRUNCATE' }), 'groups[0].deduction.rateNonBenefit'],
  ];

  for (const [targetName, make, relativePath] of [...wonTargets.map((t) => t), ...rateTargets]) {
    const values = rateTargets.some((t) => t[0] === targetName) ? BAD_RATES : BAD_WON;
    it.each(values)(`${targetName} 가 %s → VALUE_INVALID @ bundle.profiles[0].${relativePath}`, (_name, value) => {
      expectRejectedThenCorrected({
        name: targetName,
        defect: { code: 'VALUE_INVALID', path: `bundle.profiles[0].${relativePath}` },
        spec: onProfile((p) => make(p, value)),
      });
    });
  }

  it.each([
    ['0', 0],
    ['MAX_AMOUNT_WON', MAX_AMOUNT_WON],
  ])('금액 경계값 %s 는 공제·한도·풀 모두 게시된다', (_name, value) => {
    const w = bundleWorld();
    for (const [index, [, make]] of wonTargets.entries()) {
      const spec = onProfile((p) => make(p, value))(validSpec(10 + index));
      expect(() => publishRefs(w, approveSpec(w, spec))).not.toThrow();
    }
  });

  it.each([
    ['0', 0],
    ['10000', 10_000],
  ])('비율 경계값 %s 는 네 가지 비율 모두 게시된다', (_name, value) => {
    const w = bundleWorld();
    for (const [index, [, make]] of rateTargets.entries()) {
      const spec = onProfile((p) => make(p, value))(validSpec(20 + index));
      expect(() => publishRefs(w, approveSpec(w, spec))).not.toThrow();
    }
  });
});

// ───────────────────────── 묶음 내용 해시 ─────────────────────────

describe('묶음 내용 해시 (AC-011a: 같은 묶음의 내용 해시는 다시 계산해도 같다)', () => {
  /** 프로필 둘(서로 다른 칸)과 매핑 둘, 서류 규칙 묶음 하나. 요청 순서를 바꿔 시험한다. */
  function multiSpec(): BundleSpec {
    const a = validSpec(1);
    const b = validSpec(2);
    return { profiles: [a.profiles[0]!, setAt(b.profiles[0]!, ['generation'], 'GEN3_C3')], mappings: [a.mappings[0]!, b.mappings[0]!], documentRuleSet: a.documentRuleSet };
  }

  it('정의: 형식 표지와 (종류, id, 버전, 저장된 항목 내용의 정본 해시) 목록을 정렬해 canonicalDigest 한 값이다', () => {
    const w = bundleWorld();
    const { bundle } = publishedBundleOf(w);
    const items = bundle.itemRefs.map((ref) => ({ kind: ref.kind, id: ref.id, version: ref.version, contentDigest: canonicalDigest(w.repo.getItemVersion(ref)!.content) }));
    expect(bundle.contentHash).toBe(canonicalDigest({ format: 'bodam.rule-bundle.v1', items }));
  });

  it('저장된 묶음에서 다시 계산해도 같은 값이다 (함수를 두 번 불러도, 항목 상태가 바뀐 뒤에도)', () => {
    const w = bundleWorld();
    const { bundle, refs } = publishedBundleOf(w);
    expect(bundleContentHashOf(w.repo, bundle.itemRefs)).toBe(bundle.contentHash);
    expect(bundleContentHashOf(w.repo, bundle.itemRefs)).toBe(bundle.contentHash);
    suspendItem(w.deps, TEST_FIXTURE_RV_APPROVER, refs.profiles[0]!, 'TEST_FIXTURE 중지'); // 상태는 해시 입력이 아니다
    expect(bundleContentHashOf(w.repo, bundle.itemRefs)).toBe(bundle.contentHash);
    expect(computeBundleContentHash(bundle.itemRefs.map((ref) => ({ ref, contentDigest: canonicalDigest(w.repo.getItemVersion(ref)!.content) })))).toBe(bundle.contentHash);
  });

  it('요청의 항목 순서와 무관하다: 순서를 뒤집어 게시해도 해시와 항목 참조가 같다', () => {
    const forward = bundleWorld();
    const backward = bundleWorld();
    const refsA = approveSpec(forward, multiSpec());
    const refsB = approveSpec(backward, multiSpec());

    const a = publishRefs(forward, refsA);
    const b = publishRefs(backward, { profiles: [...refsB.profiles].reverse(), mappings: [...refsB.mappings].reverse(), documentRuleSet: refsB.documentRuleSet });

    expect(b.contentHash).toBe(a.contentHash);
    expect(b.itemRefs).toEqual(a.itemRefs);
    expect(a.itemRefs).toHaveLength(5);
  });

  it('묶음 id·게시 시각·게시자와 무관하다: 같은 항목을 다른 때 다른 주체가 게시해도 같다', () => {
    const w = bundleWorld();
    const refs = approveSpec(w, validSpec(1));
    const first = publishRefs(w, refs);
    w.clock.set('2026-11-01T00:00:00.000Z');
    const second = publishRefs(w, refs, TEST_FIXTURE_RV_APPROVER_2);
    expect(second.id).not.toBe(first.id);
    expect(second.contentHash).toBe(first.contentHash);
  });

  it('항목 집합이 다르면 해시가 다르다 (항목 하나를 뺀 묶음)', () => {
    const w = bundleWorld();
    const refs = approveSpec(w, validSpec(1));
    const full = publishRefs(w, refs);
    const withoutMapping = publishRefs(w, { ...refs, mappings: [] });
    const withoutRules = publishRefs(w, { ...refs, documentRuleSet: null });
    expect(new Set([full.contentHash, withoutMapping.contentHash, withoutRules.contentHash]).size).toBe(3);
  });

  it('항목의 다음 버전을 담으면 해시가 다르다 (버전 라벨이 해시 입력이다)', () => {
    const w = bundleWorld();
    const refs = approveSpec(w, validSpec(1));
    const first = publishRefs(w, refs);
    const next = createNextDraft(w.deps, TEST_FIXTURE_RV_AUTHOR, refs.profiles[0]!, 'v2').ref;
    submitForReview(w.deps, TEST_FIXTURE_RV_AUTHOR, next);
    approve(w.deps, TEST_FIXTURE_RV_APPROVER, next);
    const second = publishRefs(w, { ...refs, profiles: [next] });
    expect(second.contentHash).not.toBe(first.contentHash);
  });

  it('bundleContentHashOf: 저장소에 없는 항목 참조는 NOT_FOUND 다', () => {
    const w = bundleWorld();
    const error = catchDomainError(() => bundleContentHashOf(w.repo, [{ kind: 'PROFILE', id: 'TEST_FIXTURE_NO_SUCH', version: 'v1' }]));
    expect(error.code).toBe('NOT_FOUND');
  });

  it('computeBundleContentHash 는 입력 순서와 객체 키 순서에 달라지지 않고 항목이 다르면 달라진다', () => {
    const entries = [
      { ref: { kind: 'PROFILE', id: 'TEST_FIXTURE_P', version: 'v1' } as const, contentDigest: 'TEST_FIXTURE_D1' },
      { ref: { kind: 'MAPPING', id: 'TEST_FIXTURE_M', version: 'v1' } as const, contentDigest: 'TEST_FIXTURE_D2' },
      { ref: { kind: 'MAPPING', id: 'TEST_FIXTURE_M', version: 'v10' } as const, contentDigest: 'TEST_FIXTURE_D3' },
    ];
    const hash = computeBundleContentHash(entries);
    expect(computeBundleContentHash([...entries].reverse())).toBe(hash);
    expect(computeBundleContentHash(entries.map(({ ref, contentDigest }) => ({ contentDigest, ref: { version: ref.version, id: ref.id, kind: ref.kind } })))).toBe(hash);
    expect(computeBundleContentHash(entries.slice(0, 2))).not.toBe(hash);
    expect(computeBundleContentHash([{ ...entries[0]!, contentDigest: 'TEST_FIXTURE_OTHER' }, entries[1]!, entries[2]!])).not.toBe(hash);
  });
});
