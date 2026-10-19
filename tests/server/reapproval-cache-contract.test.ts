import { describe, expect, it } from 'vitest';
import { suspendRuleBundle } from '../../src/server/bundle-status';
import { bundleContentHashOf } from '../../src/server/bundle-publish';
import type { ItemStateRecord, ItemVersionRef } from '../../src/server/domain/items';
import { loadReadinessSnapshot } from '../../src/server/readiness';
import type { ClinicReadiness, MappingRow } from '../../src/server/readiness';
import { assignRuleScope } from '../../src/server/rule-scope';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_PO_1 } from '../fixtures/server/actors.fixture';
import { READY_CELL, clinicReport } from '../fixtures/server/base-fee.fixture';
import { TEST_FIXTURE_RV_SUSPENDER } from '../fixtures/server/governance.fixture';
import {
  A1,
  A2,
  AUTHOR,
  REAPPROVAL_AT,
  REAPPROVAL_TARGETS,
  cacheBundle,
  composeFromCache,
  estimateWithBundle,
  stepFive,
  stepOne,
  stepThree,
  stepTwo,
  verdictOf,
} from '../fixtures/server/reapproval.fixture';
import type { Scenario } from '../fixtures/server/reapproval.fixture';
import { sameCell } from '../fixtures/server/readiness.fixture';

// 재승인 정보와 캐시 계약 회귀 시험 (M3 외부 검토 보완 ②, design.md DD-14 "항목 생명주기 상태와 캐시 계약", DD-15, DD-16, DD-17).
// 계약:
//   캐시해도 되는 것(바뀌지 않는다)  = 항목 버전의 내용(content, contentHash, 머리 정보)과 규칙 묶음 버전(id, itemRefs, contentHash)
//   요청마다 새로 읽어 함께 합성한다 = state, approver, approvedFingerprint (그리고 묶음 가용성)
// 재승인(UNDER_REREVIEW → APPROVED)은 새 승인자를 쓰고 새 지문을 고정하지만, 묶음 X 의 id·내용 해시와 항목 내용은 바뀌지 않는다.
// 그러므로 "내용만 캐시하고 상태·승인자·지문은 함께 새로 읽는다"가 맞고, 셋 중 하나라도 낡은 값을 쓰면 판정이 달라진다.
// 모든 단계는 도메인 서비스로 지난다(저장소에 승인 상태나 지문을 직접 넣지 않는다). 시험 자료는 전부 TEST_FIXTURE 다.
// 기존 AC(AC-011a, AC-011m~p 의 M3 부분, AC-009a)에 추가 근거를 주며 새 AC 를 닫지 않는다. HTTP 캐시·경로는 M4 의 일이다.

const trail = (state: ItemStateRecord): Array<[string, string | null, string | null]> =>
  state.history.map((entry) => [entry.to, entry.approver?.approverId ?? null, entry.approvedFingerprint]);

const mappingRow = (report: ClinicReadiness, lineId: string): MappingRow => {
  const found = report.mappings.find((row) => row.treatmentId === lineId && sameCell(row.cell, READY_CELL));
  if (found === undefined) {
    throw new Error(`TEST_FIXTURE: ${lineId} 줄의 표 M 행이 없다`);
  }
  return found;
};

const mappingOf = (snapshot: { mappings: Array<{ id: string }> }, ref: ItemVersionRef) => {
  const found = snapshot.mappings.find((mapping) => mapping.id === ref.id);
  if (found === undefined) {
    throw new Error(`TEST_FIXTURE: 조립된 묶음에 매핑 ${ref.id} 이(가) 없다`);
  }
  return found as typeof found & { state: string; approver: { approverId: string; approvedAt: string } | null; approvedFingerprint: string };
};

/** 3단계까지 간 시나리오 (재승인 완료, 매핑은 APPROVED). F2 는 새 현재 버전의 지문. */
function reapproved(scenario: Scenario): string {
  const f2 = stepTwo(scenario);
  stepThree(scenario);
  return f2;
}

describe.each(REAPPROVAL_TARGETS)('재승인 정보와 캐시 계약: $name', (target) => {
  describe('시험 전제: 주체 셋과 지문 둘이 서로 다르다', () => {
    it('작성자·첫 승인자(A1)·재승인자(A2)는 모두 다른 주체이고 변경 전후 지문이 다르다', () => {
      expect(new Set([AUTHOR.id, A1.id, A2.id]).size).toBe(3);
      const s = stepOne(target);
      const f2 = stepTwo(s);
      expect(f2).not.toBe(s.f1);
    });
  });

  describe('캐시해도 되는 것은 바뀌지 않는 내용뿐이다 (1단계: 묶음 X 를 먼저 읽는다)', () => {
    it('항목 내용 기록에는 state·approver·approvedFingerprint 키가 없다 (프로필·매핑·서류 규칙 묶음 모두)', () => {
      const s = stepOne(target);
      expect(s.cache.records.map((record) => record.ref.kind).sort()).toContain('MAPPING');
      for (const record of s.cache.records) {
        for (const key of ['state', 'approver', 'approvedFingerprint']) {
          expect(Object.keys(record.content), `${record.ref.kind} ${key}`).not.toContain(key);
        }
      }
    });

    it('규칙 묶음 버전 기록의 키는 id·itemRefs·contentHash·publishedBy·publishedAt 뿐이다 (상태·승인자·지문·가용성이 없다)', () => {
      const s = stepOne(target);
      expect(Object.keys(s.cache.bundle).sort()).toEqual(['contentHash', 'id', 'itemRefs', 'publishedAt', 'publishedBy']);
    });

    it('1단계에 읽어 둔 낡은 상태 사본(음성 대조군)은 매핑이 PUBLISHED · 승인자 A1 · 지문 F1 이다', () => {
      const s = stepOne(target);
      const index = s.cache.bundle.itemRefs.findIndex((ref) => ref.id === s.ref.id);
      expect(s.staleStates[index]).toEqual({
        ref: s.ref,
        state: 'PUBLISHED',
        approver: { approverId: A1.id, approvedAt: '2026-10-16T09:00:00.000Z' },
        approvedFingerprint: s.f1,
      });
    });
  });

  describe('2단계: 보장 판단 필드가 바뀐 새 버전을 HA 가 게시한다 (매핑이 재검토로 전환)', () => {
    it('새로 읽은 상태는 UNDER_REREVIEW 이고 승인자와 고정 지문은 아직 A1 · F1 이다 (재승인이 바꾼다)', () => {
      const s = stepOne(target);
      stepTwo(s);
      expect(s.world.repo.readItemStates([s.ref])[0]).toEqual({
        ref: s.ref,
        state: 'UNDER_REREVIEW',
        approver: { approverId: A1.id, approvedAt: '2026-10-16T09:00:00.000Z' },
        approvedFingerprint: s.f1,
      });
    });

    it('묶음 X 의 id·contentHash·itemRefs 는 캐시해 둔 사본과 깊이 같고, 저장된 항목에서 다시 계산한 해시도 같다', () => {
      const s = stepOne(target);
      stepTwo(s);
      const stored = s.world.repo.getRuleBundleVersion(s.path.bundle.id)!;
      expect({ id: stored.id, contentHash: stored.contentHash, itemRefs: stored.itemRefs }).toEqual({
        id: s.cache.bundle.id,
        contentHash: s.cache.bundle.contentHash,
        itemRefs: s.cache.bundle.itemRefs,
      });
      expect(bundleContentHashOf(s.world.repo, stored.itemRefs)).toBe(s.cache.bundle.contentHash);
    });

    it('캐시해 둔 항목 내용은 새로 읽은 내용과 깊이 같다 (상태 전이는 내용을 바꾸지 않는다)', () => {
      const s = stepOne(target);
      stepTwo(s);
      for (const cached of s.cache.records) {
        expect(s.world.repo.getItemVersion(cached.ref), `${cached.ref.kind}/${cached.ref.id}`).toEqual(cached);
      }
    });

    it('새 상태로 조립한 엔진 입력과 준비 상태 보고가 같은 MAPPING_UNDER_REREVIEW 보류를 낸다', () => {
      const s = stepOne(target);
      stepTwo(s);
      const composed = composeFromCache(s.world.repo, s.cache);
      expect(mappingOf(composed, s.ref).state).toBe('UNDER_REREVIEW');
      expect(verdictOf(estimateWithBundle(s.world, composed), target.lineId)).toBe('MAPPING_UNDER_REREVIEW');
      expect(mappingRow(clinicReport(s.world), target.lineId)).toMatchObject({ status: 'NOT_READY', code: 'MAPPING_UNDER_REREVIEW' });
    });
  });

  describe('3단계: 다른 RV(A2)의 재승인은 승인자와 지문을 새로 쓰지만 묶음 X 와 내용은 바꾸지 않는다', () => {
    it('새로 읽은 상태: APPROVED · 승인자 A2 (A1 이 아니다) · 새 승인 시각', () => {
      const s = stepOne(target);
      reapproved(s);
      const state = s.world.repo.readItemStates([s.ref])[0]!;
      expect(state.state).toBe('APPROVED');
      expect(state.approver).toEqual({ approverId: A2.id, approvedAt: REAPPROVAL_AT });
      expect(state.approver?.approverId).not.toBe(A1.id);
    });

    it('고정 지문은 F1 에서 F2 로 바뀌고 F2 는 새 현재 버전의 지문이다', () => {
      const s = stepOne(target);
      const f2 = reapproved(s);
      const state = s.world.repo.readItemStates([s.ref])[0]!;
      expect(state.approvedFingerprint).toBe(f2);
      expect(state.approvedFingerprint).not.toBe(s.f1);
    });

    it('묶음 X 의 id·contentHash·itemRefs 는 재승인 뒤에도 캐시 사본과 같다 (승인자·지문은 묶음 해시의 입력이 아니다)', () => {
      const s = stepOne(target);
      reapproved(s);
      const stored = s.world.repo.getRuleBundleVersion(s.path.bundle.id)!;
      expect(stored).toEqual(s.cache.bundle);
      expect(bundleContentHashOf(s.world.repo, stored.itemRefs)).toBe(s.cache.bundle.contentHash);
    });

    it('캐시해 둔 항목 내용은 재승인 뒤에도 새로 읽은 내용과 깊이 같다 (승인자·지문은 내용이 아니다)', () => {
      const s = stepOne(target);
      reapproved(s);
      for (const cached of s.cache.records) {
        expect(s.world.repo.getItemVersion(cached.ref), `${cached.ref.kind}/${cached.ref.id}`).toEqual(cached);
      }
      const content = s.world.repo.getItemVersion(s.ref)!.content;
      expect(content).not.toHaveProperty('approver');
      expect(content).not.toHaveProperty('approvedFingerprint');
    });

    it('상태 이력은 A1 · F1 항목을 지우지 않고 재승인 항목(A2 · F2)을 더한다', () => {
      const s = stepOne(target);
      const f2 = reapproved(s);
      expect(trail(s.world.repo.getItemState(s.ref)!)).toEqual([
        ['DRAFT', null, null],
        ['REVIEW_REQUESTED', null, null],
        ['APPROVED', A1.id, s.f1],
        ['PUBLISHED', A1.id, s.f1],
        ['UNDER_REREVIEW', A1.id, s.f1],
        ['APPROVED', A2.id, f2],
      ]);
    });

    it('감사 기록에 승인이 둘(A1, A2) 남고 재검토 전환은 그 사이에 있다', () => {
      const s = stepOne(target);
      reapproved(s);
      const target_ = `MAPPING/${s.ref.id}/${s.ref.version}`;
      const entries = s.world.repo.listAuditLog().filter((entry) => entry.target === target_ && ['ITEM_APPROVE', 'ITEM_REREVIEW'].includes(entry.action));
      expect(entries.map((entry) => [entry.action, entry.actorId])).toEqual([
        ['ITEM_APPROVE', A1.id],
        ['ITEM_REREVIEW', 'TEST_FIXTURE_HA_1'],
        ['ITEM_APPROVE', A2.id],
      ]);
    });
  });

  describe('4단계: 같은 캐시 내용에 새 상태를 쓰느냐 낡은 상태를 쓰느냐가 판정을 가른다', () => {
    it('캐시한 내용 + 새로 읽은 상태: 매핑은 APPROVED · 승인자 A2 · 지문 F2 를 싣는다', () => {
      const s = stepOne(target);
      const f2 = reapproved(s);
      const mapping = mappingOf(composeFromCache(s.world.repo, s.cache), s.ref);
      expect(mapping.state).toBe('APPROVED');
      expect(mapping.approver).toEqual({ approverId: A2.id, approvedAt: REAPPROVAL_AT });
      expect(mapping.approvedFingerprint).toBe(f2);
    });

    it('캐시한 내용 + 낡은 상태 사본(음성 대조군): 매핑은 PUBLISHED · 승인자 A1 · 지문 F1 을 싣고 엔진 판정이 새 상태와 다르다', () => {
      const s = stepOne(target);
      reapproved(s);
      const fresh = composeFromCache(s.world.repo, s.cache);
      const stale = composeFromCache(s.world.repo, s.cache, s.staleStates);
      const staleMapping = mappingOf(stale, s.ref);
      expect(staleMapping.state).toBe('PUBLISHED');
      expect(staleMapping.approver?.approverId).toBe(A1.id);
      expect(staleMapping.approvedFingerprint).toBe(s.f1);
      // 새 상태: 재승인은 끝났지만 아직 게시 전이라 APPROVED(쓸 수 없음). 낡은 상태: 낡은 지문이 현재 줄의 지문과 달라 재검토 보류.
      expect(verdictOf(estimateWithBundle(s.world, fresh), target.lineId)).toBe('MAPPING_UNREVIEWED');
      expect(verdictOf(estimateWithBundle(s.world, stale), target.lineId)).toBe('MAPPING_UNDER_REREVIEW');
      expect(verdictOf(estimateWithBundle(s.world, fresh), target.lineId)).not.toBe(verdictOf(estimateWithBundle(s.world, stale), target.lineId));
    });

    it('준비 상태 읽기(loadReadinessSnapshot)가 조립한 묶음은 "캐시한 내용 + 새 상태" 조립과 깊이 같다 (합성 경로가 하나다)', () => {
      const s = stepOne(target);
      reapproved(s);
      const viaLoader = loadReadinessSnapshot(s.world.repo).bundles.find((bundle) => bundle.id === s.path.bundle.id);
      expect(viaLoader).toEqual(composeFromCache(s.world.repo, s.cache));
    });

    it('조립된 항목의 키는 "내용의 키 + state·approver(·approvedFingerprint)" 이다: 셋은 내용이 아니라 상태에서 채워진다', () => {
      const s = stepOne(target);
      reapproved(s);
      const composed = composeFromCache(s.world.repo, s.cache);
      const content = s.cache.records.find((record) => record.ref.id === s.ref.id)!.content;
      expect(Object.keys(mappingOf(composed, s.ref)).sort()).toEqual([...Object.keys(content), 'state', 'approver', 'approvedFingerprint'].sort());
      const profileContent = s.cache.records.find((record) => record.ref.kind === 'PROFILE')!.content;
      expect(Object.keys(composed.profiles[0]!).sort()).toEqual([...Object.keys(profileContent), 'state', 'approver'].sort());
    });

    it('내용 기록에 가짜 state·approver·approvedFingerprint 를 심어도 조립 결과는 상태 기록의 값만 쓴다', () => {
      const s = stepOne(target);
      const f2 = reapproved(s);
      const planted = structuredClone(s.cache);
      for (const record of planted.records) {
        // approvedFingerprint 는 매핑에만 있는 필드다: 프로필·서류 규칙 묶음 내용에는 심지 않는다(엔진 타입에 없는 키는 합성이 다루는 대상이 아니다).
        Object.assign(record.content as unknown as Record<string, unknown>, {
          state: 'SUSPENDED',
          approver: { approverId: 'TEST_FIXTURE_FROM_CONTENT', approvedAt: 'TEST_FIXTURE_FROM_CONTENT' },
          ...(record.ref.kind === 'MAPPING' ? { approvedFingerprint: 'TEST_FIXTURE_FP_FROM_CONTENT' } : {}),
        });
      }
      const composed = composeFromCache(s.world.repo, planted);
      const mapping = mappingOf(composed, s.ref);
      expect(mapping.state).toBe('APPROVED');
      expect(mapping.approver).toEqual({ approverId: A2.id, approvedAt: REAPPROVAL_AT });
      expect(mapping.approvedFingerprint).toBe(f2);
      expect(composed.profiles[0]!.state).toBe('PUBLISHED');
      expect(composed.profiles[0]!.approver?.approverId).toBe(A1.id);
      expect(composed.documentRuleSet!.approver?.approverId).toBe(A1.id);
      expect(JSON.stringify(composed)).not.toContain('FROM_CONTENT');
    });
  });

  describe('5단계: 게시. APPROVED 로 돌아온 매핑을 PUBLISHED 로 되돌리는 것은 그 항목을 담은 새 묶음의 게시다', () => {
    it('재승인 직후(APPROVED)에는 묶음 X 가 ACTIVE 로 있어도 이 줄은 MAPPING_UNREVIEWED 로 보류된다 (X 자체는 그대로)', () => {
      const s = stepOne(target);
      reapproved(s);
      expect(s.world.repo.getBundleStatus(s.path.bundle.id)).toBe('ACTIVE');
      expect(mappingRow(clinicReport(s.world), target.lineId)).toMatchObject({ status: 'NOT_READY', code: 'MAPPING_UNREVIEWED' });
      expect(s.world.repo.getRuleBundleVersion(s.path.bundle.id)).toEqual(s.cache.bundle);
    });

    it('같은 항목 참조로 새 묶음 X2 를 게시하면 매핑이 PUBLISHED 로 돌아온다 (승인자 A2 · 지문 F2 유지, 새 상태 기록은 하나 더해질 뿐)', () => {
      const s = stepOne(target);
      const f2 = reapproved(s);
      stepFive(s);
      const state = s.world.repo.readItemStates([s.ref])[0]!;
      expect(state).toMatchObject({ state: 'PUBLISHED', approvedFingerprint: f2 });
      expect(state.approver).toEqual({ approverId: A2.id, approvedAt: REAPPROVAL_AT });
      expect(trail(s.world.repo.getItemState(s.ref)!).slice(-3)).toEqual([
        ['UNDER_REREVIEW', A1.id, s.f1],
        ['APPROVED', A2.id, f2],
        ['PUBLISHED', A2.id, f2],
      ]);
    });

    it('X2 는 새 id 이고 X 와 같은 항목 참조·같은 contentHash 를 갖는다. X 의 기록은 그대로이며 게시는 옛 버전을 SUPERSEDED 로 만들지 않는다', () => {
      const s = stepOne(target);
      reapproved(s);
      const x2 = stepFive(s);
      expect(x2.id).not.toBe(s.path.bundle.id);
      expect(x2.itemRefs).toEqual(s.cache.bundle.itemRefs);
      expect(x2.contentHash).toBe(s.cache.bundle.contentHash);
      expect(s.world.repo.getRuleBundleVersion(s.path.bundle.id)).toEqual(s.cache.bundle);
      expect(s.world.repo.getBundleStatus(s.path.bundle.id)).toBe('ACTIVE');
      expect(s.world.repo.getBundleStatus(x2.id)).toBe('ACTIVE');
      expect(s.world.repo.readItemStates(s.cache.bundle.itemRefs).map((state) => state!.state)).toEqual(s.cache.bundle.itemRefs.map(() => 'PUBLISHED'));
    });

    it('범위가 계속 X 를 가리키는 병원도 별도 조치 없이 이 줄이 READY 로 돌아오고, 엔진은 ESTIMATED 로 낸다 (항목 상태는 묶음이 공유한다)', () => {
      const s = stepOne(target);
      reapproved(s);
      stepFive(s);
      expect(s.world.repo.getClinicRuleScope(TEST_FIXTURE_CLINIC_ID)?.ruleBundleVersionId).toBe(s.path.bundle.id);
      const report = clinicReport(s.world);
      expect(report.scope).toMatchObject({ status: 'READY', bundleId: s.path.bundle.id });
      expect(mappingRow(report, target.lineId)).toMatchObject({ status: 'READY', confirmedExclusion: false });
      expect(verdictOf(estimateWithBundle(s.world, composeFromCache(s.world.repo, s.cache)), target.lineId)).toBe('ESTIMATED');
    });

    it('PO 가 범위를 X2 로 옮겨도 같은 항목 상태를 본다: X2 조립 결과는 묶음 id 만 다르고 승인자 A2 · 지문 F2 가 같다', () => {
      const s = stepOne(target);
      const f2 = reapproved(s);
      const x2 = stepFive(s);
      assignRuleScope(s.world.deps, TEST_FIXTURE_PO_1, TEST_FIXTURE_CLINIC_ID, x2.id);
      const cacheX2 = cacheBundle(s.world.repo, x2.id);
      const viaX = composeFromCache(s.world.repo, s.cache);
      const viaX2 = composeFromCache(s.world.repo, cacheX2);
      expect(viaX2).toEqual({ ...viaX, id: x2.id });
      expect(mappingOf(viaX2, s.ref).approvedFingerprint).toBe(f2);
      expect(mappingOf(viaX2, s.ref).approver?.approverId).toBe(A2.id);
      const report = clinicReport(s.world);
      expect(report.scope).toMatchObject({ status: 'READY', bundleId: x2.id });
      expect(mappingRow(report, target.lineId)).toMatchObject({ status: 'READY' });
    });

    it('PUBLISHED 라도 낡은 지문 F1 을 쓰면 엔진이 보류한다: 낡은 상태 사본은 MAPPING_UNDER_REREVIEW, 새 상태는 ESTIMATED', () => {
      const s = stepOne(target);
      reapproved(s);
      stepFive(s);
      const stale = composeFromCache(s.world.repo, s.cache, s.staleStates);
      expect(mappingOf(stale, s.ref).state).toBe('PUBLISHED');
      expect(verdictOf(estimateWithBundle(s.world, stale), target.lineId)).toBe('MAPPING_UNDER_REREVIEW');
      expect(verdictOf(estimateWithBundle(s.world, composeFromCache(s.world.repo, s.cache)), target.lineId)).toBe('ESTIMATED');
    });

    it('캐시한 내용은 게시 뒤에도 새로 읽은 내용과 깊이 같다', () => {
      const s = stepOne(target);
      reapproved(s);
      stepFive(s);
      for (const cached of s.cache.records) {
        expect(s.world.repo.getItemVersion(cached.ref), `${cached.ref.kind}/${cached.ref.id}`).toEqual(cached);
      }
    });
  });

  describe('6단계: 조립마다 상태를 새로 읽는다 (읽기 호출 감시)', () => {
    it('캐시에서 조립하는 동안 내용·묶음 기록 조회는 없고, 상태 조회(readItemStates)는 조립마다 한 번이다', () => {
      const s = stepOne(target);
      const { repo } = s.world;
      repo.spy.reset();
      composeFromCache(repo, s.cache);
      expect(repo.spy.counts).toMatchObject({ readItemStates: 1, getItemVersion: 0, getRuleBundleVersion: 0, getBundleStatus: 1 });
      composeFromCache(repo, s.cache);
      composeFromCache(repo, s.cache);
      expect(repo.spy.counts.readItemStates).toBe(3);
      expect(repo.spy.counts.getItemVersion).toBe(0);
    });

    it('준비 상태 읽기는 읽을 때마다 묶음 수만큼 readItemStates 를 다시 부른다 (캐시하지 않는다)', () => {
      const s = stepOne(target);
      const { repo } = s.world;
      repo.spy.reset();
      loadReadinessSnapshot(repo);
      const first = repo.spy.counts.readItemStates;
      expect(first).toBe(repo.listRuleBundleVersions().length);
      loadReadinessSnapshot(repo);
      expect(repo.spy.counts.readItemStates).toBe(first * 2);
    });

    it('상태가 바뀐 뒤의 두 번째 조립은 무효화 호출 없이 새 값을 싣는다 (같은 캐시 객체, 내용 조회 없음)', () => {
      const s = stepOne(target);
      const { repo } = s.world;
      const f2 = stepTwo(s);
      const cacheBefore = structuredClone(s.cache);
      repo.spy.reset();
      const during = mappingOf(composeFromCache(repo, s.cache), s.ref);
      stepThree(s);
      const afterApprove = mappingOf(composeFromCache(repo, s.cache), s.ref);
      stepFive(s);
      const afterPublish = mappingOf(composeFromCache(repo, s.cache), s.ref);

      expect([during.state, during.approver?.approverId, during.approvedFingerprint]).toEqual(['UNDER_REREVIEW', A1.id, s.f1]);
      expect([afterApprove.state, afterApprove.approver?.approverId, afterApprove.approvedFingerprint]).toEqual(['APPROVED', A2.id, f2]);
      expect([afterPublish.state, afterPublish.approver?.approverId, afterPublish.approvedFingerprint]).toEqual(['PUBLISHED', A2.id, f2]);
      expect(s.cache).toEqual(cacheBefore);
    });
  });

  describe('7단계: 묶음 가용성은 항목 수준 값과 따로이며 마찬가지로 새로 읽힌다', () => {
    const SUSPEND_REASON = 'TEST_FIXTURE 중지 사유';

    it('묶음 X 를 중지해도 항목의 상태·승인자·고정 지문과 이력은 그대로이고 X 의 기록도 캐시 사본과 같다', () => {
      const s = stepOne(target);
      reapproved(s);
      stepFive(s);
      const refs = s.cache.bundle.itemRefs;
      const statesBefore = s.world.repo.readItemStates(refs);
      const historyBefore = refs.map((ref) => s.world.repo.getItemState(ref)!.history);

      suspendRuleBundle(s.world.deps, TEST_FIXTURE_RV_SUSPENDER, s.path.bundle.id, SUSPEND_REASON);

      expect(s.world.repo.readItemStates(refs)).toEqual(statesBefore);
      expect(refs.map((ref) => s.world.repo.getItemState(ref)!.history)).toEqual(historyBefore);
      expect(s.world.repo.getRuleBundleVersion(s.path.bundle.id)).toEqual(s.cache.bundle);
    });

    it('가용성은 조립마다 새로 읽힌다: 중지 직후 같은 캐시 조립은 status SUSPENDED 이고 매핑은 여전히 PUBLISHED · A2 · F2 다', () => {
      const s = stepOne(target);
      const f2 = reapproved(s);
      stepFive(s);
      expect(composeFromCache(s.world.repo, s.cache).status).toBe('ACTIVE');

      suspendRuleBundle(s.world.deps, TEST_FIXTURE_RV_SUSPENDER, s.path.bundle.id, SUSPEND_REASON);

      const composed = composeFromCache(s.world.repo, s.cache);
      expect(composed.status).toBe('SUSPENDED');
      const mapping = mappingOf(composed, s.ref);
      expect([mapping.state, mapping.approver?.approverId, mapping.approvedFingerprint]).toEqual(['PUBLISHED', A2.id, f2]);
    });

    it('중지된 X 를 가리키는 병원은 묶음 수준으로 보류되고(RULE_BUNDLE_SUSPENDED), X2 를 가리키면 같은 항목으로 READY 다', () => {
      const s = stepOne(target);
      reapproved(s);
      const x2 = stepFive(s);
      suspendRuleBundle(s.world.deps, TEST_FIXTURE_RV_SUSPENDER, s.path.bundle.id, SUSPEND_REASON);

      const held = clinicReport(s.world);
      expect(held.scope).toMatchObject({ status: 'NOT_READY', code: 'RULE_BUNDLE_SUSPENDED' });
      expect(verdictOf(estimateWithBundle(s.world, composeFromCache(s.world.repo, s.cache)), target.lineId)).toBe('RULE_BUNDLE_SUSPENDED');

      assignRuleScope(s.world.deps, TEST_FIXTURE_PO_1, TEST_FIXTURE_CLINIC_ID, x2.id);
      const ready = clinicReport(s.world);
      expect(ready.scope).toMatchObject({ status: 'READY', bundleId: x2.id });
      expect(mappingRow(ready, target.lineId)).toMatchObject({ status: 'READY' });
    });
  });
});
