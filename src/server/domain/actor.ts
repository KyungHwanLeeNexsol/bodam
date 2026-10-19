import { DomainError } from './errors';

// 행위자와 역할 (design.md DD-17). 도메인 서비스는 역할만 본다.
// 병원 소유 확인, 소속, 인증, 401/403 변환은 M7(AC-022a)이 하며 여기에 구현하지 않는다.

/** 병원 관리자(HA) · 보험 기준 검토 담당자(RV) · 플랫폼 운영자(PO). */
export const ROLES = ['HA', 'RV', 'PO'] as const;
export type Role = (typeof ROLES)[number];

export interface Actor {
  id: string;
  role: Role;
}

/**
 * 행위자의 역할이 allowed 중 하나가 아니면 ROLE_NOT_PERMITTED 를 던진다. 허용 역할을 하나도 넘기지 않으면 모두 거절한다.
 * 알 수 없는 역할 값은 허용으로 추정하지 않는다.
 */
export function requireRole(actor: Actor, ...allowed: readonly Role[]): void {
  if (!allowed.includes(actor.role)) {
    throw new DomainError('ROLE_NOT_PERMITTED', `역할 ${String(actor.role)} 은(는) 이 동작을 할 수 없다 (필요: ${allowed.join('|') || '없음'})`);
  }
}
