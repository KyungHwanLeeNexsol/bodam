import type { ApiFailure } from './api-types';
import { ADMIN_COPY as COPY } from './copy';
import type { Api } from './transport';

// 서버 거절을 사람이 읽는 문장으로 바꾼다 (SPEC-REIMBURSEMENT-001 M7). 코드를 그대로 보이지 않고, 무엇이 바뀌지 않았는지와 입력이 화면에 남아 있다는 사실을 함께 알린다.
// 순수 함수다: 응답(상태·본문)만 읽는다. 서버가 권위이고 이 파일은 문구를 고르기만 한다.

/** 거절된 동작의 종류: 뒤에 붙는 "바뀌지 않았다"는 말이 동작마다 다르다. */
export type FailureKind = keyof typeof COPY.nothingChanged;

export function failureMessage(result: Api<unknown>, kind: FailureKind): string {
  const failure = result.body as ApiFailure;
  let core: string;
  if (result.status === 401) {
    core = COPY.unauthenticated;
  } else if (result.status === 403) {
    core = COPY.forbidden;
  } else if (result.status === 409) {
    core =
      failure.reason === 'PREVIEW_REQUIRED'
        ? COPY.errors.previewRequired
        : failure.reason === 'DRAFT_STALE'
          ? COPY.errors.stale
          : failure.reason === 'DRAFT_ABSENT'
            ? COPY.errors.absent
            : failure.reason === 'CATALOG_ABSENT'
              ? COPY.errors.catalogAbsent
              : COPY.errors.generic;
  } else if (result.status === 400) {
    const messages = [...new Set((failure.defects ?? []).map((defect) => COPY.errors.defects[defect.code]).filter((text): text is string => text !== undefined))];
    core = messages.length > 0 ? messages.slice(0, 3).join(' ') : COPY.errors.generic;
  } else {
    core = result.status >= 500 ? COPY.errors.server : COPY.errors.generic;
  }
  return `${core} ${COPY.nothingChanged[kind]}`;
}
