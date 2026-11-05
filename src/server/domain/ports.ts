// 서버 도메인의 포트. 시간과 식별자 생성은 도메인 로직 안에서 직접 만들지 않고 주입받는다
// (Date.now·Math.random·crypto.randomUUID 금지: tests/boundary/server-imports.test.ts 가 막는다).

/** 현재 시각을 ISO 8601 문자열(예: 2026-10-16T09:00:00.000Z)로 돌려주는 시계. */
export interface Clock {
  now(): string;
}

/**
 * 접두어를 받아 새 식별자를 만드는 생성기. 같은 생성기가 같은 접두어로 부르면 매번 다른 값을 돌려준다.
 * 운영 구현은 예측할 수 없는 값(UUID 등)이어야 한다. 비밀로 쓰이는 접두어는 둘이다:
 *  - 'CATALOG_DRAFT_REVISION': 카탈로그 게시 확인값의 비밀 열쇠(publish-confirmation.ts). 어떤 응답에도 실리지 않는다.
 *  - 'BUNDLE_CONFIRMATION': 묶음 게시 확인값의 원료(bundle-compose.ts). 확인값 자체가 이 값에서 파생되어 응답에 실린다. 서버는 그 확인값을 기록으로 들고 있다가 게시 때 기록을 찾아
 *    관리자·구성이 맞는지 대조하므로, 생성기가 예측 가능해도(시험의 순차 번호 생성기처럼) 발급된 적 없는 값·다른 관리자의 기록·다른 구성의 기록은 거절된다. 예측 불가 요건이 막는 것은
 *    "같은 관리자·같은 구성의 기록이 이미 있을 때 그 확인값을 미리보기 응답 없이 알아맞혀 쓰는 것"이다.
 * 순차 번호 같은 예측 가능한 생성기를 운영에 쓰면 이 방어들은 보통의 해시로 내려앉는다.
 */
export interface IdGenerator {
  next(prefix: string): string;
}
