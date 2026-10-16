import type { Actor } from './domain/actor';
import type { AuditLogEntry } from './domain/entities';
import type { Clock, IdGenerator } from './domain/ports';
import type { Repository } from './repo/interfaces';

// 감사 기록 도우미 (design.md DD-17·DD-18 AuditLog). 모든 상태 변경 동작은 수행자 id·역할, 동작, 대상,
// 이전/이후 버전, 사유, 시각을 남긴다. 시각과 식별자는 주입한 Clock·IdGenerator 에서만 온다.
// 승인 우회 표지(selfApproval 등)는 이 기록 어디에도 없다 (결정 #31).
// 서비스는 상태를 바꾸는 쓰기와 같은 트랜잭션 안에서 부른다: 트랜잭션이 되돌려지면 감사 기록도 사라진다.

export interface AuditDeps {
  repo: Pick<Repository, 'appendAuditLog'>;
  clock: Clock;
  ids: IdGenerator;
}

export interface AuditInput {
  action: string;
  target: string;
  beforeVersion: string | null;
  afterVersion: string | null;
  reason: string | null;
}

// @MX:ANCHOR: [AUTO] 감사 기록의 단일 진입점. 생명주기·게시·중지·범위 지정(M3.B~D)의 모든 상태 변경이 부른다.
// @MX:REASON: 기록 모양(수행자·역할·이전/이후·사유·시각)이 동작마다 다르면 감사 질의(M7)가 동작별로 갈라진다.
/** 감사 기록을 한 건 더하고 저장된 기록을 돌려준다. */
export function appendAudit(deps: AuditDeps, actor: Actor, input: AuditInput): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: deps.ids.next('AUDIT'),
    actorId: actor.id,
    role: actor.role,
    action: input.action,
    target: input.target,
    beforeVersion: input.beforeVersion,
    afterVersion: input.afterVersion,
    reason: input.reason,
    at: deps.clock.now(),
  };
  deps.repo.appendAuditLog(entry);
  return entry;
}
