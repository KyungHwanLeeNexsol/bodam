// 변경 이력 화면이 읽는 서버 응답의 모양 (SPEC-REIMBURSEMENT-001 M7 변경 이력). GET /api/admin/audit-log 의 응답이다.
// src/app 은 src/server 를 가져오지 않으므로 화면이 쓰는 모양을 여기에 따로 적는다. 서버가 권위이고, 화면은 받은 값이 이 모양이 아니면 불러오지 못한 것으로 본다(change-history-model.ts).

export interface ChangeHistoryEntryView {
  /** 이 병원이 볼 수 있는 기록 안에서의 저장 순서(1 = 가장 먼저 저장). */
  sequence: number;
  at: string;
  actor: { id: string; role: string };
  action: string;
  target: string;
  /** 기록된 그대로다. 초안 저장·폐기와 무조작 정책 저장에서는 내용 지문, 초안 게시에서는 카탈로그 버전 id 다. */
  beforeVersion: string | null;
  afterVersion: string | null;
  reason: string | null;
}

export interface ChangeHistoryResponse {
  clinic: { id: string; displayName: string };
  /** 이 조회가 다루는 동작(서버의 명시적 목록). */
  coveredActions: string[];
  /** 최신순. */
  entries: ChangeHistoryEntryView[];
  page: { limit: number; returned: number; total: number; truncated: boolean };
}
