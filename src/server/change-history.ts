import type { Role } from './domain/actor';
import type { AuditLogEntry, Clinic } from './domain/entities';
import type { Repository } from './repo/interfaces';

// 병원 관리자(HA)의 변경 이력 조회 (SPEC-REIMBURSEMENT-001 M7 변경 이력, design.md DD-19 `GET /api/admin/audit-log` 의 HA 몫).
// 새 감사 기록 체계가 아니다: 기존 감사 기록(listAuditLog)을 읽기만 하고, 쓰지 않으며, 기록의 모양도 바꾸지 않는다.
//
// 보이는 것은 아래 네 동작뿐이다(명시적 목록). 목록 밖의 동작은 감사 기록에 있어도 이 조회에 나오지 않는다 — 새 동작이 생겨도 여기에 더하기 전에는 보이지 않는다.
//   CATALOG_DRAFT_SAVE · CATALOG_DRAFT_DISCARD · CATALOG_DRAFT_PUBLISH · IDLE_POLICY_SAVE
// 초안을 게시하면 서비스가 같은 카탈로그에 감사 기록을 두 건 남긴다(안쪽 CATALOG_PUBLISH, 바깥쪽 CATALOG_DRAFT_PUBLISH). 한 번의 게시가 두 줄로 보이지 않도록 바깥쪽만 싣는다.
// 그래서 초안을 거치지 않은 게시(CATALOG_PUBLISH · CATALOG_RESTORE), 항목·매핑·검토 요청·규칙 묶음·범위 지정의 기록, 검토 담당자(RV)·플랫폼 운영자(PO)의 조회는 이번 범위가 아니다.
//
// 병원 소유는 "실제 병원·카탈로그 기록에서 만든 기대 대상과의 정확한 일치"로만 판정한다. 접두·포함·부분 문자열 비교는 쓰지 않는다:
//   초안 저장·폐기   = 기록의 대상이 `CATALOG_DRAFT/<이 병원 id>` 와 같다.
//   무조작 정책 저장 = 기록의 대상이 `CLINIC/<이 병원 id>/IDLE_POLICY` 와 같다.
//   초안 게시        = 기록의 대상이 이 병원의 실제 카탈로그 버전 `CATALOG/<버전 id>` 와 같고, 이후 버전이 그 버전이며, 이전 버전은 없거나 이 병원의 다른 카탈로그 버전이다.
// 병원 id 에 '/' 나 다른 병원 id 로 시작하는 글자가 들어 있어도 기대 대상과 한 글자라도 다르면 이 병원의 기록이 아니다. 소유를 확인할 수 없는 기록은 노출하지 않고 개수도 알리지 않는다.
//
// 건수·번호는 소유 필터를 거친 뒤에 센다: 다른 병원의 기록이 있다는 사실이 total·sequence 의 빈틈으로도 새지 않는다.
// 정렬은 감사 기록의 저장 순서(시각이 아니다)의 역순이라 시각이 같은 기록도 순서가 갈린다. 응답에는 허용한 필드만 하나씩 옮겨 담는다(기록 객체를 펼쳐 넣지 않는다):
// 초안 revision·게시 확인값·인증 정보는 감사 기록에 없고 응답에도 없다.

/** 이번 조회가 다루는 감사 동작. 명시적 목록이다. */
export const CHANGE_HISTORY_ACTIONS = ['CATALOG_DRAFT_SAVE', 'CATALOG_DRAFT_DISCARD', 'CATALOG_DRAFT_PUBLISH', 'IDLE_POLICY_SAVE'] as const;
export type ChangeHistoryAction = (typeof CHANGE_HISTORY_ACTIONS)[number];

/** 한 번에 돌려주는 가장 최근 기록의 수. 요청이 바꿀 수 없다(서버 고정값). */
export const CHANGE_HISTORY_LIMIT = 100;

export interface ChangeHistoryEntry {
  /** 이 병원이 볼 수 있는 기록 안에서의 저장 순서(1 = 가장 먼저 저장). 다른 병원의 기록을 세지 않는다. */
  sequence: number;
  at: string;
  actor: { id: string; role: Role };
  action: ChangeHistoryAction;
  target: string;
  /** 기록된 그대로다. 초안 저장·폐기와 무조작 정책 저장에서는 내용 지문, 초안 게시에서는 카탈로그 버전 id 다. */
  beforeVersion: string | null;
  afterVersion: string | null;
  reason: string | null;
}

export interface ChangeHistory {
  clinic: { id: string; displayName: string };
  /** 이 조회가 다루는 동작. 화면이 "모든 변경 이력"이라고 말하지 않도록 알린다. */
  coveredActions: readonly ChangeHistoryAction[];
  /** 최신순(저장 순서의 역순). 최대 CHANGE_HISTORY_LIMIT 건. */
  entries: ChangeHistoryEntry[];
  /** total 은 소유 필터를 거친 뒤의 전체 건수다. truncated 면 더 오래된 기록이 있지만 이번 응답에는 없다. */
  page: { limit: number; returned: number; total: number; truncated: boolean };
}

/** 이 병원의 실제 기록에서 만든, 이 병원의 기록이 가질 수 있는 대상들. */
interface OwnedTargets {
  draft: string;
  idlePolicy: string;
  /** 카탈로그 버전 대상(`CATALOG/<id>`) → 그 버전 id. 이 병원의 실제 카탈로그 버전만 든다. */
  catalogTargets: ReadonlyMap<string, string>;
  catalogIds: ReadonlySet<string>;
}

function ownedTargetsOf(repo: Pick<Repository, 'listCatalogVersions'>, clinic: Clinic): OwnedTargets {
  const catalogTargets = new Map<string, string>();
  const catalogIds = new Set<string>();
  for (const version of repo.listCatalogVersions(clinic.id)) {
    // 저장소가 병원별로 돌려주더라도 소유 확인은 여기서 한 번 더 한다.
    if (version.clinicId === clinic.id) {
      catalogTargets.set(`CATALOG/${version.id}`, version.id);
      catalogIds.add(version.id);
    }
  }
  return { draft: `CATALOG_DRAFT/${clinic.id}`, idlePolicy: `CLINIC/${clinic.id}/IDLE_POLICY`, catalogTargets, catalogIds };
}

function isChangeHistoryAction(action: string): action is ChangeHistoryAction {
  return (CHANGE_HISTORY_ACTIONS as readonly string[]).includes(action);
}

/** 목록에 든 동작의 기록이 이 병원의 것인가. 기대 대상과 정확히 같을 때만 참이다. */
function belongsToClinic(action: ChangeHistoryAction, entry: AuditLogEntry, owned: OwnedTargets): boolean {
  switch (action) {
    case 'CATALOG_DRAFT_SAVE':
    case 'CATALOG_DRAFT_DISCARD':
      return entry.target === owned.draft;
    case 'IDLE_POLICY_SAVE':
      return entry.target === owned.idlePolicy;
    case 'CATALOG_DRAFT_PUBLISH': {
      const catalogId = owned.catalogTargets.get(entry.target);
      return catalogId !== undefined && entry.afterVersion === catalogId && (entry.beforeVersion === null || owned.catalogIds.has(entry.beforeVersion));
    }
  }
}

/** 병원의 변경 이력. 읽기만 한다. 병원은 호출한 쪽이 서버가 검증한 HA 소속으로 정해 넘긴다(요청의 값이 아니다). */
export function readClinicChangeHistory(repo: Pick<Repository, 'listAuditLog' | 'listCatalogVersions'>, clinic: Clinic): ChangeHistory {
  const owned = ownedTargetsOf(repo, clinic);
  const visible: Array<{ action: ChangeHistoryAction; entry: AuditLogEntry }> = [];
  for (const entry of repo.listAuditLog()) {
    if (isChangeHistoryAction(entry.action) && belongsToClinic(entry.action, entry, owned)) {
      visible.push({ action: entry.action, entry });
    }
  }
  const total = visible.length;
  const recent = visible.slice(-CHANGE_HISTORY_LIMIT);
  const firstSequence = total - recent.length + 1;
  const entries: ChangeHistoryEntry[] = recent
    .map(({ action, entry }, index) => ({
      sequence: firstSequence + index,
      at: entry.at,
      actor: { id: entry.actorId, role: entry.role },
      action,
      target: entry.target,
      beforeVersion: entry.beforeVersion,
      afterVersion: entry.afterVersion,
      reason: entry.reason,
    }))
    .reverse();
  return {
    clinic: { id: clinic.id, displayName: clinic.name },
    coveredActions: CHANGE_HISTORY_ACTIONS,
    entries,
    page: { limit: CHANGE_HISTORY_LIMIT, returned: entries.length, total, truncated: total > entries.length },
  };
}
