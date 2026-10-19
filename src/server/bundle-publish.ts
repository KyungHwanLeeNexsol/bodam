import { compareCodePoints } from '../engine/validate';
import type { DocumentRuleSet, StandardAssumptionProfile, TreatmentCoverageMapping } from '../engine/types';
import { appendAudit } from './audit';
import { markPublished } from './approval';
import { canonicalDigest } from './digest';
import type { ServiceDeps } from './deps';
import { requireRole } from './domain/actor';
import type { Actor } from './domain/actor';
import type { RuleBundleVersion } from './domain/entities';
import { DomainError } from './domain/errors';
import type { Defect } from './domain/errors';
import type { ItemKind, ItemStateSnapshot, ItemVersionRecord, ItemVersionRecordOf, ItemVersionRef } from './domain/items';
import { toEngineDocumentRuleSet, toEngineMapping, toEngineProfile } from './domain/projection';
import { currentCoverageTarget } from './coverage-target';
import { assertNoDefects, validateRuleBundlePublish } from './publish-validate';
import type { BundleItemResolver } from './publish-validate';
import type { Repository } from './repo/interfaces';
import { isPlainObject } from './validate/shape';

// 규칙 묶음 게시 서비스 (SPEC-REIMBURSEMENT-001 M3.D1, design.md DD-14·DD-17, 역할 RV).
//   publishRuleBundle   — 항목 버전 참조 목록을 새 RuleBundleVersion 으로 게시한다 (AC-007f, AC-011h, AC-011i, AC-011a)
//   restoreRuleBundle   — 이전 RuleBundleVersion 의 사본을 같은 게시 경로로 새 id 에 게시한다 (AC-011b)
// 게시는 하나의 저장소 트랜잭션이다: 해석기 조립 → 검증기 → 서비스 전제 확인 → 묶음 쓰기 → 첫 ACTIVE 가용성 기록 → APPROVED 항목의 PUBLISHED 전이 → 감사 기록.
// 결함이 있으면 PUBLISH_VALIDATION_FAILED 로 던지고 저장소(감사 기록·가용성 기록 포함)는 호출 전과 같으며 이전 묶음은 그대로다.
// 중지·규칙 사용 범위 지정·보험사·무조작 정책은 M3.D2 의 일이고 여기에 없다. 역할만 본다: 소유·인증은 M7.

// @MX:NOTE: [AUTO] [문서에 없음] 게시는 APPROVED 항목을 PUBLISHED 로 옮기지만 같은 항목의 옛 버전을 SUPERSEDED 로 만들지 않는다.
// DD-17 표는 SUPERSEDED 를 "새 버전 게시"의 결과로 적지만, 옛 버전을 자동으로 대체하면 병원이 아직 쓰는 옛 묶음의 항목이 새 묶음 게시와 동시에
// 쓸 수 없게 된다(계산은 항목 상태를 요청마다 읽는다). 그러면 규칙 사용 범위를 다시 지정하기 전에 병원들이 보류된다(DD-14 복구 경로와 맞지 않음).
// 대체는 markSuperseded 의 명시 동작으로 남긴다.

/** 항목 하나를 해석한 결과. 검증기가 해석기로 읽은 값을 서비스가 그대로 쓰도록 모아 둔다(같은 읽기를 두 번 하지 않는다). */
interface Resolved {
  ref: ItemVersionRef;
  record: ItemVersionRecord;
  state: ItemStateSnapshot;
  engine: StandardAssumptionProfile | TreatmentCoverageMapping | DocumentRuleSet;
}

type Seen = Map<string, Resolved>;

const keyOf = (ref: ItemVersionRef): string => JSON.stringify([ref.kind, ref.id, ref.version]);

/** 저장소 읽기로 해석기를 만든다: 바뀌지 않는 내용 + 방금 읽은 현재 상태를 엔진 형식으로 합친다(domain/projection.ts). 해석한 항목은 seen 에 남는다. */
function buildResolver(repo: Repository, seen: Seen): BundleItemResolver {
  function resolve<T extends Resolved['engine']>(ref: ItemVersionRef, project: (record: ItemVersionRecord, state: ItemStateSnapshot) => T): T | null {
    const record = repo.getItemVersion(ref);
    const state = repo.readItemStates([ref])[0];
    if (record === null || state === null || state === undefined) {
      return null;
    }
    const engine = project(record, state);
    seen.set(keyOf(ref), { ref, record, state, engine });
    return engine;
  }
  return {
    profile: (ref) => resolve(ref, (record, state) => toEngineProfile(record as ItemVersionRecordOf<'PROFILE'>, state)),
    mapping: (ref) => resolve(ref, (record, state) => toEngineMapping(record as ItemVersionRecordOf<'MAPPING'>, state)),
    documentRuleSet: (ref) => resolve(ref, (record, state) => toEngineDocumentRuleSet(record as ItemVersionRecordOf<'DOCUMENT_RULE_SET'>, state)),
  };
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD 이면서 달력에 있는 날짜인지. */
function isCalendarDate(value: unknown): value is string {
  const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null;
  if (match === null) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** [문서에 없음] 두 날짜가 모두 달력 날짜이고 시작일 <= 종료일이며 게시일(today)에 이미 끝난 기간이 아니다. 미래에 시작하는 기간은 게시할 수 있다. */
function isPublishableValidity(validity: unknown, today: string): boolean {
  if (!isPlainObject(validity)) {
    return false;
  }
  const { from, to } = validity;
  return isCalendarDate(from) && isCalendarDate(to) && from <= to && to >= today;
}

/** 요청 한 칸(프로필·매핑 목록의 index 번째, 또는 서류 규칙 묶음 자리)이 가리키는 해석된 항목. 형식이 틀린 칸과 해석되지 않은 칸은 건너뛴다. */
function resolvedAt(entry: unknown, kind: ItemKind, seen: Seen): Resolved | undefined {
  if (!isPlainObject(entry) || entry.kind !== kind || typeof entry.id !== 'string' || typeof entry.version !== 'string') {
    return undefined;
  }
  return seen.get(keyOf({ kind, id: entry.id, version: entry.version }));
}

/**
 * 검증기가 보지 않는 전제를 요청 순서(프로필 → 매핑 → 서류 규칙 묶음)로 확인한다. 칸마다 보고 순서: 참조-내용 일치 → 상태 → 유효 기간 →
 * (매핑) 치료 버전과 고정 지문. 검증기의 결함 뒤에 붙는다.
 */
function preconditionDefects(repo: Repository, request: unknown, seen: Seen, today: string): Defect[] {
  const out: Defect[] = [];
  if (!isPlainObject(request)) {
    return out;
  }
  const check = (found: Resolved | undefined, path: string): void => {
    if (found === undefined) {
      return;
    }
    const { ref, engine, state } = found;
    if (engine.id !== ref.id || engine.version !== ref.version) {
      out.push({ code: 'ITEM_REF_MISMATCH', path });
    }
    // DD-17: PUBLISHED 로 들어오는 전이는 "규칙 묶음 게시" 하나다. 그래서 APPROVED(이 게시가 PUBLISHED 로 옮긴다)와 이미 PUBLISHED(다른 묶음이 게시했다)만 담을 수 있다.
    if (state.state !== 'APPROVED' && state.state !== 'PUBLISHED') {
      out.push({ code: 'ITEM_STATE_NOT_PUBLISHABLE', path: `${path}.state` });
    }
    if (!isPublishableValidity(engine.validity, today)) {
      out.push({ code: 'OUTSIDE_VALIDITY', path: `${path}.validity` });
    }
    if (ref.kind === 'MAPPING') {
      const mapping = engine as TreatmentCoverageMapping;
      // 대상은 치료이거나 공통 기본비용이다: 승인이 지문을 고정할 때와 같은 조회(coverage-target.ts)로 현재 지문을 읽는다.
      const current = currentCoverageTarget(repo, mapping.treatmentId);
      if (current === null) {
        out.push({ code: 'TREATMENT_VERSION_ABSENT', path: `${path}.treatmentId` });
      } else if (mapping.approvedFingerprint !== '' && mapping.approvedFingerprint !== current.fingerprint) {
        // 고정 지문이 없는 경우(빈 문자열)는 검증기가 FINGERPRINT_MISSING 으로 이미 보고한다.
        out.push({ code: 'FINGERPRINT_STALE', path: `${path}.approvedFingerprint` });
      }
    }
  };
  for (const [field, kind] of [['profiles', 'PROFILE'], ['mappings', 'MAPPING']] as const) {
    const list = request[field];
    if (Array.isArray(list)) {
      list.forEach((entry: unknown, index) => check(resolvedAt(entry, kind, seen), `bundle.${field}[${index}]`));
    }
  }
  check(resolvedAt(request.documentRuleSet, 'DOCUMENT_RULE_SET', seen), 'bundle.documentRuleSet');
  return out;
}

const compareRefs = (a: ItemVersionRef, b: ItemVersionRef): number =>
  compareCodePoints(a.kind, b.kind) || compareCodePoints(a.id, b.id) || compareCodePoints(a.version, b.version);

/** 묶음 내용 해시의 항목 한 건: 참조와 저장된 항목 내용의 정본 해시. */
export interface BundleHashEntry {
  ref: ItemVersionRef;
  contentDigest: string;
}

// @MX:NOTE: [AUTO] 묶음 내용 해시의 정의 v1 (design.md 는 "내용 해시"만 적고 입력을 정하지 않아 M3.D1 이 정했다 [문서에 없음]).
// 해시 = canonicalDigest({ format: 'bodam.rule-bundle.v1', items }), items = 항목마다 { kind, id, version, contentDigest } 를
// (kind, id, version) 코드 포인트 순으로 정렬한 목록. contentDigest = canonicalDigest(저장된 항목 내용). 요청의 항목 순서·묶음 id·
// 게시 시각·게시자·항목의 현재 상태·매핑의 고정 지문(상태 쪽 값)은 입력이 아니다: 같은 항목 버전 집합이면 언제 다시 계산해도 같다(AC-011a).
// 정의를 바꾸면 이미 게시한 묶음의 해시를 다시 계산해 비교할 수 없게 되므로 형식 표지를 올린다.
/** 항목 참조와 내용 해시로 묶음 내용 해시를 만든다. 입력 순서에 달라지지 않는다. */
export function computeBundleContentHash(entries: readonly BundleHashEntry[]): string {
  const items = [...entries]
    .sort((a, b) => compareRefs(a.ref, b.ref))
    .map(({ ref, contentDigest }) => ({ kind: ref.kind, id: ref.id, version: ref.version, contentDigest }));
  return canonicalDigest({ format: 'bodam.rule-bundle.v1', items });
}

/** 저장소에서 항목 내용을 읽어 묶음 내용 해시를 다시 계산한다 (게시된 묶음의 검증용). 항목이 없으면 NOT_FOUND. */
export function bundleContentHashOf(repo: Pick<Repository, 'getItemVersion'>, itemRefs: readonly ItemVersionRef[]): string {
  return computeBundleContentHash(
    itemRefs.map((ref) => {
      const record = repo.getItemVersion(ref);
      if (record === null) {
        throw new DomainError('NOT_FOUND', `항목 ${ref.kind}/${ref.id}/${ref.version} 이(가) 없다`);
      }
      return { ref, contentDigest: canonicalDigest(record.content) };
    }),
  );
}

interface AuditChoice {
  action: string;
  reason: string | null;
}

function publishNew(deps: ServiceDeps, actor: Actor, request: unknown, audit: AuditChoice): RuleBundleVersion {
  requireRole(actor, 'RV');
  return deps.repo.transaction(() => {
    const seen: Seen = new Map();
    const today = deps.clock.now().slice(0, 10);
    const defects = validateRuleBundlePublish(request, buildResolver(deps.repo, seen));
    defects.push(...preconditionDefects(deps.repo, request, seen, today));
    assertNoDefects(defects);

    // 아래부터 쓰기다. 검증이 통과하면 seen 은 요청이 가리키는 항목 전부(중복 참조는 하나)이고 교차 검사가 같은 칸·같은 매핑 id 의 중복을 막았다.
    const items = [...seen.values()].sort((a, b) => compareRefs(a.ref, b.ref));
    const at = deps.clock.now();
    const bundle: RuleBundleVersion = {
      id: deps.ids.next('BUNDLE'),
      itemRefs: items.map(({ ref }) => ({ kind: ref.kind, id: ref.id, version: ref.version })),
      contentHash: computeBundleContentHash(items.map(({ ref, record }) => ({ ref, contentDigest: canonicalDigest(record.content) }))),
      publishedBy: { id: actor.id, role: actor.role },
      publishedAt: at,
    };
    deps.repo.putRuleBundleVersion(bundle);
    deps.repo.appendBundleStatusEvent({ bundleId: bundle.id, status: 'ACTIVE', actorId: actor.id, role: actor.role, at, reason: null, previousStatus: null });
    for (const { ref, state } of items) {
      if (state.state === 'APPROVED') {
        markPublished(deps, actor, ref);
      }
    }
    appendAudit(deps, actor, { action: audit.action, target: `BUNDLE/${bundle.id}`, beforeVersion: null, afterVersion: bundle.id, reason: audit.reason });
    return bundle;
  });
}

// @MX:ANCHOR: [AUTO] 규칙 묶음 게시의 단일 진입점. 중지·범위 지정(M3.D2), 준비 상태(M3.E), 계산 API 시험(M4), 관리자 API(M7)가 게시된 묶음을 만들 때 부른다.
// @MX:REASON: 검증·서비스 전제·묶음 쓰기·ACTIVE 기록·항목 PUBLISHED 전이가 한 트랜잭션에서 함께 일어나야 한다. 하나가 빠지면 가용성 기록 없는 묶음이나 PUBLISHED 가 아닌 항목을 담은 묶음이 남아 계산이 항상 보류된다.
/**
 * RV 가 규칙 묶음을 게시한다. request = { profiles: ItemVersionRef[], mappings: ItemVersionRef[], documentRuleSet: ItemVersionRef | null }.
 * 항목은 서비스가 저장소에서 읽는다(요청은 참조만 담는다). 결함이 있으면 PUBLISH_VALIDATION_FAILED 이고 저장소는 호출 전과 같다.
 * 통과하면 새 id 의 불변 묶음(항목 참조는 (종류, id, 버전) 순), 첫 ACTIVE 가용성 기록, APPROVED 항목의 PUBLISHED 전이(이미 PUBLISHED 인 항목은 그대로),
 * 감사 기록이 같은 트랜잭션에 쓰인다. 묶음 내용 해시의 정의는 computeBundleContentHash 의 주석을 본다.
 */
export function publishRuleBundle(deps: ServiceDeps, actor: Actor, request: unknown): RuleBundleVersion {
  return publishNew(deps, actor, request, { action: 'BUNDLE_PUBLISH', reason: null });
}

/**
 * 이전 규칙 묶음 버전의 사본을 새 id 로 게시한다(복구). 같은 게시 경로를 지나므로 검증·서비스 전제·RV 역할 규칙이 그대로 적용되고,
 * 옛 항목이 지금은 게시 규칙을 통과하지 못하면(예: 항목이 중지됨) 유형 있는 거절이며 아무것도 저장되지 않는다. 원본 묶음과 그 가용성 기록은 건드리지 않는다
 * (원본이 SUSPENDED 여도 복구할 수 있다: DD-14 복구 경로). 감사 기록의 사유 `RESTORE_OF:<원본 id>` 가 원본을 가리킨다.
 */
export function restoreRuleBundle(deps: ServiceDeps, actor: Actor, sourceBundleId: string): RuleBundleVersion {
  requireRole(actor, 'RV');
  return deps.repo.transaction(() => {
    const source = deps.repo.getRuleBundleVersion(sourceBundleId);
    if (source === null) {
      throw new DomainError('NOT_FOUND', `규칙 묶음 '${sourceBundleId}' 이(가) 없다`);
    }
    const refsOf = (kind: ItemKind): ItemVersionRef[] => source.itemRefs.filter((ref) => ref.kind === kind).map((ref) => ({ ...ref }));
    const request = { profiles: refsOf('PROFILE'), mappings: refsOf('MAPPING'), documentRuleSet: refsOf('DOCUMENT_RULE_SET')[0] ?? null };
    return publishNew(deps, actor, request, { action: 'BUNDLE_RESTORE', reason: `RESTORE_OF:${source.id}` });
  });
}
