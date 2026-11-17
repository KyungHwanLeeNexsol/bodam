import { describe, expect, it } from 'vitest';
import { approve } from '../../src/server/approval';
import { restoreCatalogVersion } from '../../src/server/catalog-publish';
import type { CommonBaseFee } from '../../src/server/domain/entities';
import { coverageFingerprintOfBaseFee } from '../../src/server/fingerprint';
import { triggerReReviewForBaseFee, triggerReReviewForTarget } from '../../src/server/re-review';
import { TEST_FIXTURE_HA_1, TEST_FIXTURE_RV_APPROVER_2, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import {
  BASE_FEE_AMOUNT,
  BASE_FEE_ID,
  REPO_CTX,
  READY_CELL,
  TREATMENT_PAYMENT,
  clinicReport,
  estimateOf,
  feeLineOf,
  feeRowAt,
  independentClinicInput,
  makeBaseFeeVersion,
  publishAndAssign,
  publishFeeCatalog,
  publishedBaseFeePath,
} from '../fixtures/server/base-fee.fixture';
import { TEST_CATALOG_CONFIG } from '../fixtures/server/publish.fixture';
import { expectCalculationAgrees, rowOfCell } from '../fixtures/server/readiness.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';

// 공통 기본비용의 정체성과 버전 처리 (M3 외부 검토 보완 ①, design.md DD-15·DD-16).
// `id` 는 바뀌지 않는 버전 id 이고 `baseFeeId` 가 안정 식별자다 (치료의 TreatmentVersion.id / treatmentId 와 같은 역할).
// 보장 판단 필드는 code 와 benefitType 뿐이다 [문서에 없음]. 가격·표시 이름·출처가 바뀐 새 버전은 지문을 지키고 매핑을 그대로 둔다.
// 모든 단계는 서비스 경로다 (카탈로그 게시 → 재검토 전환 → 재승인 → 묶음 게시 → 범위 지정). 시험 자료는 전부 TEST_FIXTURE 다.

const ALL_IN = TREATMENT_PAYMENT + BASE_FEE_AMOUNT;
const REASON = 'COVERAGE_JUDGMENT_FIELD_CHANGED';

const historyLength = (path: ReturnType<typeof publishedBaseFeePath>): number => path.world.repo.getItemState(path.feeMapping!)!.history.length;
const rereviewAudit = (path: ReturnType<typeof publishedBaseFeePath>) => path.world.repo.listAuditLog().filter((entry) => entry.action === 'ITEM_REREVIEW');

describe('가격만 바뀐 새 기본비용 버전: 지문·매핑·준비 상태가 그대로이고 T 만 가격 차이만큼 바뀐다', () => {
  it('같은 baseFeeId, 새 버전 id, 새 amount → 지문이 같고 매핑은 PUBLISHED 그대로, 재검토 기록이 없다', () => {
    const path = publishedBaseFeePath('COVERED');
    const stateBefore = path.world.repo.getItemState(path.feeMapping!)!;
    const priceOnly = makeBaseFeeVersion(2, { amount: BASE_FEE_AMOUNT + 2_500 });
    expect(coverageFingerprintOfBaseFee(priceOnly)).toBe(coverageFingerprintOfBaseFee(makeBaseFeeVersion(1)));

    publishFeeCatalog(path.world, [priceOnly]);

    expect(path.world.repo.getItemState(path.feeMapping!)).toEqual(stateBefore);
    expect(rereviewAudit(path)).toEqual([]);
    expect(path.world.repo.listCommonBaseFeeVersions(BASE_FEE_ID).map((fee) => fee.id)).toEqual([makeBaseFeeVersion(1).id, priceOnly.id]);
  });

  it('준비 상태는 READY 로 남고 estimate() 의 T 는 정확히 가격 차이만큼 바뀐다 (줄은 새 버전 id 를 가리킨다)', () => {
    const path = publishedBaseFeePath('COVERED');
    expect(estimateOf(path.world).amounts.hospitalPayment).toBe(ALL_IN);

    publishFeeCatalog(path.world, [makeBaseFeeVersion(2, { amount: BASE_FEE_AMOUNT + 2_500 })]);

    const report = clinicReport(path.world);
    expect(feeRowAt(report)).toMatchObject({ status: 'READY', confirmedExclusion: false });
    expect(rowOfCell(report.calculationReady, READY_CELL)).toEqual({ cell: READY_CELL, status: 'READY' });
    expectCalculationAgrees(report, independentClinicInput(path.world), REPO_CTX, '가격 변경');
    const result = estimateOf(path.world);
    expect(result.state).toBe('ESTIMATED');
    expect(result.amounts.hospitalPayment).toBe(ALL_IN + 2_500);
    expect(feeLineOf(result).patientAmount).toBe(BASE_FEE_AMOUNT + 2_500);
    expect(independentClinicInput(path.world).baseFeeLines.map((line) => line.treatmentVersionId)).toEqual([makeBaseFeeVersion(2).id]);
  });
});

describe('표시 이름·출처만 바뀐 새 버전은 아무것도 옮기지 않는다', () => {
  const NON_JUDGMENT: Array<[string, Partial<CommonBaseFee>]> = [
    ['displayName', { displayName: 'TEST_FIXTURE 이름만 바뀐 기본 진찰료' }],
    ['origin', { origin: 'DEMO' }],
    ['amount 와 displayName 동시', { amount: 9_999, displayName: 'TEST_FIXTURE 이름과 가격' }],
  ];

  it.each(NON_JUDGMENT)('%s', (_name, change) => {
    const path = publishedBaseFeePath('COVERED');
    const before = path.world.repo.getItemState(path.feeMapping!)!;
    const next = makeBaseFeeVersion(2, change);
    expect(coverageFingerprintOfBaseFee(next)).toBe(coverageFingerprintOfBaseFee(makeBaseFeeVersion(1)));

    publishFeeCatalog(path.world, [next]);

    expect(path.world.repo.getItemState(path.feeMapping!)).toEqual(before);
    expect(rereviewAudit(path)).toEqual([]);
    expect(feeRowAt(clinicReport(path.world)).status).toBe('READY');
  });
});

describe('보장 판단 필드(code, benefitType)가 바뀐 새 버전: 매핑이 UNDER_REREVIEW 로 가고 재승인 뒤에 READY 로 돌아온다', () => {
  const JUDGMENT: Array<[string, Partial<CommonBaseFee>]> = [
    ['code', { code: 'TEST_FIXTURE_BASE_FEE_CODE_CHANGED' }],
    ['benefitType', { benefitType: 'NON_BENEFIT' }],
  ];

  it.each(JUDGMENT)('%s 하나만 바뀌어도 지문이 달라지고 PUBLISHED 매핑이 UNDER_REREVIEW 가 된다 (이력·감사 기록은 치료와 같은 모양)', (_field, change) => {
    const path = publishedBaseFeePath('COVERED');
    const pinned = path.world.repo.getItemState(path.feeMapping!)!.approvedFingerprint;
    const next = makeBaseFeeVersion(2, change);
    expect(coverageFingerprintOfBaseFee(next)).not.toBe(pinned);
    path.world.clock.set('2026-10-21T00:00:00.000Z');

    publishFeeCatalog(path.world, [next]);

    const state = path.world.repo.getItemState(path.feeMapping!)!;
    expect(state.state).toBe('UNDER_REREVIEW');
    // 승인자와 고정 지문은 그대로 남는다 (재승인이 새로 고정한다).
    expect(state.approvedFingerprint).toBe(pinned);
    expect(state.history.at(-1)).toEqual({
      from: 'PUBLISHED',
      to: 'UNDER_REREVIEW',
      actorId: TEST_FIXTURE_HA_1.id,
      role: 'HA',
      at: '2026-10-21T00:00:00.000Z',
      reason: REASON,
      approver: state.approver,
      approvedFingerprint: pinned,
    });
    expect(rereviewAudit(path).map((entry) => [entry.target, entry.beforeVersion, entry.afterVersion, entry.reason])).toEqual([
      [`MAPPING/${path.feeMapping!.id}/${path.feeMapping!.version}`, 'PUBLISHED', 'UNDER_REREVIEW', REASON],
    ]);
    // 치료 매핑은 건드리지 않는다.
    for (const ref of path.refs.mappings.slice(0, 2)) {
      expect(path.world.repo.getItemState(ref)?.state).toBe('PUBLISHED');
    }
  });

  it.each(JUDGMENT)('%s: 줄이 MAPPING_UNDER_REREVIEW 로 보류되고, 다른 RV 의 재승인과 새 묶음 게시·지정으로 READY 로 돌아온다 (엔진과 같다)', (_field, change) => {
    const path = publishedBaseFeePath('COVERED');
    const next = makeBaseFeeVersion(2, change);
    publishFeeCatalog(path.world, [next]);

    const held = clinicReport(path.world);
    expect(feeRowAt(held)).toMatchObject({ status: 'NOT_READY', code: 'MAPPING_UNDER_REREVIEW' });
    expect(rowOfCell(held.calculationReady, READY_CELL)).toMatchObject({ status: 'NOT_READY', stage: 'M', lines: [{ treatmentId: BASE_FEE_ID, code: 'MAPPING_UNDER_REREVIEW' }] });
    expectCalculationAgrees(held, independentClinicInput(path.world), REPO_CTX, '재검토 중');
    expect(estimateOf(path.world).holdReasons).toEqual([{ treatmentId: BASE_FEE_ID, code: 'MAPPING_UNDER_REREVIEW' }]);

    // 작성자가 아닌 다른 RV 만 재승인할 수 있다. 재승인은 현재 버전(2번)의 지문을 새로 고정한다.
    expect(catchDomainError(() => approve(path.world.deps, TEST_FIXTURE_RV_AUTHOR, path.feeMapping!)).code).toBe('SELF_APPROVAL_FORBIDDEN');
    approve(path.world.deps, TEST_FIXTURE_RV_APPROVER_2, path.feeMapping!);
    const reapproved = path.world.repo.getItemState(path.feeMapping!)!;
    expect(reapproved.state).toBe('APPROVED');
    expect(reapproved.approvedFingerprint).toBe(coverageFingerprintOfBaseFee(next));
    expect(reapproved.approver?.approverId).toBe(TEST_FIXTURE_RV_APPROVER_2.id);
    // 게시 전의 APPROVED 는 아직 쓸 수 없다.
    expect(feeRowAt(clinicReport(path.world))).toMatchObject({ status: 'NOT_READY', code: 'MAPPING_UNREVIEWED' });

    publishAndAssign(path.world, path.refs);

    const ready = clinicReport(path.world);
    expect(feeRowAt(ready)).toMatchObject({ status: 'READY', confirmedExclusion: false });
    expect(rowOfCell(ready.calculationReady, READY_CELL)).toEqual({ cell: READY_CELL, status: 'READY' });
    expectCalculationAgrees(ready, independentClinicInput(path.world), REPO_CTX, '재승인 뒤');
    expect(path.world.repo.getItemState(path.feeMapping!)?.state).toBe('PUBLISHED');
    expect(estimateOf(path.world).state).toBe('ESTIMATED');
  });

  it('재검토 전환은 매핑 상태를 읽는 순간의 고정 지문과 비교한다: 직전 버전과 같아도 고정 지문과 다르면 전환한다 (비교 대상은 직전 버전이 아니다)', () => {
    const path = publishedBaseFeePath('COVERED');
    // 버전 2 는 쓰지 않았다. 고정 지문(버전 1)과 다른 버전 3 만 바로 전환 함수에 넘긴다.
    const third = makeBaseFeeVersion(3, { code: 'TEST_FIXTURE_BASE_FEE_CODE_THIRD' });
    const moved = triggerReReviewForBaseFee(path.world.deps, TEST_FIXTURE_HA_1, third);
    expect(moved).toEqual([path.feeMapping]);
    expect(path.world.repo.getItemState(path.feeMapping!)?.state).toBe('UNDER_REREVIEW');
  });

  it('같은 호출을 되풀이해도 결과가 같다 (멱등): 두 번째 호출은 아무것도 옮기지 않고 저장소를 바꾸지 않는다', () => {
    const path = publishedBaseFeePath('COVERED');
    const third = makeBaseFeeVersion(3, { benefitType: 'NON_BENEFIT' });
    expect(triggerReReviewForBaseFee(path.world.deps, TEST_FIXTURE_HA_1, third)).toEqual([path.feeMapping]);
    const after = snapshotOf(path.world.repo);
    const length = historyLength(path);

    expect(triggerReReviewForBaseFee(path.world.deps, TEST_FIXTURE_HA_1, third)).toEqual([]);

    expect(snapshotOf(path.world.repo)).toEqual(after);
    expect(historyLength(path)).toBe(length);
  });

  it('치료와 기본비용의 전환은 같은 본문이다: 대상 id 와 지문을 직접 넘긴 전환 함수가 같은 결과를 낸다', () => {
    const a = publishedBaseFeePath('COVERED');
    const b = publishedBaseFeePath('COVERED');
    const third = makeBaseFeeVersion(3, { code: 'TEST_FIXTURE_BASE_FEE_CODE_THIRD' });
    const viaEntry = triggerReReviewForBaseFee(a.world.deps, TEST_FIXTURE_HA_1, third);
    const viaTarget = triggerReReviewForTarget(b.world.deps, TEST_FIXTURE_HA_1, BASE_FEE_ID, coverageFingerprintOfBaseFee(third));
    expect(viaTarget).toEqual(viaEntry);
    expect(snapshotOf(b.world.repo)).toEqual(snapshotOf(a.world.repo));
  });
});

describe('카탈로그 게시의 그 밖의 경로', () => {
  it('기본비용을 뺀 새 카탈로그를 게시해도 그 기본비용의 매핑은 건드리지 않는다', () => {
    const path = publishedBaseFeePath('COVERED');
    const before = path.world.repo.getItemState(path.feeMapping!)!;

    publishFeeCatalog(path.world, []);

    expect(path.world.repo.getItemState(path.feeMapping!)).toEqual(before);
    expect(rereviewAudit(path)).toEqual([]);
    expect(path.world.repo.getCommonBaseFee(makeBaseFeeVersion(1).id)).toEqual(makeBaseFeeVersion(1));
    expect(clinicReport(path.world).mappings.some((row) => row.isBaseFee)).toBe(false);
  });

  it('가격만 바뀐 게시 뒤 이전 카탈로그 버전을 복구해도 게시되고 결과가 일관된다 (T 는 이전 가격으로, 매핑은 그대로)', () => {
    const path = publishedBaseFeePath('COVERED');
    publishFeeCatalog(path.world, [makeBaseFeeVersion(2, { amount: BASE_FEE_AMOUNT + 2_500 })]);
    expect(estimateOf(path.world).amounts.hospitalPayment).toBe(ALL_IN + 2_500);

    const restored = restoreCatalogVersion(path.world.deps, TEST_FIXTURE_HA_1, 'TEST_FIXTURE_CATALOG_1', TEST_CATALOG_CONFIG);

    expect(restored.baseFeeIds).toEqual([makeBaseFeeVersion(1).id]);
    expect(path.world.repo.getClinicCurrentCatalogVersion('TEST_FIXTURE_CLINIC_1')?.id).toBe(restored.id);
    expect(path.world.repo.getItemState(path.feeMapping!)?.state).toBe('PUBLISHED');
    const report = clinicReport(path.world);
    expect(feeRowAt(report).status).toBe('READY');
    expectCalculationAgrees(report, independentClinicInput(path.world), REPO_CTX, '복구');
    expect(estimateOf(path.world).amounts.hospitalPayment).toBe(ALL_IN);
  });

  it('판단 필드가 바뀐 게시 뒤 이전 카탈로그를 복구해도 게시된다: 이미 재검토 중인 매핑은 재승인 전까지 보류로 남고, 재승인은 복구된 버전의 지문을 고정한다', () => {
    const path = publishedBaseFeePath('COVERED');
    publishFeeCatalog(path.world, [makeBaseFeeVersion(2, { code: 'TEST_FIXTURE_BASE_FEE_CODE_CHANGED' })]);
    expect(path.world.repo.getItemState(path.feeMapping!)?.state).toBe('UNDER_REREVIEW');

    restoreCatalogVersion(path.world.deps, TEST_FIXTURE_HA_1, 'TEST_FIXTURE_CATALOG_1', TEST_CATALOG_CONFIG);

    expect(path.world.repo.getItemState(path.feeMapping!)?.state).toBe('UNDER_REREVIEW');
    expect(feeRowAt(clinicReport(path.world))).toMatchObject({ status: 'NOT_READY', code: 'MAPPING_UNDER_REREVIEW' });
    approve(path.world.deps, TEST_FIXTURE_RV_APPROVER_2, path.feeMapping!);
    expect(path.world.repo.getItemState(path.feeMapping!)?.approvedFingerprint).toBe(coverageFingerprintOfBaseFee(makeBaseFeeVersion(1)));
    publishAndAssign(path.world, path.refs);
    const report = clinicReport(path.world);
    expect(feeRowAt(report).status).toBe('READY');
    expectCalculationAgrees(report, independentClinicInput(path.world), REPO_CTX, '복구 뒤 재승인');
  });

  it('복구는 같은 게시 경로를 지난다: 복구가 되살리는 기본비용 버전도 재검토 전환 대상이다', () => {
    const path = publishedBaseFeePath('COVERED');
    // 버전 2(판단 필드 변경)를 현재로 두고 재승인·재게시해 고정 지문을 버전 2 의 것으로 바꾼다.
    publishFeeCatalog(path.world, [makeBaseFeeVersion(2, { code: 'TEST_FIXTURE_BASE_FEE_CODE_CHANGED' })]);
    approve(path.world.deps, TEST_FIXTURE_RV_APPROVER_2, path.feeMapping!);
    publishAndAssign(path.world, path.refs);
    expect(path.world.repo.getItemState(path.feeMapping!)?.state).toBe('PUBLISHED');

    restoreCatalogVersion(path.world.deps, TEST_FIXTURE_HA_1, 'TEST_FIXTURE_CATALOG_1', TEST_CATALOG_CONFIG);

    // 복구된 버전 1 의 지문은 고정 지문(버전 2)과 다르므로 다시 재검토로 간다.
    expect(path.world.repo.getItemState(path.feeMapping!)?.state).toBe('UNDER_REREVIEW');
  });
});
