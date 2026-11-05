import { describe, expect, it } from 'vitest';
import { BUNDLE_COPY } from '../../src/app/admin/bundle-copy';
import { failureMessage } from '../../src/app/admin/failure-message';
import {
  baseUnavailableText,
  baseView,
  bundleFailureMessage,
  candidateView,
  defaultBaseId,
  defectSentence,
  failureCodeOf,
  initialSelection,
  isBaseSelectable,
  orderedChoice,
  previewRequestOf,
  previewView,
  publishGateOf,
  publishedMessage,
  reconcileSelection,
  recordOf,
  refKey,
  selectBase,
  shortBundleId,
  toggleMapping,
} from '../../src/app/admin/bundle-model';
import type {
  BundleBase,
  BundlePreviewItem,
  BundlePreviewResponse,
  BundlePublishOverview,
  MappingCandidate,
} from '../../src/app/admin/bundle-types';

// 묶음 게시 화면의 순수 계산 (화면 코드 밖). 시험 자료(TEST_FIXTURE)만 쓴다.
// 서버가 권위이다: 여기서 정하는 "게시 단추가 눌린다"는 화면의 안내일 뿐이고, 같은 판정(충돌·확인값·결함)을 서버가 게시 때 다시 한다.

const HASH = 'a'.repeat(64);
const CONFIRMATION = 'b'.repeat(64);

const base = (bundleId: string, status: BundleBase['status'], publishedAt: string, clinics: BundleBase['clinics'] = []): BundleBase => ({
  bundleId,
  status,
  publishedAt,
  publishedBy: 'TEST_FIXTURE_RV_1',
  contentHash: HASH,
  itemCounts: { profiles: 2, mappings: 3, documentRuleSets: 1 },
  clinics,
});

const candidate = (id: string, overrides: Partial<MappingCandidate> = {}): MappingCandidate => ({
  mappingRef: { kind: 'MAPPING', id, version: '1' },
  treatmentId: `TEST_FIXTURE_TREATMENT_${id}`,
  target: { kind: 'TREATMENT', displayName: `시험 치료 ${id}`, clinicId: 'TEST_FIXTURE_CLINIC_1', clinicSlug: 'test-clinic-1' },
  scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }],
  decision: 'COVERED',
  groupKey: 'TEST_FIXTURE_GROUP',
  exclusionReason: null,
  validity: { from: '2026-01-01', to: '2026-12-31' },
  approvedBy: 'TEST_FIXTURE_RV_2',
  approvedFingerprint: 'CURRENT',
  reviewRequestId: 'TEST_FIXTURE_REVIEW_1',
  alreadyInBundles: [],
  readIssue: null,
  ...overrides,
});

const overview = (bases: BundleBase[], candidates: MappingCandidate[] = []): BundlePublishOverview => ({ bases, candidates, unreadable: [] });

const OLD_ACTIVE = base('TEST_FIXTURE_BUNDLE_1', 'ACTIVE', '2026-10-01T00:00:00.000Z');
const NEW_SUSPENDED = base('TEST_FIXTURE_BUNDLE_3', 'SUSPENDED', '2026-10-03T00:00:00.000Z');
const MID_ACTIVE = base('TEST_FIXTURE_BUNDLE_2', 'ACTIVE', '2026-10-02T00:00:00.000Z');
// 서버 순서: 최신 게시가 먼저.
const BASES = [NEW_SUSPENDED, MID_ACTIVE, OLD_ACTIVE];

const C1 = candidate('TEST_FIXTURE_MAPPING_1');
const C2 = candidate('TEST_FIXTURE_MAPPING_2');
const C3 = candidate('TEST_FIXTURE_MAPPING_3');

describe('기준 묶음 고르기', () => {
  it('기본값은 가장 최근에 게시된 사용 가능한 묶음이다 (중지된 묶음은 더 최신이어도 건너뛴다)', () => {
    expect(defaultBaseId(BASES)).toBe('TEST_FIXTURE_BUNDLE_2');
    expect(defaultBaseId([OLD_ACTIVE, MID_ACTIVE])).toBe('TEST_FIXTURE_BUNDLE_2');
  });

  it('사용 가능한 묶음이 없으면 기본값이 없다', () => {
    expect(defaultBaseId([NEW_SUSPENDED])).toBeNull();
    expect(defaultBaseId([])).toBeNull();
  });

  it('고를 수 있는 것은 사용 가능한 묶음뿐이고, 못 고르는 묶음에는 글로 된 이유가 있다', () => {
    expect(isBaseSelectable(OLD_ACTIVE)).toBe(true);
    expect(baseUnavailableText(OLD_ACTIVE)).toBeNull();
    expect(isBaseSelectable(NEW_SUSPENDED)).toBe(false);
    expect(baseUnavailableText(NEW_SUSPENDED)).toBe(BUNDLE_COPY.suspendedReason);
    const unknown = base('TEST_FIXTURE_BUNDLE_9', null, '2026-10-09T00:00:00.000Z');
    expect(isBaseSelectable(unknown)).toBe(false);
    expect(baseUnavailableText(unknown)).toBe(BUNDLE_COPY.unknownStatusReason);
  });

  it('기준 묶음 한 줄은 상태를 글로 말하고 쓰는 병원과 항목 수를 함께 보인다', () => {
    const view = baseView(base('TEST_FIXTURE_BUNDLE_2', 'ACTIVE', '2026-10-02T01:00:00.000Z', [{ clinicId: 'TEST_FIXTURE_CLINIC_1', slug: 'test-clinic-1' }]));
    expect(view.statusText).toBe(BUNDLE_COPY.statusActive);
    expect(view.selectable).toBe(true);
    expect(view.clinicsText).toBe('test-clinic-1');
    expect(view.itemsText).toBe('프로필 2 · 매핑 3 · 서류 규칙 묶음 1');
    expect(view.publishedText).toBe('2026-10-02 10:00 · TEST_FIXTURE_RV_1');
    expect(baseView(NEW_SUSPENDED).statusText).toBe(BUNDLE_COPY.statusSuspended);
    expect(baseView(NEW_SUSPENDED).clinicsText).toBe(BUNDLE_COPY.noClinics);
  });

  it('긴 묶음 id 는 서로 구별되는 끝부분을 남겨 줄인다', () => {
    expect(shortBundleId('TEST_FIXTURE_BUNDLE_1')).toBe('…URE_BUNDLE_1');
    expect(shortBundleId('B1')).toBe('B1');
    expect(shortBundleId('RB_0123456789abcdef0123456789abcdef')).not.toBe(shortBundleId('RB_0123456789abcdef0123456789abcde0'));
  });
});

describe('선택 상태', () => {
  it('처음에는 기본 기준 묶음만 골라져 있고 고른 매핑은 없다', () => {
    const selection = initialSelection(overview(BASES, [C1]));
    expect(selection).toEqual({ baseBundleId: 'TEST_FIXTURE_BUNDLE_2', chosen: [] });
  });

  it('매핑은 켜고 끄며, 원래 선택을 바꾸지 않는다', () => {
    const start = initialSelection(overview(BASES, [C1, C2]));
    const one = toggleMapping(start, refKey(C1.mappingRef));
    expect(one.chosen).toEqual([refKey(C1.mappingRef)]);
    expect(start.chosen).toEqual([]);
    expect(toggleMapping(one, refKey(C1.mappingRef)).chosen).toEqual([]);
  });

  it('기준 묶음을 바꿔도 고른 매핑은 그대로다', () => {
    const start = toggleMapping(initialSelection(overview(BASES, [C1])), refKey(C1.mappingRef));
    const next = selectBase(start, 'TEST_FIXTURE_BUNDLE_1');
    expect(next.baseBundleId).toBe('TEST_FIXTURE_BUNDLE_1');
    expect(next.chosen).toEqual(start.chosen);
  });

  it('요청에 실리는 매핑 순서는 누른 순서가 아니라 목록 순서다 (같은 선택은 늘 같은 요청)', () => {
    const candidates = [C1, C2, C3];
    const a = toggleMapping(toggleMapping(initialSelection(overview(BASES, candidates)), refKey(C3.mappingRef)), refKey(C1.mappingRef));
    const b = toggleMapping(toggleMapping(initialSelection(overview(BASES, candidates)), refKey(C1.mappingRef)), refKey(C3.mappingRef));
    expect(orderedChoice(a, candidates)).toEqual([{ id: C1.mappingRef.id, version: '1' }, { id: C3.mappingRef.id, version: '1' }]);
    expect(previewRequestOf(a, candidates)).toEqual(previewRequestOf(b, candidates));
  });

  it('목록을 다시 불러온 뒤에는 사라진 매핑을 빼고, 기준 묶음이 더는 사용 가능하지 않으면 기본값으로 돌린다', () => {
    const selection = toggleMapping(toggleMapping(selectBase(initialSelection(overview(BASES, [C1, C2])), 'TEST_FIXTURE_BUNDLE_1'), refKey(C1.mappingRef)), refKey(C2.mappingRef));
    const kept = reconcileSelection(selection, overview(BASES, [C2]));
    expect(kept).toEqual({ baseBundleId: 'TEST_FIXTURE_BUNDLE_1', chosen: [refKey(C2.mappingRef)] });
    const suspended = base('TEST_FIXTURE_BUNDLE_1', 'SUSPENDED', '2026-10-01T00:00:00.000Z');
    expect(reconcileSelection(selection, overview([MID_ACTIVE, suspended], [C1, C2])).baseBundleId).toBe('TEST_FIXTURE_BUNDLE_2');
    expect(reconcileSelection(selection, overview([suspended], [C1, C2])).baseBundleId).toBeNull();
  });
});

describe('미리보기 요청', () => {
  it('기준 묶음이 없거나 매핑을 고르지 않았으면 요청을 만들지 않고 이유를 말한다', () => {
    const none = { baseBundleId: null, chosen: [refKey(C1.mappingRef)] };
    expect(previewRequestOf(none, [C1])).toEqual({ ok: false, hint: BUNDLE_COPY.previewHintNeedBase });
    const noMapping = initialSelection(overview(BASES, [C1]));
    expect(previewRequestOf(noMapping, [C1])).toEqual({ ok: false, hint: BUNDLE_COPY.previewHintNeedMapping });
  });

  it('요청 본문은 서버가 받는 모양({ baseBundleId, mappings:[{ id, version }] })이다', () => {
    const selection = toggleMapping(initialSelection(overview(BASES, [C1])), refKey(C1.mappingRef));
    expect(previewRequestOf(selection, [C1])).toEqual({ ok: true, body: { baseBundleId: 'TEST_FIXTURE_BUNDLE_2', mappings: [{ id: C1.mappingRef.id, version: '1' }] } });
  });
});

function cleanPreview(overrides: Partial<BundlePreviewResponse> = {}): BundlePreviewResponse {
  return { base: { bundleId: 'TEST_FIXTURE_BUNDLE_2', status: 'ACTIVE', contentHash: HASH, itemCount: 1 }, items: [], defects: [], conflicts: [], publishConfirmation: CONFIRMATION, ...overrides };
}

describe('게시 단추가 눌리는 조건', () => {
  const candidates = [C1, C2];
  const selected = toggleMapping(initialSelection(overview(BASES, candidates)), refKey(C1.mappingRef));
  const request = previewRequestOf(selected, candidates);
  if (!request.ok) throw new Error('시험 준비 실패');
  const record = recordOf(request.body, cleanPreview());

  it('미리보기가 없으면 눌리지 않는다', () => {
    const gate = publishGateOf(selected, candidates, null);
    expect(gate.enabled).toBe(false);
    expect(gate.hint).toBe(BUNDLE_COPY.publishHintNoPreview);
    expect(gate.body).toBeNull();
  });

  it('확인값이 있는 미리보기이고 고른 내용이 그대로이면 눌린다 (본문에 그 확인값이 실린다)', () => {
    const gate = publishGateOf(selected, candidates, record);
    expect(gate.enabled).toBe(true);
    expect(gate.hint).toBe(BUNDLE_COPY.publishHintReady);
    expect(gate.body).toEqual({ baseBundleId: 'TEST_FIXTURE_BUNDLE_2', mappings: [{ id: C1.mappingRef.id, version: '1' }], publishConfirmation: CONFIRMATION });
  });

  it('미리보기의 확인값이 null(결함이나 충돌이 있음)이면 눌리지 않는다', () => {
    const blocked = recordOf(request.body, cleanPreview({ publishConfirmation: null, defects: [{ code: 'FINGERPRINT_STALE', path: 'bundle.mappings[3].approvedFingerprint' }] }));
    const gate = publishGateOf(selected, candidates, blocked);
    expect(gate.enabled).toBe(false);
    expect(gate.hint).toBe(BUNDLE_COPY.publishHintBlocked);
    expect(gate.body).toBeNull();
  });

  it('미리보기를 본 뒤 매핑을 더하거나 빼거나 기준 묶음을 바꾸면 눌리지 않는다', () => {
    for (const changed of [toggleMapping(selected, refKey(C2.mappingRef)), toggleMapping(selected, refKey(C1.mappingRef)), selectBase(selected, 'TEST_FIXTURE_BUNDLE_1')]) {
      const gate = publishGateOf(changed, candidates, record);
      expect(gate.enabled).toBe(false);
      expect(gate.body).toBeNull();
    }
  });

  it('고른 내용이 바뀐 이유는 "미리보기를 다시 실행하라"는 말로 알린다', () => {
    const gate = publishGateOf(toggleMapping(selected, refKey(C2.mappingRef)), candidates, record);
    expect(gate.hint).toBe(BUNDLE_COPY.publishHintChanged);
    expect(gate.hint).toContain('미리보기를 다시 실행');
  });
});

describe('후보 매핑 한 줄', () => {
  it('치료 이름·병원·판정·범위·유효 기간·승인자와 승인 뒤 변경 여부를 글로 보인다', () => {
    const view = candidateView(C1, false);
    expect(view.key).toBe(refKey(C1.mappingRef));
    expect(view.name).toBe('시험 치료 TEST_FIXTURE_MAPPING_1');
    expect(view.clinicText).toBe('test-clinic-1');
    expect(view.decisionText).toBe(BUNDLE_COPY.decisionCovered);
    expect(view.scopeText).toBe('4세대(C4) · 손해보험사');
    expect(view.validityText).toBe('2026-01-01 ~ 2026-12-31');
    expect(view.approverText).toBe('TEST_FIXTURE_RV_2');
    expect(view.fingerprintState).toBe('CURRENT');
    expect(view.fingerprintText).toBe(BUNDLE_COPY.fingerprintCurrent);
    expect(view.warning).toBeNull();
    expect(view.selected).toBe(false);
    expect(candidateView(C1, true).selected).toBe(true);
  });

  it('승인 뒤 바뀐 매핑은 경고를 보이되 고를 수 있다 (거절은 서버가 하고 화면이 미리 숨기지 않는다)', () => {
    const view = candidateView(candidate('TEST_FIXTURE_MAPPING_S', { approvedFingerprint: 'STALE' }), false);
    expect(view.fingerprintText).toBe(BUNDLE_COPY.fingerprintStale);
    expect(view.warning).toBe(BUNDLE_COPY.staleWarning);
    expect(view.warning).toContain('서버가 거절합니다');
    expect(view.selectable).toBe(true);
  });

  it('확인하지 못한 매핑은 이유를 말하고, 낡지 않았다고 말하지 않는다', () => {
    const view = candidateView(candidate('TEST_FIXTURE_MAPPING_U', { approvedFingerprint: 'UNKNOWN', readIssue: 'TARGET_VERSION_ABSENT' }), false);
    expect(view.fingerprintText).toBe(BUNDLE_COPY.fingerprintUnknown);
    expect(view.note).toBe(BUNDLE_COPY.unknownNote(BUNDLE_COPY.unknownIssue.TARGET_VERSION_ABSENT as string));
    expect(view.note).not.toContain('TARGET_VERSION_ABSENT');
    expect(view.warning).toBeNull();
    const other = candidateView(candidate('TEST_FIXTURE_MAPPING_V', { approvedFingerprint: 'UNKNOWN', readIssue: 'SOMETHING_NEW' }), false);
    expect(other.note).toBe(BUNDLE_COPY.unknownNote(BUNDLE_COPY.unknownIssueGeneric));
  });

  it('치료 이름을 모르면 치료 id 와 함께 모른다고 말하고, 공통 기본비용은 그렇게 부른다', () => {
    const unknownTarget = candidate('TEST_FIXTURE_MAPPING_N', { target: { kind: 'UNKNOWN', displayName: null, clinicId: null, clinicSlug: null } });
    expect(candidateView(unknownTarget, false).name).toBe(BUNDLE_COPY.targetUnknown(unknownTarget.treatmentId));
    expect(candidateView(unknownTarget, false).clinicText).toBe(BUNDLE_COPY.clinicUnknown);
    const fee = candidate('TEST_FIXTURE_MAPPING_F', { target: { kind: 'BASE_FEE', displayName: '시험 기본비용', clinicId: 'TEST_FIXTURE_CLINIC_1', clinicSlug: 'test-clinic-1' } });
    expect(candidateView(fee, false).name).toBe(`시험 기본비용 (${BUNDLE_COPY.targetBaseFee})`);
  });

  it('보장 제외 판정·승인자 없음·이미 담긴 묶음을 보인다', () => {
    const view = candidateView(candidate('TEST_FIXTURE_MAPPING_E', { decision: 'EXCLUDED', approvedBy: null, alreadyInBundles: ['B1', 'B2'] }), false);
    expect(view.decisionText).toBe(BUNDLE_COPY.decisionExcluded);
    expect(view.approverText).toBe(BUNDLE_COPY.approverUnknown);
    expect(view.alreadyInText).toBe(BUNDLE_COPY.alreadyIn('B1, B2'));
    expect(candidateView(C1, false).alreadyInText).toBeNull();
  });
});

function item(kind: BundlePreviewItem['kind'], id: string, source: BundlePreviewItem['source'], path: string, label: BundlePreviewItem['label'] = null): BundlePreviewItem {
  return { kind, id, version: '1', state: kind === 'MAPPING' && source === 'ADDED' ? 'APPROVED' : 'PUBLISHED', source, path, label };
}

const MAPPING_LABEL = (name: string | null, treatmentId = 'TEST_FIXTURE_TREATMENT_1'): BundlePreviewItem['label'] => ({
  treatmentId,
  decision: 'COVERED',
  scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }],
  target: { kind: name === null ? 'UNKNOWN' : 'TREATMENT', displayName: name, clinicId: 'TEST_FIXTURE_CLINIC_1', clinicSlug: 'test-clinic-1' },
});

const ITEMS: BundlePreviewItem[] = [
  item('PROFILE', 'TEST_FIXTURE_PROFILE_1', 'BASE', 'bundle.profiles[0]', { generation: 'GEN4_C4', insurerType: 'NON_LIFE' }),
  item('MAPPING', 'TEST_FIXTURE_MAPPING_B', 'BASE', 'bundle.mappings[0]', MAPPING_LABEL('기준 치료')),
  item('MAPPING', 'TEST_FIXTURE_MAPPING_A', 'ADDED', 'bundle.mappings[1]', MAPPING_LABEL('추가 치료', 'TEST_FIXTURE_TREATMENT_2')),
  item('DOCUMENT_RULE_SET', 'TEST_FIXTURE_DOCS_1', 'BASE', 'bundle.documentRuleSet'),
];

describe('미리보기 보기', () => {
  it('종류별로 묶고 항목마다 기준 묶음에서 왔는지 추가인지 글로 표시한다', () => {
    const view = previewView(cleanPreview({ items: ITEMS }));
    expect(view.groups.map((group) => group.kind)).toEqual(['PROFILE', 'MAPPING', 'DOCUMENT_RULE_SET']);
    expect(view.groups.map((group) => group.title)).toEqual(['프로필', '매핑', '서류 규칙 묶음']);
    const mappings = view.groups[1]!.items;
    expect(mappings.map((entry) => entry.source)).toEqual(['BASE', 'ADDED']);
    expect(mappings.map((entry) => entry.sourceText)).toEqual([BUNDLE_COPY.sourceBase, BUNDLE_COPY.sourceAdded]);
    expect(mappings[1]!.text).toContain('추가 치료');
    expect(mappings[1]!.text).toContain('TEST_FIXTURE_MAPPING_A');
    expect(mappings[1]!.versionText).toBe('v1');
    expect(mappings[1]!.stateText).toBe('승인됨');
    expect(view.groups[0]!.items[0]!.text).toContain('4세대(C4) · 손해보험사');
  });

  it('개수 요약은 기준 묶음에서 온 항목과 새로 더한 항목을 따로 센다', () => {
    const view = previewView(cleanPreview({ items: ITEMS }));
    expect(view.counts).toEqual({ base: 3, added: 1, total: 4 });
    expect(view.summaryText).toBe(BUNDLE_COPY.previewSummary({ base: 3, added: 1, total: 4 }));
  });

  it('항목이 없는 종류도 자리를 남겨 "없음"으로 보인다', () => {
    const view = previewView(cleanPreview({ items: [ITEMS[1]!, ITEMS[2]!] }));
    expect(view.groups.map((group) => group.items.length)).toEqual([0, 2, 0]);
  });

  it('깨끗한 미리보기는 게시할 수 있다고 하고, 결함이나 충돌이 있으면 문장으로 이유를 말한다', () => {
    expect(previewView(cleanPreview({ items: ITEMS })).publishable).toBe(true);
    const blocked = previewView(
      cleanPreview({
        items: ITEMS,
        publishConfirmation: null,
        defects: [{ code: 'FINGERPRINT_STALE', path: 'bundle.mappings[1].approvedFingerprint' }],
        conflicts: [
          {
            mappingRef: { id: 'TEST_FIXTURE_MAPPING_A', version: '1' },
            path: 'mappings[0]',
            treatmentId: 'TEST_FIXTURE_TREATMENT_2',
            conflictsWith: [{ ref: { id: 'TEST_FIXTURE_MAPPING_B', version: '1' }, source: 'BASE', cells: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }] }],
          },
        ],
      }),
    );
    expect(blocked.publishable).toBe(false);
    expect(blocked.defectLines).toEqual([{ code: 'FINGERPRINT_STALE', text: '매핑 "추가 치료": 승인한 뒤 치료 정보가 바뀌어 게시할 수 없습니다. 다시 검토·승인이 필요합니다.' }]);
    expect(blocked.conflictLines).toHaveLength(1);
    expect(blocked.conflictLines[0]!.text).toBe(BUNDLE_COPY.conflictLine('매핑 "추가 치료"', BUNDLE_COPY.conflictOtherBase('TEST_FIXTURE_MAPPING_B', '1'), '4세대(C4) · 손해보험사'));
    expect(blocked.conflictLines[0]!.key).toBe(refKey({ id: 'TEST_FIXTURE_MAPPING_A', version: '1' }));
  });

  it('확인값이 null 이면 결함·충돌 목록이 비어 있어도 게시할 수 있다고 하지 않는다', () => {
    expect(previewView(cleanPreview({ items: ITEMS, publishConfirmation: null })).publishable).toBe(false);
  });
});

describe('결함 코드 → 문장', () => {
  const items = ITEMS;

  it('경로의 뒷부분(.state 등)을 떼고 그 자리의 항목 이름으로 말한다', () => {
    expect(defectSentence({ code: 'ITEM_STATE_NOT_PUBLISHABLE', path: 'bundle.mappings[1].state' }, items)).toBe('매핑 "추가 치료": 승인된 상태가 아니라서 게시할 수 없습니다.');
    expect(defectSentence({ code: 'OUTSIDE_VALIDITY', path: 'bundle.mappings[0].validity' }, items)).toContain('기준 치료');
    expect(defectSentence({ code: 'ITEM_REF_MISMATCH', path: 'bundle.profiles[0]' }, items)).toContain('프로필 TEST_FIXTURE_PROFILE_1');
    expect(defectSentence({ code: 'ITEM_REF_MISMATCH', path: 'bundle.documentRuleSet' }, items)).toContain('서류 규칙 묶음 TEST_FIXTURE_DOCS_1');
  });

  it('치료 이름을 읽지 못한 매핑은 매핑 id 로 부른다', () => {
    const unnamed = [item('MAPPING', 'TEST_FIXTURE_MAPPING_X', 'ADDED', 'bundle.mappings[0]', MAPPING_LABEL(null))];
    expect(defectSentence({ code: 'FINGERPRINT_STALE', path: 'bundle.mappings[0].approvedFingerprint' }, unnamed)).toContain('TEST_FIXTURE_MAPPING_X');
  });

  it('어느 항목인지 알 수 없는 경로는 "묶음"이라고 부른다', () => {
    expect(defectSentence({ code: 'INTEGRITY_MISMATCH', path: 'bundle' }, items)).toContain(BUNDLE_COPY.itemWhoBundle);
    expect(defectSentence({ code: 'FINGERPRINT_STALE', path: 'bundle.mappings[9].x' }, items)).toContain(BUNDLE_COPY.itemWhoBundle);
  });

  it('모르는 코드는 알 수 없는 문제라고 하되 원래 코드를 함께 보인다', () => {
    const text = defectSentence({ code: 'SOMETHING_NEW', path: 'bundle.mappings[1]' }, items);
    expect(text).toContain('알 수 없는 문제');
    expect(text).toContain('SOMETHING_NEW');
  });

  it('아는 코드의 문장에는 코드 글자가 나오지 않는다', () => {
    for (const code of Object.keys(BUNDLE_COPY.defects)) {
      expect(defectSentence({ code, path: 'bundle.mappings[1]' }, items), code).not.toContain(code);
    }
  });
});

describe('서버 거절 문장', () => {
  const reply = (status: number, body: unknown) => ({ status, body: body as never });

  it('409 의 네 가지 사유는 각자 다른 문장이고 코드 글자가 나오지 않으며, 게시 거절은 아무것도 게시되지 않았다는 말로 끝난다', () => {
    const seen = new Set<string>();
    for (const reason of ['MAPPING_CONFLICT', 'MAPPING_ALREADY_IN_BASE', 'BASE_BUNDLE_NOT_ACTIVE', 'PREVIEW_REQUIRED']) {
      const text = bundleFailureMessage(reply(409, { error: 'CONFLICT', reason }), 'publish');
      expect(text, reason).toContain(BUNDLE_COPY.conflict[reason] as string);
      expect(text, reason).not.toContain(reason);
      expect(text.endsWith(BUNDLE_COPY.nothingPublished), reason).toBe(true);
      seen.add(text);
    }
    expect(seen.size).toBe(4);
  });

  it('미리보기 단계의 409 는 입력이 남아 있다는 말로 끝난다', () => {
    const text = bundleFailureMessage(reply(409, { error: 'CONFLICT', reason: 'BASE_BUNDLE_NOT_ACTIVE' }), 'preview');
    expect(text).toContain(BUNDLE_COPY.conflict.BASE_BUNDLE_NOT_ACTIVE as string);
    expect(text.endsWith(BUNDLE_COPY.nothingPreviewed)).toBe(true);
  });

  it('400 의 결함은 문장이 되고 모르는 코드만 원래 코드를 보인다', () => {
    const text = bundleFailureMessage(
      reply(400, { error: 'INVALID_REQUEST', defects: [{ code: 'ITEM_STATE_NOT_PUBLISHABLE', path: 'bundle.mappings[1].state' }, { code: 'FINGERPRINT_STALE', path: 'bundle.mappings[1].approvedFingerprint' }, { code: 'SOMETHING_NEW', path: 'bundle.mappings[1]' }] }),
      'publish',
      ITEMS,
    );
    expect(text).toContain('승인된 상태가 아니라서');
    expect(text).toContain('승인한 뒤 치료 정보가 바뀌어');
    expect(text).toContain('SOMETHING_NEW');
    expect(text).not.toContain('FINGERPRINT_STALE');
    expect(text.endsWith(BUNDLE_COPY.nothingPublished)).toBe(true);
  });

  it('결함 없는 400 은 일반 문장이다', () => {
    expect(bundleFailureMessage(reply(400, { error: 'INVALID_REQUEST' }), 'publish')).toContain('요청을 처리하지 못했습니다');
  });

  it('403 은 이 화면의 권한을 말하고(병원 가격 관리 권한이 아니다), 401 은 로그인 안내다', () => {
    const forbidden = bundleFailureMessage(reply(403, { error: 'FORBIDDEN' }), 'publish');
    expect(forbidden).toContain(BUNDLE_COPY.forbidden);
    expect(forbidden).not.toContain('가격');
    expect(bundleFailureMessage(reply(401, { error: 'UNAUTHENTICATED' }), 'publish')).toContain('로그인이 필요합니다');
  });

  it('404 는 이 화면의 문장이고 바뀌지 않았다는 말로 끝난다', () => {
    const text = bundleFailureMessage(reply(404, { error: 'NOT_FOUND' }), 'preview');
    expect(text).toContain(BUNDLE_COPY.notFound);
    expect(text.endsWith(BUNDLE_COPY.nothingPreviewed)).toBe(true);
  });

  it('로그인 없음·서버 오류·모르는 409 사유·그 밖의 상태는 기존 관리자 거절 문장(failureMessage)을 그대로 쓴다', () => {
    for (const [result, action] of [
      [reply(500, { error: 'INTERNAL' }), 'publish'],
      [reply(418, {}), 'preview'],
      [reply(409, { error: 'CONFLICT', reason: 'SOMETHING_NEW' }), 'publish'],
    ] as const) {
      expect(bundleFailureMessage(result, action)).toBe(failureMessage(result, action));
    }
    expect(bundleFailureMessage(reply(500, { error: 'INTERNAL' }), 'publish')).toContain('서버 오류');
    expect(bundleFailureMessage(reply(409, { error: 'CONFLICT', reason: 'SOMETHING_NEW' }), 'publish')).not.toContain('SOMETHING_NEW');
  });

  it('화면 표지용 코드: 사유 → 첫 결함 코드 → 상태 번호 순으로 고른다', () => {
    expect(failureCodeOf(reply(409, { error: 'CONFLICT', reason: 'MAPPING_CONFLICT' }))).toBe('MAPPING_CONFLICT');
    expect(failureCodeOf(reply(400, { error: 'INVALID_REQUEST', defects: [{ code: 'FINGERPRINT_STALE', path: 'x' }] }))).toBe('FINGERPRINT_STALE');
    expect(failureCodeOf(reply(403, { error: 'FORBIDDEN' }))).toBe('HTTP_403');
  });
});

describe('게시 성공 안내', () => {
  it('게시했지만 아직 어느 병원에도 적용되지 않았고 플랫폼 운영자가 지정해야 한다고 분명히 말한다', () => {
    const text = publishedMessage('TEST_FIXTURE_BUNDLE_4');
    expect(text).toContain('TEST_FIXTURE_BUNDLE_4');
    expect(text).toContain('아직 어느 병원에도 적용되지 않았습니다');
    expect(text).toContain('플랫폼 운영자');
  });
});
