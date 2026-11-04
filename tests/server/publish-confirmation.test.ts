import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '../../src/server/digest';
import type { CatalogDraft } from '../../src/server/domain/entities';
import { confirmsPublish, issuePublishConfirmation, PUBLISH_CONFIRMATION_PATTERN } from '../../src/server/publish-confirmation';

// 게시 확인값: 관리자 신원·병원·기준 카탈로그·초안 버전(revision)·가격 목록에 묶인 값이다. 순수 계산이라 저장소가 필요 없다.

const DRAFT: CatalogDraft = {
  clinicId: 'CLINIC_A',
  baseCatalogVersionId: 'CATALOG_1',
  revision: 'REVISION_1',
  priceEdits: [{ treatmentId: 'T1', patientAmount: 12_000 }],
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
  ])('%s → 처음 발급된 확인값이 맞지 않는다', (_name, other, admin) => {
    const issued = issuePublishConfirmation(DRAFT, ADMIN);
    expect(issuePublishConfirmation(other, admin)).not.toBe(issued);
    expect(confirmsPublish(other, admin, issued)).toBe(false);
  });

  it('목록·저장 응답이 주는 가격 목록의 지문(draftDigest)이나 초안 버전 값은 확인값이 아니다', () => {
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
      const forged = canonicalDigest(['bodam.publish-confirmation.v1', bad, ADMIN, DRAFT.clinicId, DRAFT.baseCatalogVersionId, canonicalDigest(DRAFT.priceEdits)]);
      expect(confirmsPublish(broken, ADMIN, forged), String(bad)).toBe(false);
    }
  });
});
