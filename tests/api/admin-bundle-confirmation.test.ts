import { describe, expect, it } from 'vitest';
import { handleAdmin } from '../../src/server/admin/router';
import type { AdminIdentity } from '../../src/server/admin/auth';
import { computeBundlePublishConfirmation } from '../../src/server/bundle-compose';
import { triggerReReviewForTarget } from '../../src/server/re-review';
import { createDraft } from '../../src/server/authoring';
import type { BundlePublishConfirmation } from '../../src/server/domain/entities';
import type { ItemVersionRef } from '../../src/server/domain/items';
import { TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { adminServicesOf, identityOf, staticAuthenticator } from '../fixtures/server/admin.fixture';
import type { TestAccountKey } from '../fixtures/server/admin.fixture';
import { T1 } from '../fixtures/server/base-fee.fixture';
import { T3, approvedMapping, composeWorld } from '../fixtures/server/bundle-compose.fixture';
import { changedKeys, repoThrowingOn } from '../fixtures/server/catalog-structure.fixture';
import { makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { mappingRecord } from '../fixtures/server/items.fixture';
import { adoptTreatmentVersion } from '../fixtures/server/lifecycle.fixture';
import { publishRefs } from '../fixtures/server/versioning.fixture';

// 묶음 게시 확인값: 미리보기 우회 방지 (M7 묶음 구성 보강). 모두 실제 관리자 처리기(handleAdmin)를 지난다.
// 계약: 게시 확인값은 서버가 깨끗한 미리보기를 만들 때 발급해 서버에 기록해 둔 예측할 수 없는 일회용 값이다.
//   - 확인값을 입력에서 다시 계산할 수 있으면(옛 방식) 미리보기를 한 번도 받지 않은 RV 도 게시할 수 있었다 — 첫 시험이 그 재현이다.
//   - 게시는 한 트랜잭션 안에서 기록을 찾아 관리자·기준 묶음·고른 매핑·구성 해시가 맞고 아직 쓰이지 않았을 때만 통과하고, 성공하면 기록을 소비한다.
//   - 못 찾음·이미 쓰임·다른 관리자·다른 구성·미리보기 뒤 구성 변경은 모두 같은 응답이다: 409 { error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' }.
// 거절 시험은 모두 상태 코드·본문과 저장소 전체(exportState, bundleConfirmations 포함)의 전후 동일을 함께 확인한다.

const BASE = 'http://localhost/api/admin';
const PREVIEW_REQUIRED = { error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' };
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const CELL = { generation: 'GEN4_C4', insurerType: 'NON_LIFE' } as const;
const OTHER_CELL = { generation: 'GEN1_AS', insurerType: 'LIFE' } as const;

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

type Who = TestAccountKey | AdminIdentity | null;

function setup() {
  const built = composeWorld();
  const { world } = built;
  const as = (who: Who, repoOverride?: typeof world.repo) =>
    adminServicesOf(world, {
      authenticator: staticAuthenticator(who === null ? null : typeof who === 'string' ? identityOf(who) : who),
      ...(repoOverride === undefined ? {} : { api: { repo: repoOverride } }),
    }).admin;
  return { ...built, repo: world.repo, as, state: () => world.repo.exportState() };
}

type Setup = ReturnType<typeof setup>;

const segmentsOf = (path: string): string[] => path.split('/').filter((part) => part !== '').map(decodeURIComponent);

function call(admin: ReturnType<Setup['as']>, method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method, headers: body === undefined ? {} : { 'content-type': 'application/json' } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return handleAdmin(admin, new Request(`${BASE}/${path}`, init), segmentsOf(path));
}

const json = async (response: Response): Promise<Json> => (await response.json()) as Json;
const refBody = (ref: ItemVersionRef) => ({ id: ref.id, version: ref.version });
const previewBody = (baseBundleId: string, ...refs: ItemVersionRef[]) => ({ baseBundleId, mappings: refs.map(refBody) });
const publishBody = (baseBundleId: string, confirmation: string, ...refs: ItemVersionRef[]) => ({ baseBundleId, mappings: refs.map(refBody), publishConfirmation: confirmation });
const bundlesOf = (world: Setup): number => world.repo.listRuleBundleVersions().length;
const publishAuditOf = (world: Setup): number => world.repo.listAuditLog().filter((entry) => entry.action === 'BUNDLE_PUBLISH').length;
const rvActor = (key: TestAccountKey) => ({ id: identityOf(key).userId, role: 'RV' }) as const;

/** 미리보기를 받아 확인값을 돌려준다(깨끗한 구성이어야 한다). */
async function previewToken(world: Setup, who: Who, baseBundleId: string, ...refs: ItemVersionRef[]): Promise<string> {
  const response = await call(world.as(who), 'POST', 'bundle-publish/preview', previewBody(baseBundleId, ...refs));
  expect(response.status).toBe(200);
  const token = (await json(response)).publishConfirmation as string | null;
  expect(token).toMatch(TOKEN_PATTERN);
  return token as string;
}

const publish = (world: Setup, who: Who, baseBundleId: string, token: string, ...refs: ItemVersionRef[]): Promise<Response> =>
  call(world.as(who), 'POST', 'bundle-publish', publishBody(baseBundleId, token, ...refs));

/** 거절 응답을 (상태, 본문)으로 관찰한다. */
async function observed(response: Response): Promise<[number, Json]> {
  return [response.status, await json(response)];
}

describe('미리보기 우회 재현: 입력에서 다시 계산한 확인값으로는 게시할 수 없다', () => {
  it('RV 가 미리보기를 한 번도 부르지 않고 옛 방식(computeBundlePublishConfirmation)으로 계산한 확인값을 보내면 409 PREVIEW_REQUIRED 이고 저장 상태가 그대로다', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const rv = { id: identityOf('rv-1').userId, role: 'RV' } as const;
    const offline = computeBundlePublishConfirmation(world.world.deps, rv, { baseBundleId: world.base.id, mappings: [added] });
    const before = world.state();
    const bundlesBefore = world.repo.listRuleBundleVersions().length;

    const response = await call(world.as('rv-1'), 'POST', 'bundle-publish', publishBody(world.base.id, offline, added));
    const body = await json(response);

    const observedOutcome = { status: response.status, body: response.status === 200 ? { newBundleId: (body.bundle as Json).id } : body, newBundles: world.repo.listRuleBundleVersions().length - bundlesBefore };
    expect(observedOutcome).toEqual({ status: 409, body: { error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' }, newBundles: 0 });
    expect(world.state()).toEqual(before);
  });

  it('1. 우회: 기록도 감사 기록도 새 묶음도 남지 않는다 (확인값 기록 표는 비어 있는 채다)', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const offline = computeBundlePublishConfirmation(world.world.deps, rvActor('rv-1'), { baseBundleId: world.base.id, mappings: [added] });
    const auditBefore = world.repo.listAuditLog().length;
    const bundlesBefore = bundlesOf(world);

    const response = await publish(world, 'rv-1', world.base.id, offline, added);

    expect(await observed(response)).toEqual([409, PREVIEW_REQUIRED]);
    expect(world.state().bundleConfirmations).toEqual([]);
    expect(world.repo.listAuditLog()).toHaveLength(auditBefore);
    expect(bundlesOf(world)).toBe(bundlesBefore);
    expect(world.repo.getItemState(added)?.state).toBe('APPROVED');
  });
});

describe('2. 발급된 적 없는 확인값', () => {
  it('형식만 맞는 임의의 64자 16진수는 409 PREVIEW_REQUIRED 이고 저장 상태가 그대로다', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const real = await previewToken(world, 'rv-1', world.base.id, added);
    const before = world.state();

    for (const guess of ['0'.repeat(64), 'f'.repeat(64), 'a1b2c3d4'.repeat(8), real.replace(/.$/, real.endsWith('0') ? '1' : '0')]) {
      const response = await publish(world, 'rv-1', world.base.id, guess, added);
      expect(await observed(response), guess).toEqual([409, PREVIEW_REQUIRED]);
      expect(world.state(), guess).toEqual(before);
    }
  });
});

describe('3. 미리보기가 발급하는 확인값', () => {
  it('깨끗한 구성이면 64자 16진수이고 옛 방식의 입력 해시와 다르다. 저장소에서 바뀌는 최상위 영역은 bundleConfirmations 하나뿐이다', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const before = world.state();
    const recomputable = computeBundlePublishConfirmation(world.world.deps, rvActor('rv-1'), { baseBundleId: world.base.id, mappings: [added] });

    const response = await call(world.as('rv-1'), 'POST', 'bundle-publish/preview', previewBody(world.base.id, added));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.publishConfirmation).toMatch(TOKEN_PATTERN);
    expect(body.publishConfirmation).not.toBe(recomputable);
    const after = world.state();
    expect(changedKeys(before, after)).toEqual(['bundleConfirmations']);
    for (const key of ['bundles', 'bundleEvents', 'itemStates', 'scopeHistory', 'auditLog']) {
      expect(after[key], key).toEqual(before[key]);
    }
    // 서버 기록: 구성 해시는 서버 안에만 있고 응답 어디에도 없다. 응답의 확인값은 구성 해시가 아니다.
    const record = world.repo.getBundleConfirmation(body.publishConfirmation as string);
    expect(record).toEqual({
      token: body.publishConfirmation,
      actorId: identityOf('rv-1').userId,
      role: 'RV',
      baseBundleId: world.base.id,
      chosen: [added],
      configurationDigest: recomputable,
      issuedAt: world.world.clock.now(),
      consumedAt: null,
      resultBundleId: null,
    });
    expect(JSON.stringify(body)).not.toContain(recomputable);
  });

  it('미리보기마다 새 확인값을 발급하고, 이전 확인값은 그대로 유효하다', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const first = await previewToken(world, 'rv-1', world.base.id, added);
    const second = await previewToken(world, 'rv-1', world.base.id, added);

    expect(second).not.toBe(first);
    expect(world.state().bundleConfirmations).toHaveLength(2);
    expect((await publish(world, 'rv-1', world.base.id, first, added)).status).toBe(200);
  });

  it('충돌이나 결함이 있으면 확인값은 null 이고 기록도 쓰지 않는다 (저장소 전체가 그대로)', async () => {
    const world = setup();
    const clash = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_T1_CLASH', T1);
    const draft = createDraft(world.world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingRecord(T3, { id: 'TEST_FIXTURE_MAPPING_DRAFT' }).content).ref;
    const before = world.state();

    const conflicting = await json(await call(world.as('rv-1'), 'POST', 'bundle-publish/preview', previewBody(world.base.id, clash)));
    const defective = await json(await call(world.as('rv-1'), 'POST', 'bundle-publish/preview', previewBody(world.base.id, draft)));

    expect(conflicting.publishConfirmation).toBeNull();
    expect(conflicting.conflicts).toHaveLength(1);
    expect(defective.publishConfirmation).toBeNull();
    expect(defective.defects.length).toBeGreaterThan(0);
    expect(world.state()).toEqual(before);
  });
});

describe('4. 다른 관리자의 확인값', () => {
  it('rv-2 가 rv-1 의 확인값으로 게시하면 409 이고, 확인값은 소비되지 않아 rv-1 은 그대로 쓸 수 있다', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const token = await previewToken(world, 'rv-1', world.base.id, added);
    const before = world.state();

    const stolen = await publish(world, 'rv-2', world.base.id, token, added);

    expect(await observed(stolen)).toEqual([409, PREVIEW_REQUIRED]);
    expect(world.state()).toEqual(before);
    expect(world.repo.getBundleConfirmation(token)).toMatchObject({ consumedAt: null, resultBundleId: null });

    const own = await publish(world, 'rv-1', world.base.id, token, added);
    expect(own.status).toBe(200);
    expect(world.repo.getBundleConfirmation(token)).toMatchObject({ consumedAt: world.world.clock.now(), resultBundleId: (await json(own)).bundle.id });
  });
});

describe('5. 다른 구성의 확인값', () => {
  it('고른 매핑 집합이 다르면(더 많거나 다른 것) 409 이고 원래 구성으로는 그대로 쓸 수 있다', async () => {
    const world = setup();
    const a = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_A', T3, { scope: [CELL] });
    const b = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_B', T3, { scope: [OTHER_CELL] });
    const tokenForA = await previewToken(world, 'rv-1', world.base.id, a);
    const before = world.state();

    for (const [name, refs] of [
      ['a 와 b', [a, b]],
      ['b 만', [b]],
    ] as const) {
      const response = await publish(world, 'rv-1', world.base.id, tokenForA, ...refs);
      expect(await observed(response), name).toEqual([409, PREVIEW_REQUIRED]);
      expect(world.state(), name).toEqual(before);
    }
    expect((await publish(world, 'rv-1', world.base.id, tokenForA, a)).status).toBe(200);
  });

  it('다른 기준 묶음(항목 집합은 같다)에서는 409 이다', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const otherBase = publishRefs(world.world, {
      profiles: world.base.itemRefs.filter((ref) => ref.kind === 'PROFILE'),
      mappings: world.base.itemRefs.filter((ref) => ref.kind === 'MAPPING'),
      documentRuleSet: world.base.itemRefs.find((ref) => ref.kind === 'DOCUMENT_RULE_SET') ?? null,
    });
    const token = await previewToken(world, 'rv-1', world.base.id, added);
    const before = world.state();

    const response = await publish(world, 'rv-1', otherBase.id, token, added);

    expect(await observed(response)).toEqual([409, PREVIEW_REQUIRED]);
    expect(world.state()).toEqual(before);
  });

  it('고른 순서만 다른 요청은 같은 구성이다 (정렬해 비교한다)', async () => {
    const world = setup();
    const a = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_A', T3, { scope: [CELL] });
    const b = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_B', T3, { scope: [OTHER_CELL] });
    const token = await previewToken(world, 'rv-1', world.base.id, a, b);

    expect((await publish(world, 'rv-1', world.base.id, token, b, a)).status).toBe(200);
  });
});

describe('기록의 각 필드는 구성 해시와 별개로 대조된다 (방어를 겹쳐 둔다)', () => {
  // 구성 해시가 현재 구성과 같은 기록을 서버에 심고, 대조하는 필드 하나만 어긋나게 한다. 해시가 맞아도 그 필드 하나 때문에 거절돼야 한다.
  const TAMPERS: Array<[string, (a: ItemVersionRef) => Partial<BundlePublishConfirmation>]> = [
    ['관리자', () => ({ actorId: identityOf('rv-2').userId })],
    ['기준 묶음', () => ({ baseBundleId: 'TEST_FIXTURE_OTHER_BASE' })],
    ['고른 매핑 집합', (a) => ({ chosen: [a, { kind: 'MAPPING', id: 'TEST_FIXTURE_MAPPING_OTHER', version: 'v1' }] })],
  ];
  it.each(TAMPERS)('%s 만 어긋난 기록은 거절되고 소비되지 않는다', async (_name, tamper) => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const token = '3'.repeat(64);
    world.repo.putBundleConfirmation({
      token,
      actorId: identityOf('rv-1').userId,
      role: 'RV',
      baseBundleId: world.base.id,
      chosen: [added],
      configurationDigest: computeBundlePublishConfirmation(world.world.deps, rvActor('rv-1'), { baseBundleId: world.base.id, mappings: [added] }),
      issuedAt: world.world.clock.now(),
      consumedAt: null,
      resultBundleId: null,
      ...tamper(added),
    });
    const before = world.state();

    const response = await publish(world, 'rv-1', world.base.id, token, added);

    expect(await observed(response)).toEqual([409, PREVIEW_REQUIRED]);
    expect(world.state()).toEqual(before);
  });
});

describe('6. 미리보기 뒤에 묶인 입력이 바뀌면', () => {
  it('고른 매핑이 다른 묶음에 게시돼 PUBLISHED 가 되면 이전 확인값은 409 이다 (그 시도는 아무것도 쓰지 않는다)', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const stale = await previewToken(world, 'rv-1', world.base.id, added);
    const fresh = await previewToken(world, 'rv-1', world.base.id, added);
    expect((await publish(world, 'rv-1', world.base.id, fresh, added)).status).toBe(200);
    expect(world.repo.getItemState(added)?.state).toBe('PUBLISHED');
    const before = world.state();

    const response = await publish(world, 'rv-1', world.base.id, stale, added);

    expect(await observed(response)).toEqual([409, PREVIEW_REQUIRED]);
    expect(world.state()).toEqual(before);
    expect(world.repo.getBundleConfirmation(stale)?.consumedAt).toBeNull();
  });

  it('고른 매핑이 재검토로 돌아가면(승인 상태가 바뀜) 이전 확인값은 409 이다', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const token = await previewToken(world, 'rv-1', world.base.id, added);
    const moved = triggerReReviewForTarget(world.world.deps, { id: 'TEST_FIXTURE_HA_REREVIEW', role: 'HA' }, T3, 'TEST_FIXTURE_FINGERPRINT_CHANGED');
    expect(moved).toEqual([added]);
    expect(world.repo.getItemState(added)?.state).toBe('UNDER_REREVIEW');
    const before = world.state();

    const response = await publish(world, 'rv-1', world.base.id, token, added);

    expect(await observed(response)).toEqual([409, PREVIEW_REQUIRED]);
    expect(world.state()).toEqual(before);
  });
});

describe('7. 성공하면 확인값을 소비한다 (일회용)', () => {
  it('첫 게시는 200 이고 기록에 소비 시각·결과 묶음이 채워지며 BUNDLE_PUBLISH 감사 기록은 한 건이다. 같은 요청을 다시 보내면 409 이고 아무것도 늘지 않는다', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const token = await previewToken(world, 'rv-1', world.base.id, added);
    world.world.clock.set('2026-10-18T09:30:00.000Z');
    const publishAuditBefore = publishAuditOf(world);

    const first = await publish(world, 'rv-1', world.base.id, token, added);
    const firstBody = await json(first);

    expect(first.status).toBe(200);
    expect(world.repo.getBundleConfirmation(token)).toMatchObject({ consumedAt: '2026-10-18T09:30:00.000Z', resultBundleId: firstBody.bundle.id, actorId: identityOf('rv-1').userId });
    expect(publishAuditOf(world) - publishAuditBefore).toBe(1);
    expect(world.repo.listAuditLog().filter((entry) => entry.action === 'BUNDLE_PUBLISH' && entry.target === `BUNDLE/${firstBody.bundle.id}`)).toHaveLength(1);
    const afterFirst = world.state();
    const bundlesAfterFirst = bundlesOf(world);

    const again = await publish(world, 'rv-1', world.base.id, token, added);

    expect(await observed(again)).toEqual([409, PREVIEW_REQUIRED]);
    expect(world.state()).toEqual(afterFirst);
    expect(bundlesOf(world)).toBe(bundlesAfterFirst);
    expect(publishAuditOf(world) - publishAuditBefore).toBe(1);
  });

  it('소비 검사 자체: 구성이 그대로 유효해도(구성 해시가 현재와 같다) 이미 소비된 기록은 거절된다. 소비되지 않은 같은 기록은 통과한다', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const configurationDigest = computeBundlePublishConfirmation(world.world.deps, rvActor('rv-1'), { baseBundleId: world.base.id, mappings: [added] });
    const record = (token: string) => ({
      token,
      actorId: identityOf('rv-1').userId,
      role: 'RV' as const,
      baseBundleId: world.base.id,
      chosen: [added],
      configurationDigest,
      issuedAt: world.world.clock.now(),
      consumedAt: null,
      resultBundleId: null,
    });
    const consumedToken = '1'.repeat(64);
    const freshToken = '2'.repeat(64);
    world.repo.putBundleConfirmation(record(consumedToken));
    world.repo.markBundleConfirmationConsumed(consumedToken, world.world.clock.now(), world.base.id);
    world.repo.putBundleConfirmation(record(freshToken));
    const before = world.state();

    const rejected = await publish(world, 'rv-1', world.base.id, consumedToken, added);

    expect(await observed(rejected)).toEqual([409, PREVIEW_REQUIRED]);
    expect(world.state()).toEqual(before);
    // 대조군: 나머지는 모두 유효하므로 소비되지 않은 기록은 같은 요청이 통과한다.
    expect((await publish(world, 'rv-1', world.base.id, freshToken, added)).status).toBe(200);
  });
});

describe('8. 롤백: 한 트랜잭션이라 어느 단계가 실패해도 확인값 소비를 포함해 아무것도 적용되지 않는다', () => {
  it('(a) 확인값은 맞지만 기존 게시 전제가 실패하면(미리보기 뒤 치료 보장 판단 필드가 바뀜 → 400 FINGERPRINT_STALE) 저장소는 그대로이고 기록은 소비되지 않는다', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const token = await previewToken(world, 'rv-1', world.base.id, added);
    adoptTreatmentVersion(world.repo, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_3B', treatmentId: T3, treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }));
    const before = world.state();

    const response = await publish(world, 'rv-1', world.base.id, token, added);
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.defects).toContainEqual({ code: 'FINGERPRINT_STALE', path: 'bundle.mappings[3].approvedFingerprint' });
    expect(world.state()).toEqual(before);
    expect(world.repo.getBundleConfirmation(token)).toMatchObject({ consumedAt: null, resultBundleId: null });
  });

  it('(b) 게시가 성공한 뒤 소비가 던지면 묶음·묶음 상태 사건·항목 상태(PUBLISHED)·감사 기록·소비가 모두 되돌려지고 기록은 소비되지 않은 채다', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const token = await previewToken(world, 'rv-1', world.base.id, added);
    const before = world.state();
    const failing = repoThrowingOn(world.repo, 'markBundleConfirmationConsumed');

    const response = await call(world.as('rv-1', failing.repo), 'POST', 'bundle-publish', publishBody(world.base.id, token, added));

    expect(response.status).toBe(500);
    expect(failing.calls).toHaveLength(1);
    expect(world.state()).toEqual(before);
    expect(world.repo.getItemState(added)?.state).toBe('APPROVED');
    expect(world.repo.getBundleConfirmation(token)).toMatchObject({ consumedAt: null, resultBundleId: null });
    // 장애가 사라진 뒤에는 같은 확인값으로 게시된다 (소비되지 않았으므로).
    expect((await publish(world, 'rv-1', world.base.id, token, added)).status).toBe(200);
  });

  it.each([
    ['묶음 쓰기 putRuleBundleVersion', 'putRuleBundleVersion'],
    ['묶음 가용성 사건 appendBundleStatusEvent', 'appendBundleStatusEvent'],
    ['항목 상태 전이 recordItemTransition', 'recordItemTransition'],
    ['감사 기록 appendAuditLog', 'appendAuditLog'],
  ])('(c) %s 가 던지면 아무것도 적용되지 않고 기록은 소비되지 않는다', async (_name, method) => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const token = await previewToken(world, 'rv-1', world.base.id, added);
    const before = world.state();
    const failing = repoThrowingOn(world.repo, method);

    const response = await call(world.as('rv-1', failing.repo), 'POST', 'bundle-publish', publishBody(world.base.id, token, added));

    expect(response.status).toBe(500);
    expect(failing.calls.length).toBeGreaterThanOrEqual(1);
    expect(world.state()).toEqual(before);
    expect(world.repo.getBundleConfirmation(token)).toMatchObject({ consumedAt: null, resultBundleId: null });
  });

  it('미리보기에서 기록 쓰기가 던지면 확인값을 돌려주지 않고 저장소는 그대로다', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const before = world.state();
    const failing = repoThrowingOn(world.repo, 'putBundleConfirmation');

    const response = await call(world.as('rv-1', failing.repo), 'POST', 'bundle-publish/preview', previewBody(world.base.id, added));

    expect(response.status).toBe(500);
    expect(world.state()).toEqual(before);
  });
});

describe('9. 역할은 그대로다', () => {
  const PLATFORM_HA: AdminIdentity = { userId: 'TEST_FIXTURE_HA_PLATFORM', memberships: [{ clinicId: null, role: 'HA' }] };

  it('로그인이 없으면 401, 허용되지 않은 역할은 403 이고 미리보기에서도 게시에서도 저장소가 그대로다 (rv-1 의 확인값을 들고 있어도)', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const token = await previewToken(world, 'rv-1', world.base.id, added);
    const before = world.state();
    const cases: Array<[string, Who, number, Json]> = [
      ['로그인 없음', null, 401, { error: 'UNAUTHENTICATED' }],
      ['병원 1 HA', 'ha-clinic-1', 403, { error: 'FORBIDDEN' }],
      ['플랫폼 단위 HA', PLATFORM_HA, 403, { error: 'FORBIDDEN' }],
      ['PO', 'po-1', 403, { error: 'FORBIDDEN' }],
      ['병원에 매인 RV', 'rv-clinic-1', 403, { error: 'FORBIDDEN' }],
    ];

    for (const [name, who, status, expected] of cases) {
      const preview = await call(world.as(who), 'POST', 'bundle-publish/preview', previewBody(world.base.id, added));
      expect(await observed(preview), `${name} 미리보기`).toEqual([status, expected]);
      const published = await publish(world, who, world.base.id, token, added);
      expect(await observed(published), `${name} 게시`).toEqual([status, expected]);
      expect(world.state(), name).toEqual(before);
    }
    expect(world.repo.getBundleConfirmation(token)?.consumedAt).toBeNull();
  });

  it('PO 는 게시할 수 없고 RV 는 병원에 범위를 지정할 수 없다 (게시는 범위를 지정하지 않는다)', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const token = await previewToken(world, 'rv-1', world.base.id, added);
    const published = await publish(world, 'rv-1', world.base.id, token, added);
    const next = (await json(published)).bundle.id as string;
    const before = world.state();

    const byPo = await publish(world, 'po-1', world.base.id, await previewToken(world, 'rv-1', world.base.id, added), added);
    expect(byPo.status).toBe(403);
    const assignedByRv = await call(world.as('rv-1'), 'POST', 'rule-scope/clinics/TEST_FIXTURE_CLINIC_1', { ruleBundleVersionId: next, expectedCurrentBundleId: world.base.id });
    expect(await observed(assignedByRv)).toEqual([403, { error: 'FORBIDDEN' }]);

    // PO 시도 직전에 받은 새 미리보기 기록 하나만 늘었고, 범위·묶음·감사는 그대로다.
    expect(changedKeys(before, world.state())).toEqual(['bundleConfirmations']);
    expect(world.repo.getClinicRuleScope('TEST_FIXTURE_CLINIC_1')?.ruleBundleVersionId).toBe(world.base.id);
    expect(published.status).toBe(200);
  });
});
