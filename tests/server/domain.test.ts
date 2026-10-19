import { describe, expect, it } from 'vitest';
import { requireRole } from '../../src/server/domain/actor';
import type { Actor } from '../../src/server/domain/actor';
import { DOMAIN_ERROR_CODES, DomainError } from '../../src/server/domain/errors';
import { toEngineDocumentRuleSet, toEngineMapping, toEngineProfile } from '../../src/server/domain/projection';
import { appendAudit } from '../../src/server/audit';
import { CounterIdGenerator, FixedClock } from '../fixtures/server/clock.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { documentRuleSetRecord, mappingRecord, profileRecord } from '../fixtures/server/items.fixture';
import { newRepo, snapshotOf } from '../fixtures/server/repo.fixture';

// 도메인 기반: 오류 형식, 역할 확인, 감사 기록, 불변 내용 + 현재 상태 → 엔진 형식 합성.

describe('DomainError', () => {
  it('안정적인 문자열 code, 사람이 읽는 message, 비어 있는 defects 를 가진다', () => {
    const error = new DomainError('NOT_FOUND', '없다');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.name).toBe('DomainError');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('없다');
    expect(error.defects).toEqual([]);
  });

  it('필드 경로가 붙은 결함 목록을 담는다', () => {
    const defects = [{ code: 'RATE_OUT_OF_RANGE', path: 'bundle.profiles[2].groups[0].deduction.rate' }];
    const error = new DomainError('IMMUTABLE_VERSION', '막힘', defects);
    expect(error.defects).toEqual(defects);
  });

  it('결함 목록은 호출자 배열과 분리된다', () => {
    const defects = [{ code: 'A', path: 'x' }];
    const error = new DomainError('NOT_FOUND', 'm', defects);
    defects.push({ code: 'B', path: 'y' });
    expect(error.defects).toEqual([{ code: 'A', path: 'x' }]);
  });

  it('오류 코드는 닫힌 목록이며 HTTP 개념(INVALID_REQUEST, 상태 코드)이 없다', () => {
    // M3.A 의 여섯 코드에 M3.B 가 다섯 코드를, M3.C 가 PUBLISH_VALIDATION_FAILED 하나를 더했다 (이미 있는 코드의 뜻은 바꾸지 않는다).
    expect([...DOMAIN_ERROR_CODES].sort()).toEqual(
      [
        'DUPLICATE_KEY',
        'IMMUTABLE_VERSION',
        'INVALID_INPUT',
        'NOT_FOUND',
        'NOT_ITEM_AUTHOR',
        'PUBLISH_VALIDATION_FAILED',
        'REASON_REQUIRED',
        'REF_CONTENT_MISMATCH',
        'ROLE_NOT_PERMITTED',
        'SELF_APPROVAL_FORBIDDEN',
        'STATE_CONFLICT',
        'TREATMENT_VERSION_ABSENT',
      ].sort(),
    );
    for (const code of DOMAIN_ERROR_CODES) {
      expect(code).not.toMatch(/HTTP|INVALID_REQUEST|\d{3}/);
    }
  });
});

describe('requireRole (역할 확인만, 소유·인증은 아님)', () => {
  const table: Array<[Actor, readonly ('HA' | 'RV' | 'PO')[], boolean]> = [
    [TEST_FIXTURE_RV_AUTHOR, ['RV'], true],
    [TEST_FIXTURE_HA_1, ['RV'], false],
    [TEST_FIXTURE_PO_1, ['RV'], false],
    [TEST_FIXTURE_HA_1, ['HA'], true],
    [TEST_FIXTURE_PO_1, ['PO'], true],
    [TEST_FIXTURE_RV_AUTHOR, ['HA', 'PO'], false],
    [TEST_FIXTURE_PO_1, ['HA', 'PO'], true],
  ];

  it.each(table)('%o 가 %o 를 요구하면 허용=%s', (actor, allowed, ok) => {
    if (ok) {
      expect(() => requireRole(actor, ...allowed)).not.toThrow();
    } else {
      expect(catchDomainError(() => requireRole(actor, ...allowed)).code).toBe('ROLE_NOT_PERMITTED');
    }
  });

  it('알 수 없는 역할 값은 거절한다', () => {
    const forged = { id: 'TEST_FIXTURE_X', role: 'ADMIN' } as unknown as Actor;
    expect(catchDomainError(() => requireRole(forged, 'RV')).code).toBe('ROLE_NOT_PERMITTED');
  });

  it('허용 역할을 하나도 넘기지 않으면 모두 거절한다', () => {
    expect(catchDomainError(() => requireRole(TEST_FIXTURE_RV_AUTHOR)).code).toBe('ROLE_NOT_PERMITTED');
  });
});

describe('appendAudit (감사 기록)', () => {
  it('수행자 id·역할, 동작, 대상, 이전/이후 버전, 사유, 시각을 남긴다', () => {
    const repo = newRepo();
    const clock = new FixedClock('2026-10-16T10:11:12.000Z');
    const entry = appendAudit({ repo, clock, ids: new CounterIdGenerator() }, TEST_FIXTURE_RV_AUTHOR, {
      action: 'TEST_FIXTURE_APPROVE',
      target: 'PROFILE/TEST_PROFILE_1',
      beforeVersion: 'v1',
      afterVersion: 'v2',
      reason: 'TEST_FIXTURE 사유',
    });
    expect(entry).toEqual({
      id: 'TEST_FIXTURE_AUDIT_1',
      actorId: 'TEST_FIXTURE_RV_AUTHOR',
      role: 'RV',
      action: 'TEST_FIXTURE_APPROVE',
      target: 'PROFILE/TEST_PROFILE_1',
      beforeVersion: 'v1',
      afterVersion: 'v2',
      reason: 'TEST_FIXTURE 사유',
      at: '2026-10-16T10:11:12.000Z',
    });
    expect(repo.listAuditLog()).toEqual([entry]);
  });

  it('시각은 주입한 시계에서만 온다 (시계를 옮기면 다음 기록이 따라간다)', () => {
    const repo = newRepo();
    const clock = new FixedClock('2026-01-01T00:00:00.000Z');
    const deps = { repo, clock, ids: new CounterIdGenerator() };
    const input = { action: 'A', target: 'T', beforeVersion: null, afterVersion: null, reason: null };
    appendAudit(deps, TEST_FIXTURE_PO_1, input);
    clock.set('2027-02-02T00:00:00.000Z');
    appendAudit(deps, TEST_FIXTURE_PO_1, input);
    expect(repo.listAuditLog().map((entry) => entry.at)).toEqual(['2026-01-01T00:00:00.000Z', '2027-02-02T00:00:00.000Z']);
    expect(repo.listAuditLog().map((entry) => entry.id)).toEqual(['TEST_FIXTURE_AUDIT_1', 'TEST_FIXTURE_AUDIT_2']);
  });

  it('감사 기록 필드에 selfApproval 같은 승인 우회 표지가 없다 (결정 #31)', () => {
    const repo = newRepo();
    const entry = appendAudit({ repo, clock: new FixedClock(), ids: new CounterIdGenerator() }, TEST_FIXTURE_RV_APPROVER, {
      action: 'A',
      target: 'T',
      beforeVersion: null,
      afterVersion: null,
      reason: null,
    });
    expect(Object.keys(entry).sort()).toEqual(['action', 'actorId', 'afterVersion', 'at', 'beforeVersion', 'id', 'reason', 'role', 'target']);
  });

  it('트랜잭션이 되돌려지면 감사 기록도 함께 사라진다', () => {
    const repo = newRepo();
    const before = snapshotOf(repo);
    expect(() =>
      repo.transaction(() => {
        appendAudit({ repo, clock: new FixedClock(), ids: new CounterIdGenerator() }, TEST_FIXTURE_HA_1, {
          action: 'A',
          target: 'T',
          beforeVersion: null,
          afterVersion: null,
          reason: null,
        });
        throw new Error('되돌림');
      }),
    ).toThrow('되돌림');
    expect(snapshotOf(repo)).toEqual(before);
  });
});

describe('항목 내용 + 현재 상태 → 엔진 형식 (DD-14 항목 생명주기 상태와 캐시 계약)', () => {
  it('프로필: 내용은 그대로, state 와 approver 는 상태 기록에서 온다', () => {
    const record = profileRecord();
    const engine = toEngineProfile(record, { ref: record.ref, state: 'PUBLISHED', approver: { approverId: 'TEST_FIXTURE_RV_APPROVER', approvedAt: '2026-01-02' }, approvedFingerprint: null });
    expect(engine.state).toBe('PUBLISHED');
    expect(engine.approver).toEqual({ approverId: 'TEST_FIXTURE_RV_APPROVER', approvedAt: '2026-01-02' });
    expect(engine.id).toBe(record.content.id);
    expect(engine.groups).toEqual(record.content.groups);
    expect(engine.contentHash).toBe(record.content.contentHash);
  });

  it('같은 내용에 다른 상태를 채우면 상태만 달라진다', () => {
    const record = mappingRecord();
    const published = toEngineMapping(record, { ref: record.ref, state: 'PUBLISHED', approver: { approverId: 'A', approvedAt: 'T' }, approvedFingerprint: 'TEST_FIXTURE_FP' });
    const suspended = toEngineMapping(record, { ref: record.ref, state: 'SUSPENDED', approver: { approverId: 'A', approvedAt: 'T' }, approvedFingerprint: 'TEST_FIXTURE_FP' });
    expect({ ...published, state: 'X' }).toEqual({ ...suspended, state: 'X' });
    expect(published.state).toBe('PUBLISHED');
    expect(suspended.state).toBe('SUSPENDED');
  });

  it('매핑: approvedFingerprint 는 내용이 아니라 상태 기록에서 온다 (승인 시점의 사실, M3.B 결정)', () => {
    const record = mappingRecord();
    expect(Object.keys(record.content)).not.toContain('approvedFingerprint');
    const first = toEngineMapping(record, { ref: record.ref, state: 'PUBLISHED', approver: { approverId: 'A', approvedAt: 'T' }, approvedFingerprint: 'TEST_FIXTURE_FP_1' });
    const second = toEngineMapping(record, { ref: record.ref, state: 'PUBLISHED', approver: { approverId: 'A', approvedAt: 'T' }, approvedFingerprint: 'TEST_FIXTURE_FP_2' });
    expect(first.approvedFingerprint).toBe('TEST_FIXTURE_FP_1');
    expect(second.approvedFingerprint).toBe('TEST_FIXTURE_FP_2');
  });

  it('매핑: 고정된 지문이 아직 없으면(null) 엔진 형식에는 빈 문자열이 들어가 무결성 판정이 막는다', () => {
    const record = mappingRecord();
    const engine = toEngineMapping(record, { ref: record.ref, state: 'DRAFT', approver: null, approvedFingerprint: null });
    expect(engine.approvedFingerprint).toBe('');
  });

  it('서류 규칙 묶음도 같은 방식이고 승인자가 없으면 null 이다', () => {
    const record = documentRuleSetRecord();
    const engine = toEngineDocumentRuleSet(record, { ref: record.ref, state: 'DRAFT', approver: null, approvedFingerprint: null });
    expect(engine.state).toBe('DRAFT');
    expect(engine.approver).toBeNull();
    expect(engine.rules).toEqual(record.content.rules);
  });

  it('입력(내용 기록, 상태 값)을 바꾸지 않고 결과는 입력과 깊이 분리된다', () => {
    const record = profileRecord();
    const state = { ref: record.ref, state: 'PUBLISHED' as const, approver: { approverId: 'A', approvedAt: 'T' }, approvedFingerprint: null };
    const recordBefore = structuredClone(record);
    const stateBefore = structuredClone(state);
    const engine = toEngineProfile(record, state);
    expect(record).toEqual(recordBefore);
    expect(state).toEqual(stateBefore);
    engine.groups.push({ groupKey: 'MUTATED', deduction: { kind: 'FIXED', fixed: 1 }, limit: { kind: 'UNLIMITED_DECLARED', policyClauseRef: 'x' } });
    engine.groupOrder.push('MUTATED');
    engine.policySources[0]!.clauseOrPage = 'MUTATED';
    expect(record).toEqual(recordBefore);
    expect(state.approver).toEqual(stateBefore.approver);
  });

  it('상태 기록이 다른 항목의 것이면 거절한다 (REF_CONTENT_MISMATCH)', () => {
    const record = profileRecord();
    const other = profileRecord({ id: 'TEST_PROFILE_OTHER' });
    for (const bad of [other.ref, { ...record.ref, version: 'v9' }, { ...record.ref, kind: 'MAPPING' as const }]) {
      expect(catchDomainError(() => toEngineProfile(record, { ref: bad, state: 'PUBLISHED', approver: null, approvedFingerprint: null })).code).toBe('REF_CONTENT_MISMATCH');
    }
  });

  it('저장소에서 읽은 내용과 상태로 합성해도 같다 (내용을 한 번 읽어 두고 상태만 다시 읽는 흐름)', () => {
    const repo = newRepo();
    const record = profileRecord();
    repo.putItemVersion(record);
    repo.recordItemTransition(record.ref, { from: null, to: 'PUBLISHED', actor: TEST_FIXTURE_RV_AUTHOR, at: 'T0', reason: null, approverAfter: { approverId: 'A', approvedAt: 'T0' }, approvedFingerprintAfter: null });
    const cached = repo.getItemVersion(record.ref);
    expect(cached).not.toBeNull();
    const first = repo.readItemStates([record.ref])[0];
    repo.recordItemTransition(record.ref, { from: 'PUBLISHED', to: 'SUSPENDED', actor: TEST_FIXTURE_RV_AUTHOR, at: 'T1', reason: 'TEST_FIXTURE 중지', approverAfter: { approverId: 'A', approvedAt: 'T0' }, approvedFingerprintAfter: null });
    const second = repo.readItemStates([record.ref])[0];
    expect(cached).toEqual(repo.getItemVersion(record.ref));
    expect(toEngineProfile(cached as typeof record, first!).state).toBe('PUBLISHED');
    expect(toEngineProfile(cached as typeof record, second!).state).toBe('SUSPENDED');
  });
});
