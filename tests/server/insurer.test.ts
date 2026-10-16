import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '../../src/server/digest';
import type { Insurer } from '../../src/server/domain/entities';
import { saveInsurerRecord } from '../../src/server/insurer';
import { TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { INSURER_FORMER_MUTUAL, INSURER_LIFE, INSURER_NONLIFE, THREE_INSURERS } from '../fixtures/server/governance.fixture';
import { newWorld } from '../fixtures/server/lifecycle.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';

// AC-011d 보험사 기관 분리: 종류가 다른 기관(손해보험·생명보험·과거 공제)은 서로 다른 기관 기록이고 합쳐지지 않는다.
// AC-011d 가 이름으로 든 실제 기관(NH농협손해보험·NH농협생명·과거 농협공제)의 기록은 만들지 않는다(소유자 결정: 실제 보험사 자료를 시드하지 않는다).
// 시험은 같은 구조의 가짜 기록 세 건(NON_LIFE · LIFE · MUTUAL_AID, 모두 TEST_FIXTURE)으로 "종류가 다른 기관이 별개 기록이다"라는 성질을 본다.
// 보험사 관리는 RV 의 일이다(DD-17 권한 표: 보험사·상품·담보·공제형·약관 버전, 약관 출처 관리).

const PERMUTATIONS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

function saveAll(world: ReturnType<typeof newWorld>, records: readonly Insurer[]): void {
  for (const record of records) {
    saveInsurerRecord(world.deps, TEST_FIXTURE_RV_AUTHOR, record);
  }
}

describe('AC-011d 종류가 다른 보험사는 서로 다른 기관 기록이다', () => {
  it('세 기록을 저장하면 기록 세 건이 남고 각각 자기 id 로 자기 종류·이름·별칭을 돌려준다', () => {
    const w = newWorld();
    saveAll(w, THREE_INSURERS);

    expect(w.repo.listInsurers().map((insurer) => insurer.id)).toEqual(['TEST_FIXTURE_INSURER_FORMER_MUTUAL', 'TEST_FIXTURE_INSURER_LIFE', 'TEST_FIXTURE_INSURER_NONLIFE']);
    expect(w.repo.getInsurer(INSURER_NONLIFE.id)).toEqual(INSURER_NONLIFE);
    expect(w.repo.getInsurer(INSURER_LIFE.id)).toEqual(INSURER_LIFE);
    expect(w.repo.getInsurer(INSURER_FORMER_MUTUAL.id)).toEqual(INSURER_FORMER_MUTUAL);
    expect(new Set(w.repo.listInsurers().map((insurer) => insurer.insurerType))).toEqual(new Set(['NON_LIFE', 'LIFE', 'MUTUAL_AID']));
  });

  it.each(PERMUTATIONS)('저장 순서 %i·%i·%i 와 상관없이 같은 세 기록이 남는다', (a, b, c) => {
    const w = newWorld();
    saveAll(w, [THREE_INSURERS[a]!, THREE_INSURERS[b]!, THREE_INSURERS[c]!]);
    expect(w.repo.listInsurers()).toEqual([INSURER_FORMER_MUTUAL, INSURER_LIFE, INSURER_NONLIFE]);
  });

  it('한 기록을 저장해도 다른 기록은 바뀌지 않고, 한 기록을 고쳐 다시 저장해도 그 기록만 바뀐다 (별칭 목록도 기록마다 따로)', () => {
    const w = newWorld();
    saveAll(w, THREE_INSURERS);
    const lifeBefore = w.repo.getInsurer(INSURER_LIFE.id);
    const mutualBefore = w.repo.getInsurer(INSURER_FORMER_MUTUAL.id);

    saveInsurerRecord(w.deps, TEST_FIXTURE_RV_AUTHOR, { ...INSURER_NONLIFE, formerNames: [...INSURER_NONLIFE.formerNames, 'TEST_FIXTURE 새 별칭'], verifiedContact: 'TEST_FIXTURE_CONTACT_NONLIFE' });

    expect(w.repo.getInsurer(INSURER_NONLIFE.id)?.formerNames).toEqual(['TEST_FIXTURE 옛 손해보험 이름', 'TEST_FIXTURE 새 별칭']);
    expect(w.repo.getInsurer(INSURER_LIFE.id)).toEqual(lifeBefore);
    expect(w.repo.getInsurer(INSURER_FORMER_MUTUAL.id)).toEqual(mutualBefore);
    expect(w.repo.getInsurer(INSURER_LIFE.id)?.formerNames).toEqual(INSURER_LIFE.formerNames);
    expect(w.repo.getInsurer(INSURER_FORMER_MUTUAL.id)?.formerNames).toEqual([]);
  });

  it('이름이나 별칭이 겹쳐도 기록은 합쳐지지 않는다 (같은 이름의 다른 종류, 한 기록의 별칭이 다른 기록의 현재 이름)', () => {
    const w = newWorld();
    const nonLife: Insurer = { ...INSURER_NONLIFE, formerNames: ['TEST_FIXTURE 겹치는 이름'] };
    const mutual: Insurer = { ...INSURER_FORMER_MUTUAL, currentName: 'TEST_FIXTURE 겹치는 이름' };
    const sameNameOtherType: Insurer = { ...INSURER_LIFE, currentName: INSURER_NONLIFE.currentName };
    saveAll(w, [nonLife, mutual, sameNameOtherType]);

    expect(w.repo.listInsurers()).toHaveLength(3);
    expect(w.repo.getInsurer(nonLife.id)).toEqual(nonLife);
    expect(w.repo.getInsurer(mutual.id)).toEqual(mutual);
    expect(w.repo.getInsurer(sameNameOtherType.id)).toEqual(sameNameOtherType);
    expect(w.repo.getInsurer(mutual.id)?.insurerType).toBe('MUTUAL_AID');
    expect(w.repo.getInsurer(nonLife.id)?.insurerType).toBe('NON_LIFE');
  });

  it('이름과 종류가 모두 같아도 id 가 다르면 별개 기록이다 (이름으로 기록을 합치지 않는다)', () => {
    const w = newWorld();
    saveAll(w, [INSURER_NONLIFE, { ...INSURER_NONLIFE, id: 'TEST_FIXTURE_INSURER_NONLIFE_TWIN' }]);
    expect(w.repo.listInsurers().map((insurer) => insurer.id)).toEqual(['TEST_FIXTURE_INSURER_NONLIFE', 'TEST_FIXTURE_INSURER_NONLIFE_TWIN']);
  });

  it('[문서에 없음] 이미 있는 기록의 기관 종류는 바꿀 수 없다 (STATE_CONFLICT, 경로 insurerType): 바꾸면 다른 기관 기록이 합쳐지는 것과 같다', () => {
    const w = newWorld();
    saveAll(w, THREE_INSURERS);
    const before = snapshotOf(w.repo);

    for (const insurerType of ['NON_LIFE', 'MUTUAL_AID'] as const) {
      const error = catchDomainError(() => saveInsurerRecord(w.deps, TEST_FIXTURE_RV_AUTHOR, { ...INSURER_LIFE, insurerType }));
      expect(error.code).toBe('STATE_CONFLICT');
      expect(error.defects).toEqual([{ code: 'INSURER_TYPE_CHANGE', path: 'insurerType' }]);
    }
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getInsurer(INSURER_LIFE.id)?.insurerType).toBe('LIFE');
  });

  it('같은 종류로 다시 저장하는 것은 허용되고 감사 기록에는 저장 전후 내용의 정본 해시가 남는다', () => {
    const w = newWorld();
    saveAll(w, [INSURER_LIFE]);
    const revised: Insurer = { ...INSURER_LIFE, currentName: 'TEST_FIXTURE 시험 생명 새 이름', formerNames: [...INSURER_LIFE.formerNames, INSURER_LIFE.currentName] };
    w.clock.set('2026-10-17T07:00:00.000Z');
    saveInsurerRecord(w.deps, TEST_FIXTURE_RV_AUTHOR, revised);

    const audit = w.repo.listAuditLog();
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ actorId: 'TEST_FIXTURE_RV_AUTHOR', role: 'RV', action: 'INSURER_SAVE', target: `INSURER/${INSURER_LIFE.id}`, beforeVersion: null, afterVersion: canonicalDigest(INSURER_LIFE), reason: null });
    expect(audit[1]).toMatchObject({ action: 'INSURER_SAVE', beforeVersion: canonicalDigest(INSURER_LIFE), afterVersion: canonicalDigest(revised), at: '2026-10-17T07:00:00.000Z' });
  });
});

describe('보험사 저장 서비스의 역할·입력 검사', () => {
  it.each([TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1])('RV 가 아닌 역할 %o 는 저장할 수 없다 (ROLE_NOT_PERMITTED, 저장소 전후 비교가 같다)', (actor) => {
    const w = newWorld();
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => saveInsurerRecord(w.deps, actor, INSURER_LIFE)).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  const badInputs: ReadonlyArray<[string, (base: Insurer) => unknown, string, string]> = [
    ['id 가 빈 문자열', (b) => ({ ...b, id: '' }), 'EMPTY', 'id'],
    ['id 가 공백뿐', (b) => ({ ...b, id: '  ' }), 'EMPTY', 'id'],
    ['id 가 숫자', (b) => ({ ...b, id: 7 }), 'EMPTY', 'id'],
    ['id 가 없음', ({ id: _id, ...rest }) => rest, 'EMPTY', 'id'],
    ['종류가 목록 밖', (b) => ({ ...b, insurerType: 'OTHER' }), 'VALUE_INVALID', 'insurerType'],
    ['종류가 소문자', (b) => ({ ...b, insurerType: 'life' }), 'VALUE_INVALID', 'insurerType'],
    ['종류 뒤에 공백', (b) => ({ ...b, insurerType: 'LIFE ' }), 'VALUE_INVALID', 'insurerType'],
    ['종류가 없음', ({ insurerType: _t, ...rest }) => rest, 'VALUE_MISSING', 'insurerType'],
    ['종류가 null', (b) => ({ ...b, insurerType: null }), 'VALUE_MISSING', 'insurerType'],
    ['현재 이름이 빈 문자열', (b) => ({ ...b, currentName: '' }), 'EMPTY', 'currentName'],
    ['현재 이름이 공백뿐', (b) => ({ ...b, currentName: ' \t' }), 'EMPTY', 'currentName'],
    ['현재 이름이 숫자', (b) => ({ ...b, currentName: 1 }), 'EMPTY', 'currentName'],
    ['별칭 목록이 배열이 아님', (b) => ({ ...b, formerNames: 'TEST_FIXTURE 옛 이름' }), 'VALUE_INVALID', 'formerNames'],
    ['별칭 목록이 없음', ({ formerNames: _f, ...rest }) => rest, 'VALUE_MISSING', 'formerNames'],
    ['별칭 중 빈 문자열', (b) => ({ ...b, formerNames: ['TEST_FIXTURE 옛 이름', ''] }), 'EMPTY', 'formerNames[1]'],
    ['별칭 중 숫자', (b) => ({ ...b, formerNames: [3] }), 'EMPTY', 'formerNames[0]'],
    ['검증된 연락처가 숫자', (b) => ({ ...b, verifiedContact: 5 }), 'VALUE_INVALID', 'verifiedContact'],
    ['검증된 연락처가 없음(undefined)', ({ verifiedContact: _v, ...rest }) => rest, 'VALUE_MISSING', 'verifiedContact'],
  ];

  it.each(badInputs)('입력 오류: %s → INVALID_INPUT, 경로를 알리고 아무것도 저장하지 않는다', (_name, make, code, path) => {
    const w = newWorld();
    saveAll(w, [INSURER_NONLIFE]);
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => saveInsurerRecord(w.deps, TEST_FIXTURE_RV_AUTHOR, make(INSURER_LIFE)));
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.defects).toContainEqual({ code, path });
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it.each([null, undefined, 'TEST_FIXTURE', 42, [INSURER_LIFE]])('입력이 객체가 아니면(%j) INVALID_INPUT, 경로 (루트)이고 아무것도 저장하지 않는다', (input) => {
    const w = newWorld();
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => saveInsurerRecord(w.deps, TEST_FIXTURE_RV_AUTHOR, input as unknown as Insurer));
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.defects).toEqual([{ code: 'VALUE_INVALID', path: '' }]);
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('여러 결함은 한꺼번에 고정된 순서(id, 종류, 현재 이름, 별칭, 연락처)로 알린다', () => {
    const w = newWorld();
    const error = catchDomainError(() =>
      saveInsurerRecord(w.deps, TEST_FIXTURE_RV_AUTHOR, { id: '', insurerType: 'X', currentName: '', formerNames: [''], verifiedContact: 1 } as unknown as Insurer),
    );
    expect(error.defects.map((defect) => defect.path)).toEqual(['id', 'insurerType', 'currentName', 'formerNames[0]', 'verifiedContact']);
  });

  it('알 수 없는 필드는 저장하지 않고, 저장한 기록은 호출자의 객체와 분리된다', () => {
    const w = newWorld();
    const input = { ...structuredClone(INSURER_LIFE), selfApproval: true, extra: { nested: 1 } };
    const stored = saveInsurerRecord(w.deps, TEST_FIXTURE_RV_AUTHOR, input as Insurer);
    expect(stored).toEqual(INSURER_LIFE);
    expect(w.repo.getInsurer(INSURER_LIFE.id)).toEqual(INSURER_LIFE);

    input.formerNames.push('TEST_FIXTURE 나중에 고친 값');
    stored.formerNames.push('TEST_FIXTURE 돌려받은 값을 고침');
    expect(w.repo.getInsurer(INSURER_LIFE.id)).toEqual(INSURER_LIFE);
  });

  it('이름은 다듬거나 유니코드를 정규화하지 않고 쓴 그대로 저장한다', () => {
    const w = newWorld();
    const decomposed = 'TEST_FIXTURE 한글 한 ';
    saveInsurerRecord(w.deps, TEST_FIXTURE_RV_AUTHOR, { ...INSURER_LIFE, currentName: decomposed });
    expect(w.repo.getInsurer(INSURER_LIFE.id)?.currentName).toBe(decomposed);
  });

  it('감사 기록 id 가 이미 쓰였으면 저장 전체가 되돌려진다', () => {
    const w = newWorld();
    saveAll(w, [INSURER_NONLIFE]);
    const taken = w.repo.listAuditLog()[0]!.id;
    const before = snapshotOf(w.repo);
    const deps = { ...w.deps, ids: { next: (prefix: string) => (prefix === 'AUDIT' ? taken : w.ids.next(prefix)) } };
    expect(catchDomainError(() => saveInsurerRecord(deps, TEST_FIXTURE_RV_AUTHOR, INSURER_LIFE)).code).toBe('DUPLICATE_KEY');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getInsurer(INSURER_LIFE.id)).toBeNull();
  });
});

describe('실제 기관명을 시드하지 않는다 (소유자 결정: 실제 보험사 자료 없음)', () => {
  it('시험 자료의 기관 기록은 모두 TEST_FIXTURE 표지가 있고 AC-011d 의 실제 기관명을 담지 않는다', () => {
    for (const record of THREE_INSURERS) {
      expect(record.id.startsWith('TEST_FIXTURE_')).toBe(true);
      expect(record.currentName.startsWith('TEST_FIXTURE')).toBe(true);
      expect(JSON.stringify(record)).not.toMatch(/농협|NH/);
    }
  });
});
