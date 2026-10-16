import type { Actor } from '../../../src/server/domain/actor';

// 시험 자료(TEST_FIXTURE). 아래 작성자·승인자·관리자·운영자는 모두 가짜 주체이며
// 실제 운영 계정·담당자·승인 기록이 등록되었다는 뜻이 아니다 (plan.md §E #31·#34).

/** 규칙 데이터를 쓰는 보험 기준 검토 담당자(RV) 시험 주체. */
export const TEST_FIXTURE_RV_AUTHOR: Actor = { id: 'TEST_FIXTURE_RV_AUTHOR', role: 'RV' };
/** 작성자와 다른 주체여야 하는 승인자(RV) 시험 주체. */
export const TEST_FIXTURE_RV_APPROVER: Actor = { id: 'TEST_FIXTURE_RV_APPROVER', role: 'RV' };
/** 병원 관리자(HA) 시험 주체. */
export const TEST_FIXTURE_HA_1: Actor = { id: 'TEST_FIXTURE_HA_1', role: 'HA' };
/** 플랫폼 운영자(PO) 시험 주체. */
export const TEST_FIXTURE_PO_1: Actor = { id: 'TEST_FIXTURE_PO_1', role: 'PO' };

export const TEST_FIXTURE_CLINIC_ID = 'TEST_FIXTURE_CLINIC_1';
