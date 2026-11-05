import { describe, expect, it } from 'vitest';
import { collectBundlePublishDefects, publishRuleBundle } from '../../src/server/bundle-publish';
import { createDraft } from '../../src/server/authoring';
import { TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { baseContent } from '../fixtures/server/lifecycle.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';
import { TEST_FIXTURE_RV_PUBLISHER, approveSpec, bundleWorld, validSpec } from '../fixtures/server/versioning.fixture';

// 게시 결함 수집기 (collectBundlePublishDefects): publishRuleBundle 이 쓰기 전에 보는 판정과 같은 함수다.
// 미리보기(읽기 전용)와 게시가 한 판정을 공유하도록 publishNew 의 "검증기 + 서비스 전제" 부분을 꺼냈다. 이 시험은 두 가지를 못 박는다:
//   1. 수집기의 결함 목록은 게시가 던지는 PUBLISH_VALIDATION_FAILED 의 결함 목록과 같다(코드·경로·순서).
//   2. 수집기는 아무것도 쓰지 않는다(저장소 전후 비교가 같다).

describe('collectBundlePublishDefects', () => {
  it('올바른 묶음이면 결함이 없고, 항목은 (종류, id, 버전) 코드 포인트 순이며, 저장소는 그대로다', () => {
    const w = bundleWorld();
    const refs = approveSpec(w, validSpec(1));
    const before = snapshotOf(w.repo);

    const { defects, items } = collectBundlePublishDefects(w.deps, refs);

    expect(defects).toEqual([]);
    expect(items.map((item) => item.ref)).toEqual([refs.documentRuleSet, refs.mappings[0], refs.profiles[0]]);
    expect(items.map((item) => item.state.state)).toEqual(['APPROVED', 'APPROVED', 'APPROVED']);
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('승인되지 않은 매핑(DRAFT)이 있으면 게시가 던지는 결함과 같은 목록을 돌려주고, 저장소는 그대로다', () => {
    const w = bundleWorld();
    const refs = approveSpec(w, validSpec(1));
    const draft = createDraft(w.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', baseContent('MAPPING', 2)).ref;
    const request = { ...refs, mappings: [refs.mappings[0]!, draft] };
    const before = snapshotOf(w.repo);

    const { defects } = collectBundlePublishDefects(w.deps, request);
    expect(snapshotOf(w.repo)).toEqual(before);

    const error = catchDomainError(() => publishRuleBundle(w.deps, TEST_FIXTURE_RV_PUBLISHER, request));
    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(defects.length).toBeGreaterThan(0);
    expect(defects).toContainEqual({ code: 'ITEM_STATE_NOT_PUBLISHABLE', path: 'bundle.mappings[1].state' });
    expect(defects).toEqual(error.defects);
  });

  it('형식이 틀린 요청에서도 던지지 않고 결함을 돌려준다', () => {
    const w = bundleWorld();
    const { defects, items } = collectBundlePublishDefects(w.deps, 'not an object');
    expect(defects.length).toBeGreaterThan(0);
    expect(items).toEqual([]);
  });
});
