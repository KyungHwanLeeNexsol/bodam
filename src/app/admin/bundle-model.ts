import { formatSeoulMinute } from '../clock';
import type { ApiFailure } from './api-types';
import { BUNDLE_COPY as COPY } from './bundle-copy';
import type {
  BundleAvailability,
  BundleBase,
  BundleCellView,
  BundleConflictView,
  BundleDefect,
  BundleItemLabel,
  BundlePreviewItem,
  BundlePreviewResponse,
  BundlePublishOverview,
  ItemKind,
  MappingCandidate,
  MappingRefView,
} from './bundle-types';
import { failureMessage } from './failure-message';
import { GENERATION_CHOICES, INSURER_TYPE_CHOICES } from './mapping-model';
import type { Api } from './transport';

// 묶음 게시 화면의 순수 계산 (SPEC-REIMBURSEMENT-001 M7 묶음 구성, 역할 RV). React·네트워크·시계를 쓰지 않는다.
// 서버가 권위이다: 여기서 정하는 "미리보기·게시 단추가 눌린다"는 화면의 안내일 뿐이고, 같은 판정(기준 묶음이 사용 가능한가·이미 담긴 매핑·겹침·확인값·게시 전제)을 서버가 게시 때 다시 한다.
// 서버 거절은 쉬운 문장으로 바꾸고 늘 무엇이 바뀌지 않았는지로 끝낸다(알려진 코드는 글자로 보이지 않는다. 모르는 결함 코드만 원래 코드를 함께 보여 알아볼 수 있게 한다).

// ───────────────────────── 공통 표시 ─────────────────────────

/** 묶음 id 를 줄여 보인다. 긴 id 는 서로 구별되는 끝부분을 남긴다(전체 id 는 화면의 title·data 속성에 있다). */
export function shortBundleId(id: string): string {
  return id.length <= 16 ? id : `…${id.slice(-12)}`;
}

export function bundleStatusText(status: BundleAvailability | null): string {
  return status === 'ACTIVE' ? COPY.statusActive : status === 'SUSPENDED' ? COPY.statusSuspended : COPY.statusUnknown;
}

const generationLabel = (code: string): string => GENERATION_CHOICES.find((choice) => choice.code === code)?.label ?? code;
const insurerLabel = (code: string): string => INSURER_TYPE_CHOICES.find((choice) => choice.code === code)?.label ?? code;

/** 적용 범위 칸들을 "세대 · 보험사 형태 / …" 로 보인다. */
export function scopeText(cells: readonly BundleCellView[]): string {
  return cells.map((cell) => `${generationLabel(cell.generation)} · ${insurerLabel(cell.insurerType)}`).join(' / ');
}

/** 매핑 한 건의 키(선택 상태와 화면 표지에 쓴다). */
export const refKey = (ref: MappingRefView): string => JSON.stringify([ref.id, ref.version]);

// ───────────────────────── 기준 묶음 ─────────────────────────

/** 기준으로 고를 수 있는 것은 사용 가능한(ACTIVE) 묶음뿐이다. 서버가 미리보기·게시에서 다시 확인한다. */
export const isBaseSelectable = (base: Pick<BundleBase, 'status'>): boolean => base.status === 'ACTIVE';

/** 기준으로 고를 수 없는 묶음의 글로 된 이유. 고를 수 있으면 null. */
export function baseUnavailableText(base: Pick<BundleBase, 'status'>): string | null {
  return base.status === 'ACTIVE' ? null : base.status === 'SUSPENDED' ? COPY.suspendedReason : COPY.unknownStatusReason;
}

/** 기본 기준 묶음: 가장 최근에 게시된 사용 가능한 묶음. 게시 시각이 같으면 서버 순서(최신이 먼저)의 앞쪽이다. 없으면 null. */
export function defaultBaseId(bases: readonly BundleBase[]): string | null {
  let best: BundleBase | null = null;
  for (const base of bases) {
    if (isBaseSelectable(base) && (best === null || base.publishedAt > best.publishedAt)) best = base;
  }
  return best === null ? null : best.bundleId;
}

export interface BaseView {
  bundleId: string;
  shortId: string;
  status: BundleAvailability | null;
  statusText: string;
  selectable: boolean;
  unavailableText: string | null;
  publishedText: string;
  itemsText: string;
  clinicsText: string;
}

export function baseView(base: BundleBase): BaseView {
  return {
    bundleId: base.bundleId,
    shortId: shortBundleId(base.bundleId),
    status: base.status,
    statusText: bundleStatusText(base.status),
    selectable: isBaseSelectable(base),
    unavailableText: baseUnavailableText(base),
    publishedText: COPY.publishedLine(formatSeoulMinute(base.publishedAt), base.publishedBy),
    itemsText: COPY.itemCounts(base.itemCounts),
    clinicsText: base.clinics.length === 0 ? COPY.noClinics : base.clinics.map((clinic) => clinic.slug).join(', '),
  };
}

// ───────────────────────── 선택 상태 ─────────────────────────

export interface BundleSelection {
  baseBundleId: string | null;
  /** 고른 매핑의 refKey. 누른 순서는 요청에 영향을 주지 않는다(요청은 목록 순서로 만든다). */
  chosen: readonly string[];
}

export function initialSelection(overview: Pick<BundlePublishOverview, 'bases'>): BundleSelection {
  return { baseBundleId: defaultBaseId(overview.bases), chosen: [] };
}

export const selectBase = (selection: BundleSelection, baseBundleId: string): BundleSelection => ({ ...selection, baseBundleId });

export function toggleMapping(selection: BundleSelection, key: string): BundleSelection {
  return { ...selection, chosen: selection.chosen.includes(key) ? selection.chosen.filter((entry) => entry !== key) : [...selection.chosen, key] };
}

/** 목록을 다시 불러온 뒤의 선택: 사라진 매핑은 빼고, 기준 묶음이 더는 사용 가능하지 않으면 기본값으로 돌린다. */
export function reconcileSelection(selection: BundleSelection, overview: BundlePublishOverview): BundleSelection {
  const present = new Set(overview.candidates.map((candidate) => refKey(candidate.mappingRef)));
  const kept = overview.bases.find((base) => base.bundleId === selection.baseBundleId);
  return {
    baseBundleId: kept !== undefined && isBaseSelectable(kept) ? kept.bundleId : defaultBaseId(overview.bases),
    chosen: selection.chosen.filter((key) => present.has(key)),
  };
}

/** 고른 매핑을 후보 목록 순서로. 같은 선택은 늘 같은 요청이 된다. */
export function orderedChoice(selection: BundleSelection, candidates: readonly MappingCandidate[]): MappingRefView[] {
  return candidates.filter((candidate) => selection.chosen.includes(refKey(candidate.mappingRef))).map((candidate) => ({ id: candidate.mappingRef.id, version: candidate.mappingRef.version }));
}

// ───────────────────────── 미리보기 요청 · 게시 조건 ─────────────────────────

export interface BundleRequest {
  baseBundleId: string;
  mappings: MappingRefView[];
}

export type RequestResult = { ok: true; body: BundleRequest } | { ok: false; hint: string };

/** 미리보기 요청 본문. 기준 묶음도 매핑도 없으면 만들지 않고 이유를 말한다. */
export function previewRequestOf(selection: BundleSelection, candidates: readonly MappingCandidate[]): RequestResult {
  if (selection.baseBundleId === null) return { ok: false, hint: COPY.previewHintNeedBase };
  const mappings = orderedChoice(selection, candidates);
  if (mappings.length === 0) return { ok: false, hint: COPY.previewHintNeedMapping };
  return { ok: true, body: { baseBundleId: selection.baseBundleId, mappings } };
}

const signatureOf = (body: BundleRequest): string => JSON.stringify([body.baseBundleId, body.mappings.map((mapping) => [mapping.id, mapping.version])]);

/** 받은 미리보기와, 그 미리보기를 만든 요청의 서명. 게시는 이 서명이 지금 선택과 같을 때만 열린다. */
export interface PreviewRecord {
  signature: string;
  preview: BundlePreviewResponse;
}

export const recordOf = (body: BundleRequest, preview: BundlePreviewResponse): PreviewRecord => ({ signature: signatureOf(body), preview });

export interface PublishGate {
  enabled: boolean;
  hint: string;
  body: (BundleRequest & { publishConfirmation: string }) | null;
}

/**
 * 게시 단추가 눌리는 조건: 마지막 미리보기가 확인값(publishConfirmation)을 돌려줬고, 그 미리보기를 만든 요청이 지금 선택(기준 묶음 + 고른 매핑)과 같을 때만.
 * 선택이 조금이라도 바뀌었거나 미리보기에 결함·충돌이 있으면 닫힌다. 본문은 열렸을 때만 있고 확인값은 그 미리보기의 것이다.
 */
export function publishGateOf(selection: BundleSelection, candidates: readonly MappingCandidate[], record: PreviewRecord | null): PublishGate {
  if (record === null) return { enabled: false, hint: COPY.publishHintNoPreview, body: null };
  const request = previewRequestOf(selection, candidates);
  if (!request.ok || signatureOf(request.body) !== record.signature) return { enabled: false, hint: COPY.publishHintChanged, body: null };
  const confirmation = record.preview.publishConfirmation;
  if (confirmation === null) return { enabled: false, hint: COPY.publishHintBlocked, body: null };
  return { enabled: true, hint: COPY.publishHintReady, body: { ...request.body, publishConfirmation: confirmation } };
}

// ───────────────────────── 후보 매핑 한 줄 ─────────────────────────

export interface CandidateView {
  key: string;
  id: string;
  version: string;
  name: string;
  clinicText: string;
  decisionText: string;
  scopeText: string;
  validityText: string;
  approverText: string;
  fingerprintState: MappingCandidate['approvedFingerprint'];
  fingerprintText: string;
  /** 승인 뒤 치료 정보가 바뀐 매핑(STALE)의 경고. 그 밖에는 null. 이 매핑도 고를 수 있다 — 거절은 서버가 하고 이유가 화면에 보인다. */
  warning: string | null;
  /** 확인하지 못한 매핑(UNKNOWN)의 이유. 그 밖에는 null. */
  note: string | null;
  alreadyInText: string | null;
  selectable: true;
  selected: boolean;
}

function targetName(candidate: MappingCandidate): string {
  const { target } = candidate;
  if (target.kind === 'TREATMENT' && target.displayName !== null) return target.displayName;
  if (target.kind === 'BASE_FEE') return `${target.displayName ?? candidate.treatmentId} (${COPY.targetBaseFee})`;
  return COPY.targetUnknown(candidate.treatmentId);
}

export function candidateView(candidate: MappingCandidate, selected: boolean): CandidateView {
  const state = candidate.approvedFingerprint;
  return {
    key: refKey(candidate.mappingRef),
    id: candidate.mappingRef.id,
    version: candidate.mappingRef.version,
    name: targetName(candidate),
    clinicText: candidate.target.clinicSlug ?? candidate.target.clinicId ?? COPY.clinicUnknown,
    decisionText: candidate.decision === 'COVERED' ? COPY.decisionCovered : COPY.decisionExcluded,
    scopeText: scopeText(candidate.scope),
    validityText: `${candidate.validity.from} ~ ${candidate.validity.to}`,
    approverText: candidate.approvedBy ?? COPY.approverUnknown,
    fingerprintState: state,
    fingerprintText: state === 'CURRENT' ? COPY.fingerprintCurrent : state === 'STALE' ? COPY.fingerprintStale : COPY.fingerprintUnknown,
    warning: state === 'STALE' ? COPY.staleWarning : null,
    note: state === 'UNKNOWN' ? COPY.unknownNote(candidate.readIssue === null ? COPY.unknownIssueGeneric : (COPY.unknownIssue[candidate.readIssue] ?? COPY.unknownIssueGeneric)) : null,
    alreadyInText: candidate.alreadyInBundles.length === 0 ? null : COPY.alreadyIn(candidate.alreadyInBundles.join(', ')),
    selectable: true,
    selected,
  };
}

// ───────────────────────── 미리보기 보기 ─────────────────────────

const KIND_ORDER: readonly ItemKind[] = ['PROFILE', 'MAPPING', 'DOCUMENT_RULE_SET'];

const isMappingLabel = (label: BundleItemLabel): label is Extract<BundleItemLabel, { treatmentId: string }> => label !== null && 'treatmentId' in label;
const isProfileLabel = (label: BundleItemLabel): label is Extract<BundleItemLabel, { generation: string }> => label !== null && 'generation' in label;

function mappingName(item: BundlePreviewItem): string {
  return isMappingLabel(item.label) && item.label.target.displayName !== null ? item.label.target.displayName : item.id;
}

function itemText(item: BundlePreviewItem): string {
  if (item.kind === 'MAPPING' && isMappingLabel(item.label)) {
    const decision = item.label.decision === 'COVERED' ? COPY.decisionCovered : COPY.decisionExcluded;
    return `${mappingName(item)} · ${decision} · ${scopeText(item.label.scope)} (${item.id})`;
  }
  if (item.kind === 'PROFILE' && isProfileLabel(item.label)) return `${COPY.profileLabel(generationLabel(item.label.generation), insurerLabel(item.label.insurerType))} (${item.id})`;
  return item.id;
}

/** 결함·충돌 문장에서 항목을 부르는 이름. */
function whoOf(item: BundlePreviewItem | null): string {
  if (item === null) return COPY.itemWhoBundle;
  return item.kind === 'MAPPING' ? COPY.itemWhoMapping(mappingName(item)) : item.kind === 'PROFILE' ? COPY.itemWhoProfile(item.id) : COPY.itemWhoRuleSet(item.id);
}

/** 게시 판정의 결함 경로(`bundle.mappings[3].state` …)에서 `.state` 같은 뒷부분을 떼고 그 자리의 항목을 찾는다. */
function itemAt(path: string, items: readonly BundlePreviewItem[]): BundlePreviewItem | null {
  const head = /^bundle\.(?:profiles\[\d+\]|mappings\[\d+\]|documentRuleSet)/.exec(path);
  return head === null ? null : (items.find((item) => item.path === head[0]) ?? null);
}

/** 결함 하나를 문장으로. 모르는 코드는 알 수 없는 문제라고 하되 원래 코드를 함께 보인다. */
export function defectSentence(defect: BundleDefect, items: readonly BundlePreviewItem[]): string {
  const who = whoOf(itemAt(defect.path, items));
  const known = COPY.defects[defect.code];
  return known === undefined ? COPY.defectUnknown(who, defect.code) : known(who);
}

export interface PreviewItemView {
  key: string;
  kind: ItemKind;
  id: string;
  version: string;
  source: 'BASE' | 'ADDED';
  sourceText: string;
  text: string;
  versionText: string;
  stateText: string;
}

export interface PreviewView {
  baseText: string;
  summaryText: string;
  counts: { base: number; added: number; total: number };
  groups: Array<{ kind: ItemKind; title: string; items: PreviewItemView[] }>;
  defectLines: Array<{ code: string; text: string }>;
  /** key 는 충돌하는 고른 매핑의 refKey 다(한 매핑이 둘 이상과 겹치면 같은 key 의 줄이 여럿이다). */
  conflictLines: Array<{ key: string; text: string }>;
  publishable: boolean;
}

function conflictLinesOf(conflict: BundleConflictView, items: readonly BundlePreviewItem[]): Array<{ key: string; text: string }> {
  const mine = items.find((item) => item.kind === 'MAPPING' && item.id === conflict.mappingRef.id && item.version === conflict.mappingRef.version) ?? null;
  const who = mine === null ? COPY.itemWhoMapping(conflict.mappingRef.id) : whoOf(mine);
  return conflict.conflictsWith.map((other) => ({
    key: refKey(conflict.mappingRef),
    text: COPY.conflictLine(who, other.source === 'BASE' ? COPY.conflictOtherBase(other.ref.id, other.ref.version) : COPY.conflictOtherAdded(other.ref.id, other.ref.version), scopeText(other.cells)),
  }));
}

export function previewView(preview: BundlePreviewResponse): PreviewView {
  const counts = { base: preview.items.filter((item) => item.source === 'BASE').length, added: preview.items.filter((item) => item.source === 'ADDED').length, total: preview.items.length };
  return {
    baseText: COPY.previewBase(shortBundleId(preview.base.bundleId)),
    summaryText: COPY.previewSummary(counts),
    counts,
    groups: KIND_ORDER.map((kind) => ({
      kind,
      title: COPY.groupTitle[kind],
      items: preview.items
        .filter((item) => item.kind === kind)
        .map((item) => ({
          key: `${item.kind}|${item.path}`,
          kind: item.kind,
          id: item.id,
          version: item.version,
          source: item.source,
          sourceText: item.source === 'BASE' ? COPY.sourceBase : COPY.sourceAdded,
          text: itemText(item),
          versionText: COPY.itemVersion(item.version),
          stateText: item.state === null ? COPY.stateUnknown : (COPY.stateLabel[item.state] ?? item.state),
        })),
    })),
    defectLines: preview.defects.map((defect) => ({ code: defect.code, text: defectSentence(defect, preview.items) })),
    conflictLines: preview.conflicts.flatMap((conflict) => conflictLinesOf(conflict, preview.items)),
    publishable: preview.publishConfirmation !== null && preview.defects.length === 0 && preview.conflicts.length === 0,
  };
}

// ───────────────────────── 서버 거절 · 성공 안내 ─────────────────────────

export type BundleAction = 'preview' | 'publish';

/** 화면 표지(data 속성)용 코드: 사유 → 첫 결함 코드 → 상태 번호. 사람이 읽는 문장이 아니다. */
export function failureCodeOf(result: Api<unknown>): string {
  const failure = result.body as ApiFailure;
  return failure.reason ?? failure.defects?.[0]?.code ?? `HTTP_${result.status}`;
}

/**
 * 서버 거절을 문장으로. 이 화면이 아는 거절(권한·없음·네 가지 409 사유·게시 판정 결함)은 여기서 말하고,
 * 그 밖의 거절(로그인 없음·서버 오류·모르는 409 사유·결함 없는 400)은 기존 관리자 거절 문장(failureMessage)을 그대로 쓴다.
 * items 는 마지막 미리보기의 항목이다: 결함 문장이 어느 매핑인지 이름으로 말하게 한다.
 */
export function bundleFailureMessage(result: Api<unknown>, action: BundleAction, items: readonly BundlePreviewItem[] = []): string {
  const failure = result.body as ApiFailure;
  const nothing = action === 'publish' ? COPY.nothingPublished : COPY.nothingPreviewed;
  if (result.status === 403) return `${COPY.forbidden} ${nothing}`;
  if (result.status === 404) return `${COPY.notFound} ${nothing}`;
  if (result.status === 409 && failure.reason !== undefined && COPY.conflict[failure.reason] !== undefined) return `${COPY.conflict[failure.reason]} ${nothing}`;
  if (result.status === 400 && (failure.defects ?? []).length > 0) {
    const sentences = [...new Set((failure.defects ?? []).map((defect) => defectSentence(defect, items)))];
    return `${sentences.slice(0, 3).join(' ')} ${nothing}`;
  }
  return failureMessage(result, action);
}

export const publishedMessage = (bundleId: string): string => COPY.publishedNotApplied(bundleId);
