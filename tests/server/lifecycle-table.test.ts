import { describe, expect, it } from 'vitest';
import type { LifecycleState } from '../../src/engine/types';
import { LIFECYCLE_STATES, LIFECYCLE_TRANSITIONS, assertTransition, isTransitionAllowed } from '../../src/server/lifecycle';
import { ALL_STATES } from '../fixtures/server/lifecycle.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';

// 생명주기 상태 기계 (design.md DD-17 "생명주기" 표). 프로필·매핑·서류 규칙 묶음이 같은 표 하나를 쓴다.
// 허용 전이 11개를 시험이 직접 적어 두고(DAMP), 9 × 9 = 81쌍 전부를 표와 맞춘다.

/** DD-17 표에서 읽은 허용 전이 전부 (from → to). 이 목록 밖의 쌍은 모두 거절이다. */
const ALLOWED: ReadonlyArray<readonly [LifecycleState, LifecycleState]> = [
  ['DRAFT', 'REVIEW_REQUESTED'],
  ['REVIEW_REQUESTED', 'APPROVED'],
  ['REVIEW_REQUESTED', 'REJECTED'],
  ['APPROVED', 'PUBLISHED'],
  ['APPROVED', 'UNDER_REREVIEW'],
  ['PUBLISHED', 'SUSPENDED'],
  ['PUBLISHED', 'SUPERSEDED'],
  ['PUBLISHED', 'UNDER_REREVIEW'],
  ['PUBLISHED', 'EXPIRED'],
  ['UNDER_REREVIEW', 'APPROVED'],
  ['UNDER_REREVIEW', 'REJECTED'],
];

const pairs: Array<[LifecycleState, LifecycleState, boolean]> = ALL_STATES.flatMap((from) =>
  ALL_STATES.map((to): [LifecycleState, LifecycleState, boolean] => [from, to, ALLOWED.some(([a, b]) => a === from && b === to)]),
);

describe('생명주기 전이 표 (DD-17)', () => {
  it('상태는 DD-17 의 아홉 가지 전부이고 시험의 목록과 같다', () => {
    expect([...LIFECYCLE_STATES].sort()).toEqual([...ALL_STATES].sort());
    expect(LIFECYCLE_STATES).toHaveLength(9);
  });

  it('시험이 적은 쌍은 9 × 9 = 81쌍이고 허용은 11쌍이다', () => {
    expect(pairs).toHaveLength(81);
    expect(pairs.filter(([, , allowed]) => allowed)).toHaveLength(11);
  });

  it.each(pairs)('%s → %s : 허용=%s', (from, to, allowed) => {
    expect(isTransitionAllowed(from, to)).toBe(allowed);
    if (allowed) {
      expect(() => assertTransition(from, to)).not.toThrow();
    } else {
      const error = catchDomainError(() => assertTransition(from, to));
      expect(error.code).toBe('STATE_CONFLICT');
      expect(error.message).toContain(from);
      expect(error.message).toContain(to);
      expect(error.defects).toEqual([{ code: 'TRANSITION_NOT_ALLOWED', path: 'state' }]);
    }
  });

  it('표를 데이터로 내보낸다: 상태마다 나가는 전이 목록이고, 시험의 목록과 일치한다', () => {
    for (const state of ALL_STATES) {
      const expected = ALLOWED.filter(([from]) => from === state).map(([, to]) => to);
      expect([...LIFECYCLE_TRANSITIONS[state]].sort()).toEqual([...expected].sort());
    }
  });

  it('REJECTED·SUSPENDED·SUPERSEDED·EXPIRED 는 나가는 전이가 없다 (새 버전으로만 이어진다)', () => {
    for (const terminal of ['REJECTED', 'SUSPENDED', 'SUPERSEDED', 'EXPIRED'] as const) {
      expect(LIFECYCLE_TRANSITIONS[terminal]).toEqual([]);
      for (const to of ALL_STATES) {
        expect(isTransitionAllowed(terminal, to)).toBe(false);
      }
    }
  });

  it('제자리 전이(같은 상태로)는 어느 상태에서도 허용되지 않는다', () => {
    for (const state of ALL_STATES) {
      expect(isTransitionAllowed(state, state)).toBe(false);
    }
  });

  it('표는 얼려 있어 실행 중에 바꿀 수 없다', () => {
    expect(Object.isFrozen(LIFECYCLE_TRANSITIONS)).toBe(true);
    for (const state of ALL_STATES) {
      expect(Object.isFrozen(LIFECYCLE_TRANSITIONS[state])).toBe(true);
    }
    expect(Object.isFrozen(LIFECYCLE_STATES)).toBe(true);
  });

  it('알 수 없는 상태 값(상속 속성 이름 포함)은 어느 쪽에 놓여도 허용으로 추정하지 않는다', () => {
    for (const bogus of ['BOGUS', 'constructor', '__proto__', 'toString', '']) {
      expect(isTransitionAllowed(bogus as LifecycleState, 'APPROVED')).toBe(false);
      expect(isTransitionAllowed('DRAFT', bogus as LifecycleState)).toBe(false);
      expect(catchDomainError(() => assertTransition(bogus as LifecycleState, 'DRAFT')).code).toBe('STATE_CONFLICT');
    }
  });
});
