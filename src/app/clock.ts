// 판정 기준일의 운영 주입 (SPEC-REIMBURSEMENT-001 M4.B, design.md DD-04·DD-19).
// src/server 는 시계를 읽지 않는다(tests/boundary/server-imports.test.ts). 시스템 시각을 읽는 곳은 src/app 안의 이 파일 하나이고,
// src/app/services.ts 가 이 함수를 운영 서비스에 넣어 준다. 계산 요청은 요청마다 이 함수를 불러 엔진의 `at` 으로 넘긴다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// @MX:NOTE: [AUTO] [문서에 없음] 판정 기준일은 한국 표준시(Asia/Seoul, UTC+9)의 달력 날짜다. 병원은 한국에 있고 규칙 항목의 유효 기간(from~to)은 날짜이므로
// UTC 날짜를 쓰면 한국 자정부터 아침 9시까지 하루 전 날짜로 판정한다. 한국은 일광절약시간이 없어 고정 +9시간 계산이 정확하다.
/** 시각을 한국 표준시 달력 날짜 `YYYY-MM-DD` 로 바꾼다. 입력 시각을 바꾸지 않는다. */
export function seoulDate(instant: Date): string {
  return new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 지금(시스템 시계)의 한국 표준시 날짜. 부를 때마다 시스템 시계를 새로 읽는다. */
export function systemToday(): string {
  return seoulDate(new Date());
}

// 관리자 서비스(M7)가 쓰는 운영 시계와 식별자 생성기. src/server 는 시계·난수를 읽지 않으므로(tests/boundary/server-imports.test.ts) 바깥인 이 폴더가 만든다.
// 상태가 없다: 시계는 부를 때마다 시스템 시각을 읽고, 식별자는 접두어에 무작위 UUID 를 붙인다(모듈 수준 카운터가 없다).

/** 지금(시스템 시계)의 ISO 8601 시각. */
export const systemClock = { now: (): string => new Date().toISOString() };

/** `<접두어>_<UUID>` 식별자. */
export const systemIds = { next: (prefix: string): string => `${prefix}_${crypto.randomUUID()}` };

/** ISO 시각을 한국 표준시 `YYYY-MM-DD HH:MM` 으로 보인다(관리자 게시 이력 표시). 해석할 수 없으면 입력을 그대로 돌려준다. */
export function formatSeoulMinute(iso: string): string {
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? iso : new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}
