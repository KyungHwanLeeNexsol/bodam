// 서버 도메인의 포트. 시간과 식별자 생성은 도메인 로직 안에서 직접 만들지 않고 주입받는다
// (Date.now·Math.random·crypto.randomUUID 금지: tests/boundary/server-imports.test.ts 가 막는다).

/** 현재 시각을 ISO 8601 문자열(예: 2026-10-16T09:00:00.000Z)로 돌려주는 시계. */
export interface Clock {
  now(): string;
}

/** 접두어를 받아 새 식별자를 만드는 생성기. 같은 생성기가 같은 접두어로 부르면 매번 다른 값을 돌려준다. */
export interface IdGenerator {
  next(prefix: string): string;
}
