// 서버 로그 출구 (SPEC-REIMBURSEMENT-001 M4.A, design.md DD-09·DD-19, AC-016e·AC-016n).
// 로그 항목의 모양이 사건 이름과 닫힌 코드 하나뿐이다. 환자가 고른 값(세대·보험사 형태·치료 원인·치료 id)이나 키오스크 시도 식별자,
// 요청 본문·헤더·쿼리, 금액, 오류 메시지·스택을 담을 자리가 없다. 시험은 주입한 수집기로 항목을 모아 이 모양을 확인한다.
// 출구는 주입한다: 이 계층은 콘솔·파일·네트워크를 직접 쓰지 않는다.

/** 서버가 남기는 사건의 닫힌 목록. */
export type ServerLogEvent = 'SERVER_INTEGRITY_ERROR' | 'UNEXPECTED_ERROR';

export interface ServerLogEntry {
  readonly event: ServerLogEvent;
  /** SERVER_INTEGRITY_ERROR 는 ServerIntegrityCode 중 하나, UNEXPECTED_ERROR 는 항상 'UNEXPECTED'. 설명 문장이 아니라 코드다. */
  readonly code: string;
}

export interface ServerLog {
  record(entry: ServerLogEntry): void;
}

/** 아무것도 남기지 않는 출구. 운영 구성의 기본값이며 민감한 값을 쓸 수 없다. */
export const silentLog: ServerLog = {
  record(): void {
    // 의도적으로 비어 있다.
  },
};
