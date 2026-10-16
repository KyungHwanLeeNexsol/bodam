import type { Clock, IdGenerator } from '../../../src/server/domain/ports';

// 시험 자료(TEST_FIXTURE). 서버 도메인 시험이 쓰는 결정적 시계와 식별자 생성기다.
// 도메인 로직은 Date.now·Math.random·crypto.randomUUID 를 쓰지 않고 이 두 포트를 주입받는다.

/** 값이 고정된 시계. set 으로만 바뀌며 스스로 흐르지 않는다. */
export class FixedClock implements Clock {
  private current: string;

  constructor(start = '2026-10-16T09:00:00.000Z') {
    this.current = start;
  }

  now(): string {
    return this.current;
  }

  set(next: string): void {
    this.current = next;
  }
}

/** 접두어마다 1부터 세는 식별자 생성기. 만든 식별자는 눈에 띄게 TEST_FIXTURE_ 로 시작한다. */
export class CounterIdGenerator implements IdGenerator {
  private readonly counters = new Map<string, number>();

  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `TEST_FIXTURE_${prefix}_${n}`;
  }
}
