import { describe, expect, it } from 'vitest';
import { TEST_FIXTURE_NOW, makeBundleConfirmation } from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { newRepo, seedWorld, snapshotOf } from '../fixtures/server/repo.fixture';

// 저장소 계약: 묶음 게시 확인값 기록 (M7 묶음 구성 보강). write-once 쓰기, token 으로 읽기, 원자적 한 번 소비, 복사 격리, 트랜잭션 되돌림.

const TOKEN = 'a'.repeat(64);

function seeded() {
  const repo = newRepo();
  const world = seedWorld(repo);
  return { repo, world };
}

describe('putBundleConfirmation / getBundleConfirmation', () => {
  it('쓴 기록을 token 으로 읽고, 없는 token 은 null 이다. 저장소 상태는 bundleConfirmations 키로 떠 낸다', () => {
    const { repo, world } = seeded();
    const record = makeBundleConfirmation({ baseBundleId: world.bundleId });

    repo.putBundleConfirmation(record);

    expect(repo.getBundleConfirmation(TOKEN)).toEqual(record);
    expect(repo.getBundleConfirmation('b'.repeat(64))).toBeNull();
    expect(repo.getBundleConfirmation('')).toBeNull();
    expect(snapshotOf(repo).bundleConfirmations).toEqual([[TOKEN, record]]);
  });

  it('write-once: 같은 token 을 다시 쓰면(내용이 같아도 다르면 더욱) DUPLICATE_KEY 이고 저장소는 그대로다', () => {
    const { repo, world } = seeded();
    repo.putBundleConfirmation(makeBundleConfirmation({ baseBundleId: world.bundleId }));
    const before = snapshotOf(repo);

    const same = catchDomainError(() => repo.putBundleConfirmation(makeBundleConfirmation({ baseBundleId: world.bundleId })));
    const different = catchDomainError(() => repo.putBundleConfirmation(makeBundleConfirmation({ baseBundleId: world.bundleId, actorId: 'TEST_FIXTURE_OTHER_ACTOR', configurationDigest: 'c'.repeat(64) })));

    expect(same.code).toBe('DUPLICATE_KEY');
    expect(different.code).toBe('DUPLICATE_KEY');
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('쓸 때 복사해 저장하고 읽을 때 복사해 돌려준다: 호출한 쪽이 입력이나 읽은 값을 바꿔도 저장된 기록은 그대로다', () => {
    const { repo, world } = seeded();
    const record = makeBundleConfirmation({ baseBundleId: world.bundleId });
    repo.putBundleConfirmation(record);
    const stored = snapshotOf(repo);

    record.actorId = 'TEST_FIXTURE_MUTATED';
    record.chosen.push({ kind: 'MAPPING', id: 'TEST_FIXTURE_MUTATED', version: 'v1' });
    const read = repo.getBundleConfirmation(TOKEN);
    expect(read).not.toBeNull();
    (read as NonNullable<typeof read>).consumedAt = TEST_FIXTURE_NOW;
    (read as NonNullable<typeof read>).chosen.length = 0;

    expect(snapshotOf(repo)).toEqual(stored);
    expect(repo.getBundleConfirmation(TOKEN)).toEqual(makeBundleConfirmation({ baseBundleId: world.bundleId }));
  });
});

describe('markBundleConfirmationConsumed', () => {
  it('소비 시각과 결과 묶음을 채우고 다른 필드는 바꾸지 않는다', () => {
    const { repo, world } = seeded();
    const record = makeBundleConfirmation({ baseBundleId: world.bundleId });
    repo.putBundleConfirmation(record);

    repo.markBundleConfirmationConsumed(TOKEN, '2026-10-17T10:00:00.000Z', world.bundleId);

    expect(repo.getBundleConfirmation(TOKEN)).toEqual({ ...record, consumedAt: '2026-10-17T10:00:00.000Z', resultBundleId: world.bundleId });
  });

  it('한 번만 소비된다: 이미 소비된 기록은 STATE_CONFLICT 이고 기록은 처음 소비된 모습 그대로다', () => {
    const { repo, world } = seeded();
    repo.putBundleConfirmation(makeBundleConfirmation({ baseBundleId: world.bundleId }));
    repo.markBundleConfirmationConsumed(TOKEN, '2026-10-17T10:00:00.000Z', world.bundleId);
    const before = snapshotOf(repo);

    const again = catchDomainError(() => repo.markBundleConfirmationConsumed(TOKEN, '2026-10-17T11:00:00.000Z', world.bundleId));

    expect(again.code).toBe('STATE_CONFLICT');
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('없는 기록은 NOT_FOUND, 결과 묶음이 없으면 NOT_FOUND 이고 저장소는 그대로다 (소비되지 않은 채 남는다)', () => {
    const { repo, world } = seeded();
    repo.putBundleConfirmation(makeBundleConfirmation({ baseBundleId: world.bundleId }));
    const before = snapshotOf(repo);

    expect(catchDomainError(() => repo.markBundleConfirmationConsumed('b'.repeat(64), TEST_FIXTURE_NOW, world.bundleId)).code).toBe('NOT_FOUND');
    expect(catchDomainError(() => repo.markBundleConfirmationConsumed(TOKEN, TEST_FIXTURE_NOW, 'TEST_FIXTURE_NO_SUCH_BUNDLE')).code).toBe('NOT_FOUND');

    expect(snapshotOf(repo)).toEqual(before);
    expect(repo.getBundleConfirmation(TOKEN)?.consumedAt).toBeNull();
  });
});

describe('트랜잭션', () => {
  it('던지면 쓰기도 소비도 함께 되돌려진다 (기록이 생기기 전·소비되기 전으로)', () => {
    const { repo, world } = seeded();
    const empty = snapshotOf(repo);
    const boom = new Error('TEST_FIXTURE 되돌림');

    expect(() =>
      repo.transaction(() => {
        repo.putBundleConfirmation(makeBundleConfirmation({ baseBundleId: world.bundleId }));
        throw boom;
      }),
    ).toThrow(boom);
    expect(snapshotOf(repo)).toEqual(empty);
    expect(repo.getBundleConfirmation(TOKEN)).toBeNull();

    repo.putBundleConfirmation(makeBundleConfirmation({ baseBundleId: world.bundleId }));
    const issued = snapshotOf(repo);
    expect(() =>
      repo.transaction(() => {
        repo.markBundleConfirmationConsumed(TOKEN, TEST_FIXTURE_NOW, world.bundleId);
        throw boom;
      }),
    ).toThrow(boom);
    expect(snapshotOf(repo)).toEqual(issued);
    expect(repo.getBundleConfirmation(TOKEN)?.consumedAt).toBeNull();
  });

  it('성공하면 함께 확정된다', () => {
    const { repo, world } = seeded();

    repo.transaction(() => {
      repo.putBundleConfirmation(makeBundleConfirmation({ baseBundleId: world.bundleId }));
      repo.markBundleConfirmationConsumed(TOKEN, TEST_FIXTURE_NOW, world.bundleId);
    });

    expect(repo.getBundleConfirmation(TOKEN)).toMatchObject({ consumedAt: TEST_FIXTURE_NOW, resultBundleId: world.bundleId });
  });
});
