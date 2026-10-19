import { describe, expect, it } from 'vitest';
import { loadBundleContent } from '../../src/server/api/bundle-content';
import { createBundleContentCache } from '../../src/server/api/bundle-content-cache';
import { ServerIntegrityError } from '../../src/server/api/integrity';
import { silentLog } from '../../src/server/api/log';
import { createOperatingServices } from '../../src/server/composition';
import type { ItemVersionRecord, ItemVersionRef } from '../../src/server/domain/items';
import { buildWorld } from '../fixtures/server/estimate-world.fixture';
import { publishRefs } from '../fixtures/server/versioning.fixture';
import { collectKeys, repoWith } from './helpers';

// 묶음 내용 캐시 (M4.C, design.md DD-14 "캐시 계약"·"항목 생명주기 상태와 캐시 계약", plan.md M4 캐시 적중 계약 (1)(2)): 캐시 자체와 loadBundleContent 의 적중·미적중.
// 캐시가 담을 수 있는 것은 (묶음 id, 내용 해시)로 찾는 바뀌지 않는 묶음 내용뿐이다. 상태·승인자·승인 지문·가용성·병원의 규칙 사용 범위·환자 선택·요청 식별자는
// 담을 자리가 없다. 이 파일은 그 모양과 키 구성을 단위 수준에서 고정한다(요청 단위의 계약은 estimate-cache-contract.test.ts 가 실제 POST 로 본다).

function loadedWorld() {
  const w = buildWorld();
  const cache = createBundleContentCache();
  const content = loadBundleContent(w.world.repo, w.bundle!.id, cache);
  return { w, cache, content };
}

describe('묶음 내용 캐시: 저장과 조회', () => {
  it('빈 채로 시작하고, 내용을 저장하면 (묶음 id, 내용 해시)로 찾는다', () => {
    const cache = createBundleContentCache();
    expect(cache.entries()).toEqual([]);
    const { content } = loadedWorld();
    expect(cache.lookup(content.id, content.contentHash)).toBeNull();
    cache.store(content);
    expect(cache.lookup(content.id, content.contentHash)).toEqual(content);
    expect(cache.entries()).toHaveLength(1);
  });

  it('키는 묶음 id 와 내용 해시 둘 다다: id 만 같거나 해시만 같으면 찾지 못한다', () => {
    const { cache, content } = loadedWorld();
    expect(cache.lookup(content.id, content.contentHash)).not.toBeNull();
    expect(cache.lookup(content.id, 'TEST_FIXTURE_OTHER_HASH')).toBeNull();
    expect(cache.lookup('TEST_FIXTURE_OTHER_ID', content.contentHash)).toBeNull();
    expect(cache.lookup(content.contentHash, content.id)).toBeNull();
  });

  it('id 와 해시에 같은 구분 문자가 들어 있어도 키가 섞이지 않는다 (id 에 해시 조각을 붙여 만든 키와 충돌하지 않는다)', () => {
    const { cache, content } = loadedWorld();
    const shifted = { ...content, id: `${content.id}","`, contentHash: content.contentHash };
    expect(cache.lookup(shifted.id, shifted.contentHash)).toBeNull();
    cache.store(shifted);
    expect(cache.entries().map((entry) => entry.bundleId).sort()).toEqual([content.id, shifted.id].sort());
    expect(cache.lookup(content.id, content.contentHash)).toEqual(content);
  });

  it('저장한 사본은 원본과 분리되고 깊이 얼려 있다: 원본을 바꿔도 캐시는 그대로이고 캐시 내용을 바꾸려 하면 던진다', () => {
    const { cache, content } = loadedWorld();
    const stored = cache.lookup(content.id, content.contentHash)!;
    expect(stored).not.toBe(content);
    expect(stored).toEqual(content);
    const originalHash = content.profiles[0]!.content.contentHash;
    (content.profiles[0]!.content as { contentHash: string }).contentHash = 'TEST_FIXTURE_TAMPERED';
    expect(cache.lookup(content.id, content.contentHash)!.profiles[0]!.content.contentHash).toBe(originalHash);
    for (const frozen of [stored, stored.profiles, stored.profiles[0], stored.profiles[0]!.content, stored.mappings[0]!.content.scope, stored.documentRuleSet]) {
      expect(Object.isFrozen(frozen)).toBe(true);
    }
    expect(() => {
      (stored.profiles[0]!.content as { contentHash: string }).contentHash = 'TEST_FIXTURE_TAMPERED_2';
    }).toThrow(TypeError);
    expect(() => {
      (stored.mappings as unknown[]).push({});
    }).toThrow(TypeError);
  });

  it('같은 키를 다시 저장해도 항목은 하나이고 처음 저장한 사본이 그대로 남는다 (참조가 바뀌지 않는다)', () => {
    const { cache, content } = loadedWorld();
    const first = cache.lookup(content.id, content.contentHash);
    cache.store(content);
    cache.store(content);
    expect(cache.entries()).toHaveLength(1);
    expect(cache.lookup(content.id, content.contentHash)).toBe(first);
  });

  it('entries() 는 읽기 전용 보기다: 호출마다 새 배열이고 배열도 항목도 얼려 있으며, 캐시의 공개 이름은 entries·lookup·store 셋뿐이다 (무효화·삭제 없음)', () => {
    const { cache } = loadedWorld();
    const first = cache.entries();
    expect(cache.entries()).not.toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(() => (first as unknown[]).push({})).toThrow(TypeError);
    expect(Object.keys(cache).sort()).toEqual(['entries', 'lookup', 'store']);
  });

  it('항목의 모양: {bundleId, contentHash, content}, 내용은 {id, contentHash, profiles, mappings, documentRuleSet}, 기록은 {ref, content, authorId, createdAt} 뿐이다', () => {
    const { cache, content } = loadedWorld();
    const [entry] = cache.entries();
    expect(Object.keys(entry!).sort()).toEqual(['bundleId', 'content', 'contentHash']);
    expect(entry!.bundleId).toBe(content.id);
    expect(entry!.contentHash).toBe(content.contentHash);
    expect(Object.keys(entry!.content).sort()).toEqual(['contentHash', 'documentRuleSet', 'id', 'mappings', 'profiles']);
    const records: ItemVersionRecord[] = [...entry!.content.profiles, ...entry!.content.mappings, entry!.content.documentRuleSet!];
    expect(records).toHaveLength(5);
    for (const record of records) {
      expect(Object.keys(record).sort()).toEqual(['authorId', 'content', 'createdAt', 'ref']);
    }
  });

  it('캐시에는 상태·승인자·승인 지문·가용성·병원 범위·요청 식별자의 키가 어디에도 없다 (깊이 무관)', () => {
    const { cache } = loadedWorld();
    const keys = collectKeys(cache.entries());
    for (const forbidden of ['state', 'approver', 'approvedFingerprint', 'status', 'ruleBundleStatus', 'availability', 'clinicId', 'ruleBundleVersionId', 'assignedBy', 'requestId']) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
  });
});

describe('loadBundleContent: 캐시 적중과 미적중', () => {
  it('미적중: 묶음 기록 1회와 항목 내용 5회를 읽고 캐시에 한 항목을 채운다. 항목 상태·가용성은 읽지 않는다', () => {
    const w = buildWorld();
    const cache = createBundleContentCache();
    w.world.repo.spy.reset();
    const content = loadBundleContent(w.world.repo, w.bundle!.id, cache);
    const { counts } = w.world.repo.spy;
    expect([counts.getRuleBundleVersion, counts.getItemVersion, counts.readItemStates, counts.getItemState, counts.getBundleStatus]).toEqual([1, 5, 0, 0, 0]);
    expect(cache.entries().map((entry) => [entry.bundleId, entry.contentHash])).toEqual([[content.id, content.contentHash]]);
  });

  it('적중: 묶음 기록 1회만 읽고(키의 내용 해시를 알기 위해) 항목 내용은 읽지 않으며, 같은 값을 돌려준다', () => {
    const { w, cache, content } = loadedWorld();
    const stored = cache.lookup(content.id, content.contentHash);
    w.world.repo.spy.reset();
    const second = loadBundleContent(w.world.repo, w.bundle!.id, cache);
    const { counts } = w.world.repo.spy;
    expect([counts.getRuleBundleVersion, counts.getItemVersion, counts.readItemStates, counts.getItemState, counts.getBundleStatus]).toEqual([1, 0, 0, 0, 0]);
    expect(second).toBe(stored);
    expect(second).toEqual(content);
    expect(cache.entries()).toHaveLength(1);
  });

  it('키에 내용 해시가 들어간다: 같은 id 의 묶음 기록이 다른 해시와 다른 항목 내용을 내면 적중하지 않고 새 내용을 읽는다', () => {
    const { w, cache, content } = loadedWorld();
    const real = w.world.repo;
    const changed = repoWith(real, {
      getRuleBundleVersion: (id: string) => {
        const bundle = real.getRuleBundleVersion(id);
        return bundle === null ? null : { ...bundle, contentHash: 'TEST_FIXTURE_HASH_CHANGED' };
      },
      getItemVersion: (ref: ItemVersionRef) => {
        const record = real.getItemVersion(ref);
        return record === null || ref.kind !== 'PROFILE' ? record : { ...record, content: { ...record.content, contentHash: 'TEST_FIXTURE_PROFILE_HASH_CHANGED' } };
      },
    });
    const reloaded = loadBundleContent(changed, w.bundle!.id, cache);
    expect(reloaded.contentHash).toBe('TEST_FIXTURE_HASH_CHANGED');
    expect(reloaded.profiles[0]!.content.contentHash).toBe('TEST_FIXTURE_PROFILE_HASH_CHANGED');
    expect(reloaded.profiles[0]!.content.contentHash).not.toBe(content.profiles[0]!.content.contentHash);
    expect(cache.entries().map((entry) => [entry.bundleId, entry.contentHash]).sort()).toEqual(
      [
        [content.id, content.contentHash],
        [content.id, 'TEST_FIXTURE_HASH_CHANGED'],
      ].sort(),
    );
  });

  it('키에 묶음 id 가 들어간다: 같은 항목 참조·같은 내용 해시로 따로 게시한 두 묶음은 서로 다른 캐시 항목이다', () => {
    const w = buildWorld();
    const cache = createBundleContentCache();
    const x = w.bundle!;
    const x2 = publishRefs(w.world, { profiles: x.itemRefs.filter((ref) => ref.kind === 'PROFILE'), mappings: x.itemRefs.filter((ref) => ref.kind === 'MAPPING'), documentRuleSet: x.itemRefs.find((ref) => ref.kind === 'DOCUMENT_RULE_SET') });
    expect(x2.id).not.toBe(x.id);
    expect(x2.contentHash).toBe(x.contentHash);
    const first = loadBundleContent(w.world.repo, x.id, cache);
    const second = loadBundleContent(w.world.repo, x2.id, cache);
    expect(cache.entries().map((entry) => entry.bundleId).sort()).toEqual([x.id, x2.id].sort());
    expect(second.id).toBe(x2.id);
    expect(second.id).not.toBe(first.id);
    expect({ ...second, id: first.id }).toEqual(first);
  });

  it('구조 결함이 있는 내용은 캐시에 넣지 않는다 (저장소 자료가 고쳐지면 다음 요청이 새로 읽는다)', () => {
    const w = buildWorld();
    const cache = createBundleContentCache();
    const real = w.world.repo;
    const broken = repoWith(real, {
      getItemVersion: (ref: ItemVersionRef) => {
        const record = real.getItemVersion(ref);
        return record === null || ref.kind !== 'PROFILE' ? record : { ...record, content: null };
      },
    });
    const content = loadBundleContent(broken, w.bundle!.id, cache);
    expect(content.profiles).toHaveLength(1);
    expect(cache.entries()).toEqual([]);
    const repaired = loadBundleContent(real, w.bundle!.id, cache);
    expect(repaired.profiles[0]!.content).not.toBeNull();
    expect(cache.entries()).toHaveLength(1);
  });

  it('읽기에 실패하면(묶음 기록 없음, 항목 내용 없음) 서버 결함으로 던지고 캐시를 채우지 않는다', () => {
    const w = buildWorld();
    const cache = createBundleContentCache();
    expect(() => loadBundleContent(w.world.repo, 'NO_SUCH_BUNDLE', cache)).toThrow(new ServerIntegrityError('BUNDLE_MISSING'));
    expect(() => loadBundleContent(repoWith(w.world.repo, { getItemVersion: () => null }), w.bundle!.id, cache)).toThrow(new ServerIntegrityError('ITEM_CONTENT_MISSING'));
    expect(cache.entries()).toEqual([]);
  });

  it('호출한 쪽이 돌려받은 내용을 바꿔도 캐시에 든 내용은 바뀌지 않는다 (미적중으로 읽은 사본과 캐시 사본이 분리돼 있다)', () => {
    const w = buildWorld();
    const cache = createBundleContentCache();
    const content = loadBundleContent(w.world.repo, w.bundle!.id, cache);
    const before = structuredClone(cache.entries());
    content.profiles.length = 0;
    content.mappings.push(content.mappings[0]!);
    expect(cache.entries()).toEqual(before);
  });
});

describe('구성이 캐시를 만든다 (모듈 수준 상태가 아니다)', () => {
  const deps = () => ({ repo: buildWorld().world.repo, log: silentLog, today: () => '2026-10-15' });

  it('운영 구성은 호출마다 새 빈 캐시를 만들어 서비스에 싣는다: 두 서비스가 캐시를 공유하지 않는다', () => {
    const a = createOperatingServices(deps());
    const b = createOperatingServices(deps());
    expect(a.bundleCache).not.toBe(b.bundleCache);
    expect(a.bundleCache.entries()).toEqual([]);
    expect(Object.keys(a.bundleCache).sort()).toEqual(['entries', 'lookup', 'store']);
  });

  it('운영 구성에는 캐시를 주입하거나 덮어쓰는 길이 없다: 인자로 캐시를 넘겨도 무시된다', () => {
    const injected = createBundleContentCache();
    const services = createOperatingServices({ ...deps(), bundleCache: injected } as never);
    expect(services.bundleCache).not.toBe(injected);
    expect(Object.isFrozen(services)).toBe(true);
    expect(() => {
      (services as unknown as { bundleCache: unknown }).bundleCache = injected;
    }).toThrow(TypeError);
  });
});
