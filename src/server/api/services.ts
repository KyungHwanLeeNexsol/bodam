import type { Origin } from '../../engine/types';
import type { Repository } from '../repo/interfaces';
import type { ServerLog } from './log';

// API 계층이 쓰는 서비스 묶음 (SPEC-REIMBURSEMENT-001 M4.A, design.md DD-04·DD-19).
// 구성(composition)이 만들어 route.ts 의 핸들러에 넘긴다. 핸들러는 이 묶음 밖의 저장소·출구·허용 출처를 알지 못한다.
// 운영 구성(src/server/composition.ts)은 허용 출처로 OPERATING 하나만 넣고, 시험 구성은 tests/ 아래에서 따로 만든다.

/** 규칙 데이터와 줄이 받는 출처. 계산(M4.B)이 엔진의 acceptedOrigins 로 그대로 넘긴다. */
export interface AcceptedOrigins {
  readonly rules: readonly Origin[];
  readonly lines: readonly Origin[];
}

export interface ApiServices {
  readonly repo: Repository;
  readonly log: ServerLog;
  readonly acceptedOrigins: AcceptedOrigins;
}
