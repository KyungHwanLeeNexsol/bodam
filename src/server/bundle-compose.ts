import type { Generation, InsurerType, LifecycleState } from '../engine/types';
import { bundleConfirmationOf, confirmsBundlePublish } from './bundle-confirmation';
import type { ConfirmationInput } from './bundle-confirmation';
import { collectBundlePublishDefects, publishRuleBundle } from './bundle-publish';
import { describeCoverageTarget } from './coverage-target-label';
import type { CoverageTargetLabel } from './coverage-target-label';
import type { ServiceDeps } from './deps';
import { canonicalDigest } from './digest';
import { requireRole } from './domain/actor';
import type { Actor } from './domain/actor';
import type { BundleAvailability, RuleBundleVersion } from './domain/entities';
import { DomainError } from './domain/errors';
import type { Defect } from './domain/errors';
import { isMappingRecord } from './domain/items';
import type { ItemVersionRecord, ItemVersionRecordOf, ItemVersionRef } from './domain/items';
import type { Repository } from './repo/interfaces';
import { isPlainObject } from './validate/shape';

// 묶음 구성 서비스 (SPEC-REIMBURSEMENT-001 M7 묶음 구성, 역할 RV): "기준 묶음 + 승인된 매핑" → 새 RuleBundleVersion.
//   previewBundlePublish   — 읽기 전용. 합친 항목 목록, 게시 판정의 결함, 충돌, (깨끗할 때만) 게시 확인값
//   publishBundleFromBase  — 한 저장소 트랜잭션: 구성 확인 → 충돌 → 확인값 → 기존 publishRuleBundle. 어느 병원에도 범위를 지정하지 않는다(지정은 PO, rule-scope-admin.ts)
// 구성 모델: 새 묶음의 항목 = 기준 묶음(ACTIVE)의 항목 전부(프로필·매핑·서류 규칙 묶음) + 고른 매핑(현재 APPROVED). 기준 묶음에 이미 있는 매핑을 바꾸거나 대체하는 일은 지원하지 않는다.
// 이 층이 더하는 것은 기존 게시 서비스가 보지 않던 세 가지다: 기준 묶음이 ACTIVE 인가, 고른 매핑이 이미 기준 묶음에 있지 않은가, 고른 매핑이 같은 치료·겹치는 칸의 다른 매핑과 겹치지 않는가.
// 나머지(항목 상태·유효 기간·참조-내용 일치·고정 지문·검증기)는 publishRuleBundle 의 판정을 collectBundlePublishDefects 로 그대로 쓴다: 미리보기와 게시가 한 판정을 공유한다.

// @MX:NOTE: [AUTO] [문서에 없음] 충돌 검사의 필요. 검증기(validate/bundle-cross.ts)는 같은 칸의 프로필 중복과 같은 매핑 id 중복만 거절한다. 같은 치료의 서로 다른 id 매핑 둘이 한 칸을 함께 덮어도
// 거절하지 않고, 엔진(resolveMapping)은 사용 가능한 후보가 둘이면 MAPPING_INVALID 로 그 칸의 계산을 조용히 보류한다. 그래서 구성 층이 게시 전에 겹침을 먼저 거절한다.
// 겹침의 정의는 "같은 치료 id 이고 scope 에 같은 (세대, 보험사 형태) 칸이 하나라도 있음"이다. 유효 기간이 겹치지 않아 실제로는 한쪽만 쓰일 매핑도 충돌로 본다(보수적: 기준 묶음의 매핑을 바꾸는 일은 지원하지 않는다).

/** 구성 요청: 기준 묶음 id 와 고른 매핑(종류는 항상 MAPPING). */
export interface BundleChoice {
  baseBundleId: string;
  mappings: readonly ItemVersionRef[];
}

export interface BundleCell {
  generation: Generation;
  insurerType: InsurerType;
}

/** 합친 항목의 화면용 이름표. 매핑은 대상과 판정·범위, 프로필은 칸, 서류 규칙 묶음은 null. 항목 내용을 읽지 못했으면 null. */
export type BundleItemLabel =
  | { treatmentId: string; decision: string; scope: BundleCell[]; target: CoverageTargetLabel }
  | { generation: string; insurerType: string }
  | null;

export interface BundlePreviewItem {
  kind: ItemVersionRef['kind'];
  id: string;
  version: string;
  /** 현재 생명주기 상태. 읽지 못했으면 null. */
  state: LifecycleState | null;
  source: 'BASE' | 'ADDED';
  /** 게시 판정의 결함 경로(`bundle.mappings[3]` …)에서 이 항목이 가리키는 자리. */
  path: string;
  label: BundleItemLabel;
}

export interface BundleConflict {
  /** 충돌하는 고른 매핑과 고른 목록에서의 자리(`mappings[i]`). */
  mappingRef: ItemVersionRef;
  path: string;
  treatmentId: string;
  conflictsWith: Array<{ ref: ItemVersionRef; source: 'BASE' | 'ADDED'; cells: BundleCell[] }>;
}

export interface BundlePreview {
  base: { bundleId: string; status: BundleAvailability; contentHash: string; itemCount: number };
  items: BundlePreviewItem[];
  /** 공유 게시 판정의 결함(비어 있으면 게시할 수 있다). 경로의 `bundle.mappings[i]` 는 items 의 path 와 같은 자리다. */
  defects: Defect[];
  conflicts: BundleConflict[];
  /** 결함도 충돌도 없을 때만 있다. 아니면 null. */
  publishConfirmation: string | null;
}

interface Chosen {
  index: number;
  ref: ItemVersionRef;
  record: ItemVersionRecordOf<'MAPPING'>;
}

interface Composition {
  base: RuleBundleVersion;
  /** publishRuleBundle 의 요청 모양. mappings 는 기준 묶음의 것(baseMappings) 뒤에 고른 매핑이 붙는다. */
  request: { profiles: ItemVersionRef[]; mappings: ItemVersionRef[]; documentRuleSet: ItemVersionRef | null };
  baseMappings: ItemVersionRef[];
  chosen: Chosen[];
}

const conflict = (message: string, defects: readonly Defect[]): DomainError => new DomainError('STATE_CONFLICT', message, defects);
const copyRef = (ref: ItemVersionRef): ItemVersionRef => ({ kind: ref.kind, id: ref.id, version: ref.version });
const sameRef = (a: ItemVersionRef, b: ItemVersionRef): boolean => a.kind === b.kind && a.id === b.id && a.version === b.version;
const keyOf = (ref: ItemVersionRef): string => JSON.stringify([ref.kind, ref.id, ref.version]);

/**
 * 기준 묶음과 고른 매핑을 읽어 게시 요청 모양으로 합친다. 요청 자체가 성립하지 않으면 던진다(쓰기는 없다):
 * 기준 묶음 없음(NOT_FOUND) → ACTIVE 아님(STATE_CONFLICT BASE_BUNDLE_NOT_ACTIVE) → 고른 매핑 없음(NOT_FOUND) → 이미 기준 묶음에 있음(STATE_CONFLICT MAPPING_ALREADY_IN_BASE, 해당 자리 전부).
 */
function compose(repo: Repository, choice: BundleChoice): Composition {
  const base = repo.getRuleBundleVersion(choice.baseBundleId);
  if (base === null) {
    throw new DomainError('NOT_FOUND', `기준 규칙 묶음 '${choice.baseBundleId}' 이(가) 없다`, [{ code: 'BASE_BUNDLE_NOT_FOUND', path: 'baseBundleId' }]);
  }
  if (repo.getBundleStatus(base.id) !== 'ACTIVE') {
    throw conflict(`기준 규칙 묶음 '${base.id}' 은(는) ACTIVE 가 아니다 (ACTIVE 인 묶음만 기준이 될 수 있다)`, [{ code: 'BASE_BUNDLE_NOT_ACTIVE', path: 'baseBundleId' }]);
  }
  const chosen: Chosen[] = choice.mappings.map((given, index) => {
    const ref: ItemVersionRef = { kind: 'MAPPING', id: given.id, version: given.version };
    const record = repo.getItemVersion(ref);
    if (record === null || !isMappingRecord(record)) {
      throw new DomainError('NOT_FOUND', `매핑 ${ref.id}/${ref.version} 이(가) 없다`, [{ code: 'MAPPING_NOT_FOUND', path: `mappings[${index}]` }]);
    }
    return { index, ref, record };
  });
  const baseMappings = base.itemRefs.filter((ref) => ref.kind === 'MAPPING').map(copyRef);
  const inBase = chosen.filter((entry) => baseMappings.some((ref) => sameRef(ref, entry.ref)));
  if (inBase.length > 0) {
    throw conflict('고른 매핑이 이미 기준 묶음에 들어 있다', inBase.map((entry) => ({ code: 'MAPPING_ALREADY_IN_BASE', path: `mappings[${entry.index}]` })));
  }
  const request = {
    profiles: base.itemRefs.filter((ref) => ref.kind === 'PROFILE').map(copyRef),
    mappings: [...baseMappings, ...chosen.map((entry) => entry.ref)],
    documentRuleSet: copyDocumentRuleSet(base),
  };
  return { base, request, baseMappings, chosen };
}

function copyDocumentRuleSet(base: RuleBundleVersion): ItemVersionRef | null {
  const found = base.itemRefs.find((ref) => ref.kind === 'DOCUMENT_RULE_SET');
  return found === undefined ? null : copyRef(found);
}

// ───────────────────────── 충돌 ─────────────────────────

/** 매핑 범위에서 형식이 맞는 칸만 (형식이 틀린 항목은 검증기가 SCOPE_INVALID 로 거절한다). 중복 칸은 하나로 본다. */
function cellsOf(record: ItemVersionRecordOf<'MAPPING'>): BundleCell[] {
  const scope: unknown = record.content.scope;
  const cells: BundleCell[] = [];
  if (Array.isArray(scope)) {
    for (const entry of scope as unknown[]) {
      if (isPlainObject(entry) && typeof entry.generation === 'string' && typeof entry.insurerType === 'string') {
        const cell = { generation: entry.generation as Generation, insurerType: entry.insurerType as InsurerType };
        if (!cells.some((seen) => seen.generation === cell.generation && seen.insurerType === cell.insurerType)) {
          cells.push(cell);
        }
      }
    }
  }
  return cells;
}

/**
 * 고른 매핑마다, 같은 치료 id 이면서 scope 의 칸이 하나라도 겹치는 다른 매핑(기준 묶음의 매핑, 다른 고른 매핑)을 찾는다. 겹치는 매핑이 있는 고른 매핑만 돌려주며
 * 고른 목록의 순서다. 읽을 수 없는 기준 매핑 기록은 건너뛴다(검증기가 REF_UNRESOLVABLE 로 거절한다). 읽기만 한다.
 */
function findConflicts(repo: Repository, composition: Composition): BundleConflict[] {
  const others: Array<{ ref: ItemVersionRef; source: 'BASE' | 'ADDED'; record: ItemVersionRecordOf<'MAPPING'>; index: number }> = [];
  for (const ref of composition.baseMappings) {
    const record = repo.getItemVersion(ref);
    if (record !== null && isMappingRecord(record)) {
      others.push({ ref, source: 'BASE', record, index: -1 });
    }
  }
  for (const entry of composition.chosen) {
    others.push({ ref: entry.ref, source: 'ADDED', record: entry.record, index: entry.index });
  }
  const out: BundleConflict[] = [];
  for (const entry of composition.chosen) {
    const mine = cellsOf(entry.record);
    const conflictsWith: BundleConflict['conflictsWith'] = [];
    for (const other of others) {
      if (other.source === 'ADDED' && other.index === entry.index) {
        continue;
      }
      if (other.record.content.treatmentId !== entry.record.content.treatmentId) {
        continue;
      }
      const theirs = cellsOf(other.record);
      const cells = mine.filter((cell) => theirs.some((candidate) => candidate.generation === cell.generation && candidate.insurerType === cell.insurerType));
      if (cells.length > 0) {
        conflictsWith.push({ ref: copyRef(other.ref), source: other.source, cells });
      }
    }
    if (conflictsWith.length > 0) {
      out.push({ mappingRef: copyRef(entry.ref), path: `mappings[${entry.index}]`, treatmentId: entry.record.content.treatmentId, conflictsWith });
    }
  }
  return out;
}

// ───────────────────────── 확인값 ─────────────────────────

function confirmationInputOf(repo: Repository, actor: Actor, composition: Composition): ConfirmationInput {
  const states = repo.readItemStates(composition.chosen.map((entry) => entry.ref));
  return {
    actorId: actor.id,
    baseBundleId: composition.base.id,
    baseContentHash: composition.base.contentHash,
    chosen: composition.chosen.map((entry, index) => ({
      ref: entry.ref,
      contentDigest: canonicalDigest(entry.record.content),
      state: states[index]?.state ?? null,
      approvedFingerprint: states[index]?.approvedFingerprint ?? null,
    })),
    composedRefs: [...composition.request.profiles, ...composition.request.mappings, ...(composition.request.documentRuleSet === null ? [] : [composition.request.documentRuleSet])],
  };
}

/**
 * 이 관리자·이 구성에 대한 확인값을 계산한다. 결함·충돌 여부는 보지 않는다 — 미리보기만 깨끗한 구성에 대해 이 값을 응답에 싣는다.
 * 구성이 성립하지 않으면(기준 묶음 없음 등) compose 와 같은 오류를 던진다. 저장소를 바꾸지 않는다.
 */
export function computeBundlePublishConfirmation(deps: Pick<ServiceDeps, 'repo'>, actor: Actor, choice: BundleChoice): string {
  return bundleConfirmationOf(confirmationInputOf(deps.repo, actor, compose(deps.repo, choice)));
}

// ───────────────────────── 미리보기 ─────────────────────────

function labelOf(repo: Repository, record: ItemVersionRecord | undefined): BundleItemLabel {
  if (record === undefined) {
    return null;
  }
  if (isMappingRecord(record)) {
    return { treatmentId: record.content.treatmentId, decision: record.content.decision, scope: cellsOf(record), target: describeCoverageTarget(repo, record.content.treatmentId) };
  }
  if (record.ref.kind === 'PROFILE') {
    const content = record.content as { generation: string; insurerType: string };
    return { generation: content.generation, insurerType: content.insurerType };
  }
  return null;
}

// @MX:ANCHOR: [AUTO] 묶음 구성 미리보기의 단일 진입점. 관리자 API(preview 경로)와 구성 시험이 부른다.
// @MX:REASON: 미리보기는 읽기만 해야 하고, 결함 판정은 게시와 같은 collectBundlePublishDefects 를 써야 한다. 둘 중 하나가 어긋나면 "게시할 수 있다"는 화면의 말이 게시의 거절과 갈라진다.
/**
 * RV 가 구성의 미리보기를 본다. 저장소에 아무것도 쓰지 않는다. 구성이 성립하지 않으면 던진다(compose 의 오류: 기준 묶음 없음·ACTIVE 아님·고른 매핑 없음·이미 기준 묶음에 있음).
 * 충돌과 게시 판정의 결함은 던지지 않고 응답에 담는다: 화면이 이유를 보여 줄 수 있어야 하기 때문이다. 확인값은 결함도 충돌도 없을 때만 싣는다.
 */
export function previewBundlePublish(deps: Pick<ServiceDeps, 'repo' | 'clock'>, actor: Actor, choice: BundleChoice): BundlePreview {
  requireRole(actor, 'RV');
  const composition = compose(deps.repo, choice);
  const conflicts = findConflicts(deps.repo, composition);
  const { defects, items } = collectBundlePublishDefects(deps, composition.request);
  const read = new Map(items.map((item) => [keyOf(item.ref), item]));
  const entry = (ref: ItemVersionRef, source: 'BASE' | 'ADDED', path: string): BundlePreviewItem => {
    const found = read.get(keyOf(ref));
    return { kind: ref.kind, id: ref.id, version: ref.version, state: found === undefined ? null : found.state.state, source, path, label: labelOf(deps.repo, found?.record) };
  };
  const { request, baseMappings } = composition;
  const listed: BundlePreviewItem[] = [
    ...request.profiles.map((ref, index) => entry(ref, 'BASE', `bundle.profiles[${index}]`)),
    ...request.mappings.map((ref, index) => entry(ref, index < baseMappings.length ? 'BASE' : 'ADDED', `bundle.mappings[${index}]`)),
    ...(request.documentRuleSet === null ? [] : [entry(request.documentRuleSet, 'BASE', 'bundle.documentRuleSet')]),
  ];
  const clean = defects.length === 0 && conflicts.length === 0;
  return {
    base: { bundleId: composition.base.id, status: 'ACTIVE', contentHash: composition.base.contentHash, itemCount: composition.base.itemRefs.length },
    items: listed,
    defects,
    conflicts,
    publishConfirmation: clean ? bundleConfirmationOf(confirmationInputOf(deps.repo, actor, composition)) : null,
  };
}

// ───────────────────────── 게시 ─────────────────────────

// @MX:ANCHOR: [AUTO] 기준 묶음 + 승인된 매핑으로 새 묶음을 게시하는 단일 진입점. 관리자 API(publish 경로)와 구성 시험이 부른다.
// @MX:REASON: 구성 확인·충돌·확인값·기존 게시가 한 트랜잭션에서 차례로 일어나야 한다. 충돌 검사가 빠지면 엔진이 조용히 보류하는 묶음이 게시되고, 이 함수가 병원 범위를 지정하면 PO 의 지정 권한(DD-17)이 우회된다.
/**
 * RV 가 구성을 게시한다. 순서: 역할 → 구성 확인(compose) → 충돌(STATE_CONFLICT MAPPING_CONFLICT) → 확인값 일치(STATE_CONFLICT PREVIEW_REQUIRED) → publishRuleBundle
 * (검증기와 서비스 전제: 항목 상태·유효 기간·참조-내용 일치·고정 지문, 결함이면 PUBLISH_VALIDATION_FAILED). 하나의 트랜잭션이고 어느 단계의 거절이든 아무것도 쓰지 않는다.
 * 충돌을 확인값보다 먼저 보는 것은 [문서에 없음] 선택이다: 충돌이 있는 구성은 어떤 미리보기도 확인값을 내주지 않으므로 확인값을 먼저 보면 충돌이 늘 PREVIEW_REQUIRED 로 가려진다.
 * 새 묶음을 어느 병원에도 지정하지 않는다: 규칙 사용 범위는 PO 만 지정한다(assignRuleScopeChecked).
 */
export function publishBundleFromBase(deps: ServiceDeps, actor: Actor, input: BundleChoice & { publishConfirmation: string }): RuleBundleVersion {
  requireRole(actor, 'RV');
  return deps.repo.transaction(() => {
    const composition = compose(deps.repo, input);
    const conflicts = findConflicts(deps.repo, composition);
    if (conflicts.length > 0) {
      throw conflict('고른 매핑이 같은 치료·겹치는 칸의 다른 매핑과 겹친다', conflicts.map((entry) => ({ code: 'MAPPING_CONFLICT', path: entry.path })));
    }
    if (!confirmsBundlePublish(confirmationInputOf(deps.repo, actor, composition), input.publishConfirmation)) {
      throw conflict('이 구성의 미리보기를 먼저 받아야 게시할 수 있다 (확인값이 없거나 맞지 않는다)', [{ code: 'PREVIEW_REQUIRED', path: 'publishConfirmation' }]);
    }
    return publishRuleBundle(deps, actor, composition.request);
  });
}
