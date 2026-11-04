// 서버 도메인의 포트. 시간과 식별자 생성은 도메인 로직 안에서 직접 만들지 않고 주입받는다
// (Date.now·Math.random·crypto.randomUUID 금지: tests/boundary/server-imports.test.ts 가 막는다).

/** 현재 시각을 ISO 8601 문자열(예: 2026-10-16T09:00:00.000Z)로 돌려주는 시계. */
export interface Clock {
  now(): string;
}

/**
 * 접두어를 받아 새 식별자를 만드는 생성기. 같은 생성기가 같은 접두어로 부르면 매번 다른 값을 돌려준다.
 * 운영 구현은 예측할 수 없는 값(UUID 등)이어야 한다: 접두어 'CATALOG_DRAFT_REVISION' 으로 만든 값은 게시 확인값의 비밀 열쇠로 쓰이고
 * (publish-confirmation.ts) 어떤 응답에도 실리지 않는다. 순차 번호 같은 예측 가능한 생성기를 운영에 쓰면 미리보기 없이 게시할 수 있는 확인값을 만들어 낼 수 있다.
 */
export interface IdGenerator {
  next(prefix: string): string;
}
