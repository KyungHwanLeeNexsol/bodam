import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '../../src/server/digest';
import type { CatalogDraft } from '../../src/server/domain/entities';
import { confirmsPublish, draftContentDigest, issuePublishConfirmation, PUBLISH_CONFIRMATION_PATTERN } from '../../src/server/publish-confirmation';
import { additionBody } from '../fixtures/server/catalog-structure.fixture';

// 게시 확인값: 관리자 신원·병원·기준 카탈로그·초안 버전(revision)·초안 내용 전체(가격·새 치료·숨김·순서)에 묶인 값이다. 순수 계산이라 저장소가 필요 없다.

const DRAFT: CatalogDraft = {
  clinicId: 'CLINIC_A',
  baseCatalogVersionId: 'CATALOG_1',
  revision: 'REVISION_1',
  priceEdits: [{ treatmentId: 'T1', patientAmount: 12_000 }],
  baseFeeEdits: [],
  additions: [],
  deactivations: [],
  reactivations: [],
  order: null,
  updatedBy: { id: 'ADMIN_1', role: 'HA' },
  updatedAt: '2026-11-04T00:00:00.000Z',
};
const ADMIN = 'ADMIN_1';

describe('issuePublishConfirmation / confirmsPublish', () => {
  it('같은 초안·같은 관리자에게는 늘 같은 값이고, 형식은 소문자 16진수 64자이며, 자기 자신을 확인한다', () => {
    const value = issuePublishConfirmation(DRAFT, ADMIN);
    expect(value).toMatch(PUBLISH_CONFIRMATION_PATTERN);
    expect(issuePublishConfirmation({ ...DRAFT }, ADMIN)).toBe(value);
    expect(confirmsPublish(DRAFT, ADMIN, value)).toBe(true);
  });

  it.each<[string, CatalogDraft, string]>([
    ['초안 버전(revision)이 다르다 — 가격이 같은 재저장', { ...DRAFT, revision: 'REVISION_2' }, ADMIN],
    ['관리자가 다르다', DRAFT, 'ADMIN_2'],
    ['병원이 다르다', { ...DRAFT, clinicId: 'CLINIC_B' }, ADMIN],
    ['기준 카탈로그가 다르다', { ...DRAFT, baseCatalogVersionId: 'CATALOG_2' }, ADMIN],
    ['가격이 다르다', { ...DRAFT, priceEdits: [{ treatmentId: 'T1', patientAmount: 12_001 }] }, ADMIN],
    ['치료가 다르다', { ...DRAFT, priceEdits: [{ treatmentId: 'T2', patientAmount: 12_000 }] }, ADMIN],
    // 같은 revision 이라도 가격 말고 구조가 다르면 확인값이 다르다 (확인값은 초안 내용 전체에 묶인다).
    ['숨김만 다르다', { ...DRAFT, deactivations: ['T2'] }, ADMIN],
    ['숨김 대상만 다르다', { ...DRAFT, deactivations: ['T3'] }, ADMIN],
    ['표시 순서만 다르다 (null 과 배열)', { ...DRAFT, order: ['T1', 'T2'] }, ADMIN],
    ['표시 순서의 배열 순서만 다르다', { ...DRAFT, order: ['T2', 'T1'] }, ADMIN],
    ['새 치료만 다르다', { ...DRAFT, additions: [additionBody('NEW_A') as never] }, ADMIN],
    ['새 치료의 가격만 다르다', { ...DRAFT, additions: [additionBody('NEW_A', { patientAmount: 1 }) as never] }, ADMIN],
    // 공통 기본비용 금액 수정도 확인값에 묶인다.
    ['기본비용 수정이 더해졌다', { ...DRAFT, baseFeeEdits: [{ baseFeeId: 'FEE_A', amount: 6_000 }] }, ADMIN],
  ])('%s → 처음 발급된 확인값이 맞지 않는다', (_name, other, admin) => {
    const issued = issuePublishConfirmation(DRAFT, ADMIN);
    expect(issuePublishConfirmation(other, admin)).not.toBe(issued);
    expect(confirmsPublish(other, admin, issued)).toBe(false);
  });

  it('같은 revision 의 초안 둘이 순서만 다르면 서로의 확인값으로 게시할 수 없다 (revision 에 기대지 않는 내용 결합)', () => {
    const first: CatalogDraft = { ...DRAFT, order: ['T1', 'T2'] };
    const second: CatalogDraft = { ...DRAFT, order: ['T2', 'T1'] };
    expect(first.revision).toBe(second.revision);
    expect(draftContentDigest(first)).not.toBe(draftContentDigest(second));
    expect(confirmsPublish(second, ADMIN, issuePublishConfirmation(first, ADMIN))).toBe(false);
    expect(confirmsPublish(first, ADMIN, issuePublishConfirmation(first, ADMIN))).toBe(true);
  });

  it('기본비용 수정만 다른 초안 둘은 서로의 확인값으로 게시할 수 없다 (금액·대상 기본비용 모두 묶인다)', () => {
    const base: CatalogDraft = { ...DRAFT, priceEdits: [], baseFeeEdits: [{ baseFeeId: 'FEE_A', amount: 6_000 }] };
    const otherAmount: CatalogDraft = { ...base, baseFeeEdits: [{ baseFeeId: 'FEE_A', amount: 6_001 }] };
    const otherFee: CatalogDraft = { ...base, baseFeeEdits: [{ baseFeeId: 'FEE_B', amount: 6_000 }] };
    expect(base.revision).toBe(otherAmount.revision);
    for (const other of [otherAmount, otherFee]) {
      expect(draftContentDigest(other)).not.toBe(draftContentDigest(base));
      expect(confirmsPublish(other, ADMIN, issuePublishConfirmation(base, ADMIN))).toBe(false);
    }
    expect(confirmsPublish(base, ADMIN, issuePublishConfirmation(base, ADMIN))).toBe(true);
  });

  it('기본비용 수정이 없는 초안의 내용 지문은 이 필드가 생기기 전의 식과 같다 (기존 지문·감사 기록이 바뀌지 않는다)', () => {
    expect(draftContentDigest(DRAFT)).toBe(canonicalDigest({ priceEdits: DRAFT.priceEdits, additions: DRAFT.additions, deactivations: DRAFT.deactivations, order: DRAFT.order }));
  });

  it('목록·저장 응답이 주는 초안 내용 지문(draftDigest)이나 초안 버전 값은 확인값이 아니다', () => {
    expect(confirmsPublish(DRAFT, ADMIN, draftContentDigest(DRAFT))).toBe(false);
    expect(confirmsPublish(DRAFT, ADMIN, canonicalDigest(DRAFT.priceEdits))).toBe(false);
    expect(confirmsPublish(DRAFT, ADMIN, DRAFT.revision)).toBe(false);
    for (const odd of ['', ' ', 'a'.repeat(64), 'A'.repeat(64), issuePublishConfirmation(DRAFT, ADMIN).toUpperCase()]) {
      expect(confirmsPublish(DRAFT, ADMIN, odd), odd).toBe(false);
    }
  });

  it('확인값은 초안 버전 값(열쇠)을 드러내지 않는다', () => {
    expect(issuePublishConfirmation(DRAFT, ADMIN)).not.toContain(DRAFT.revision);
  });

  it('열쇠(revision)가 비었거나 문자열이 아닌 초안은 확인값을 발급하지 않고, 어떤 값도 맞다고 하지 않는다 (보이는 필드만으로 만든 위조 값 포함)', () => {
    for (const bad of ['', undefined, null, 7]) {
      const broken = { ...DRAFT, revision: bad } as unknown as CatalogDraft;
      expect(() => issuePublishConfirmation(broken, ADMIN), String(bad)).toThrow();
      // 보이는 필드(관리자·병원·기준 카탈로그·가격)만으로 같은 모양의 값을 만들어 본다.
      const forged = canonicalDigest(['bodam.publish-confirmation.v2', bad, ADMIN, DRAFT.clinicId, DRAFT.baseCatalogVersionId, draftContentDigest(DRAFT)]);
      expect(confirmsPublish(broken, ADMIN, forged), String(bad)).toBe(false);
    }
  });
});
