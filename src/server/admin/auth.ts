import { ROLES } from '../domain/actor';
import type { Actor, Role } from '../domain/actor';

// 관리자 인증·권한 경계 (SPEC-REIMBURSEMENT-001 M7, design.md DD-17 권한 표·DD-19 관리자 API, REQ-ADM-001, AC-022a).
// 실제 인증 공급자는 아직 정해지지 않았다(plan.md §E #2). 이 파일은 공급자가 정해져도 바뀌지 않을 경계만 정한다:
//  - 신원은 오직 AdminAuthenticator(서버가 공급자로 검증한 결과)에서 온다. 요청의 헤더·쿼리·본문에 적힌 역할·병원·사용자 id 는 어디에서도 읽지 않는다.
//  - 신원 = 사용자 id + 병원 소속 목록(병원, 역할). 판정은 이 목록만 본다: 병원 id 가 경로에 있어도 소속에 없으면 403 이다(slug·경로는 권한이 아니다, DD-19).
//  - 인증이 없으면 401, 인증은 됐으나 역할·병원 소속이 맞지 않으면 403 이다(admin/router.ts).
// 운영 구성은 공급자가 연결되기 전까지 UNCONNECTED_ADMIN_AUTHENTICATOR 하나만 쓴다: 어떤 요청도 인증하지 않으므로 운영에서 관리자 기능은 모두 401 이다.
// 시험 계정은 tests/ 의 로컬 구성이 만든 인증기로만 주입한다. 운영 구성에 시험 로그인·기본 관리자·헤더로 역할을 정하는 길은 없다.

/** 한 병원에서의 역할. 플랫폼 운영자(PO)처럼 병원에 매이지 않는 역할은 clinicId 가 null 이다. */
export interface AdminMembership {
  readonly clinicId: string | null;
  readonly role: Role;
}

/** 서버가 검증한 관리자 신원. */
export interface AdminIdentity {
  readonly userId: string;
  readonly memberships: readonly AdminMembership[];
}

/**
 * 요청에서 관리자 신원을 검증해 돌려준다. 인증되지 않았으면 null 이다. 구현은 실패를 null 로 내야 하지만, 던져도 라우터가 인증되지 않은 것(401)으로 본다(닫힌 쪽으로 실패).
 * 구현은 서버가 신뢰하는 근거(공급자가 서명한 세션 등)만 읽어야 한다.
 */
export interface AdminAuthenticator {
  authenticate(request: Request): Promise<AdminIdentity | null>;
}

/** 인증 공급자가 연결되지 않은 상태: 아무도 인증하지 않는다. 운영 구성이 쓰는 유일한 인증기다. */
export const UNCONNECTED_ADMIN_AUTHENTICATOR: AdminAuthenticator = Object.freeze({
  authenticate: (): Promise<AdminIdentity | null> => Promise.resolve(null),
});

/** 인증기가 낸 값이 신원 모양이 아니면(공급자 결함) 인증되지 않은 것으로 본다. 소속의 역할이 닫힌 목록 밖이면 그 소속은 버린다. */
export function normalizeIdentity(value: unknown): AdminIdentity | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { userId, memberships } = value as { userId?: unknown; memberships?: unknown };
  if (typeof userId !== 'string' || userId === '' || !Array.isArray(memberships)) {
    return null;
  }
  const kept: AdminMembership[] = [];
  for (const entry of memberships as unknown[]) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const { clinicId, role } = entry as { clinicId?: unknown; role?: unknown };
    if ((typeof clinicId === 'string' && clinicId !== '') || clinicId === null) {
      if (typeof role === 'string' && (ROLES as readonly string[]).includes(role)) {
        kept.push({ clinicId, role: role as Role });
      }
    }
  }
  return { userId, memberships: kept };
}

/**
 * 그 병원에서 그 역할로 일할 수 있는 신원이면 행위자(도메인 서비스가 받는 값)를 돌려주고, 아니면 null 이다.
 * 병원 id 가 정확히 같은 소속만 인정한다(null 병원 소속 = 플랫폼 단위 역할은 병원 관리자 권한을 주지 않는다).
 */
export function actorForClinic(identity: AdminIdentity, clinicId: string, role: Role): Actor | null {
  const allowed = identity.memberships.some((membership) => membership.role === role && membership.clinicId === clinicId);
  return allowed ? { id: identity.userId, role } : null;
}

/**
 * 병원에 매이지 않는 플랫폼 단위 소속(clinicId 가 null)으로 그 역할을 가진 신원이면 행위자를, 아니면 null 이다 (검토 담당자 RV 의 대기열처럼 병원 경로가 없는 자원).
 * 병원에 매인 같은 역할(예: 한 병원 소속의 RV)이나 다른 역할(HA·PO)은 이 권한을 주지 않는다. actorForClinic 의 거울이다: 그쪽은 정확히 같은 병원 소속만 인정한다.
 */
export function actorForPlatformRole(identity: AdminIdentity, role: Role): Actor | null {
  const allowed = identity.memberships.some((membership) => membership.role === role && membership.clinicId === null);
  return allowed ? { id: identity.userId, role } : null;
}
