import type { ApiFailure } from './api-types';

// 관리자 화면의 유일한 네트워크 출구 (SPEC-REIMBURSEMENT-001 M7 첫 기능). 키오스크의 기본 전송(src/app/kiosk/state/deps.ts)과 같은 방식으로 전역 fetch 를 부르는 파일을 하나로 모은다:
//  - 같은 출처의 상대 경로(`/api/…`)만 부른다. 다른 서버·외부 서비스·분석 도구로 가는 호출이 없다(tests/boundary/admin-surface.test.ts 가 이 파일의 문자열 리터럴을 검사한다).
//  - 쿠키는 브라우저가 같은 출처 요청에 붙이는 그대로이고(credentials 'same-origin') 화면 코드가 인증 값을 읽거나 만들지 않는다.
//  - 응답은 저장하지 않는다(cache: 'no-store'). 이 파일은 요청 값·응답 값을 저장소·주소·로그로 내보내지 않는다.

export interface Api<T> {
  status: number;
  body: T | ApiFailure;
}

export async function adminRequest<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Api<T>> {
  const init: RequestInit = { method, credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (signal !== undefined) init.signal = signal;
  const response = await fetch(path, init);
  let parsed: unknown = {};
  try {
    parsed = await response.json();
  } catch {
    parsed = {};
  }
  return { status: response.status, body: parsed as T | ApiFailure };
}
