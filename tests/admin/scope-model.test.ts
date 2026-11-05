import { describe, expect, it } from 'vitest';
import { SCOPE_COPY } from '../../src/app/admin/bundle-copy';
import { shortBundleId } from '../../src/app/admin/bundle-model';
import type { BundleSummary, ClinicScopeRow } from '../../src/app/admin/bundle-types';
import { applyAssigned, assignRequestOf, assignedMessage, bundleOptions, confirmStateOf, currentView, reconcileDrafts, scopeFailureMessage, setDraft } from '../../src/app/admin/scope-model';

// 규칙 사용 범위 화면의 순수 계산 (화면 코드 밖). 시험 자료(TEST_FIXTURE)만 쓴다.
// 서버가 권위이다: 여기서 정하는 "적용 단추가 눌린다"는 화면의 안내일 뿐이고, 현재 적용본 비교(SCOPE_CHANGED)와 묶음·병원 존재는 서버가 다시 본다.

const HASH = 'a'.repeat(64);

const bundle = (bundleId: string, status: BundleSummary['status'], publishedAt = '2026-10-01T01:00:00.000Z'): BundleSummary => ({
  bundleId,
  status,
  publishedAt,
  publishedBy: 'TEST_FIXTURE_RV_1',
  contentHash: HASH,
  itemCounts: { profiles: 1, mappings: 1, documentRuleSets: 1 },
});

const B1 = bundle('TEST_FIXTURE_BUNDLE_1', 'ACTIVE');
const B2 = bundle('TEST_FIXTURE_BUNDLE_2', 'ACTIVE', '2026-10-02T01:00:00.000Z');
const B3 = bundle('TEST_FIXTURE_BUNDLE_3', 'SUSPENDED', '2026-10-03T01:00:00.000Z');
const BUNDLES = [B3, B2, B1];

const row = (clinicId: string, currentBundleId: string | null, status: BundleSummary['status'] = 'ACTIVE'): ClinicScopeRow => ({
  clinicId,
  slug: `slug-${clinicId}`,
  displayName: `시험 병원 ${clinicId}`,
  current: currentBundleId === null ? null : { bundleId: currentBundleId, status, assignedAt: '2026-10-05T03:30:00.000Z', assignedBy: 'TEST_FIXTURE_PO_1' },
});

describe('현재 적용본', () => {
  it('지정된 묶음이 없으면 그렇게 말한다', () => {
    const view = currentView(row('C1', null));
    expect(view.bundleId).toBeNull();
    expect(view.text).toBe(SCOPE_COPY.currentNone);
    expect(view.statusText).toBeNull();
    expect(view.assignedText).toBeNull();
  });

  it('지정된 묶음은 줄인 id·상태(글)·지정 시각과 지정한 사람을 보인다', () => {
    const view = currentView(row('C1', 'TEST_FIXTURE_BUNDLE_1'));
    expect(view.bundleId).toBe('TEST_FIXTURE_BUNDLE_1');
    expect(view.text).toBe(shortBundleId('TEST_FIXTURE_BUNDLE_1'));
    expect(view.statusText).toBe('사용 가능');
    expect(view.assignedText).toBe(SCOPE_COPY.assignedLine('2026-10-05 12:30', 'TEST_FIXTURE_PO_1'));
    expect(view.note).toBeNull();
  });

  it('현재 적용본이 중지된 묶음이면 그 사실을 따로 알린다', () => {
    const view = currentView(row('C1', 'TEST_FIXTURE_BUNDLE_3', 'SUSPENDED'));
    expect(view.statusText).toBe('중지됨');
    expect(view.note).toBe(SCOPE_COPY.currentSuspendedNote);
  });
});

describe('바꿀 묶음 목록', () => {
  it('사용 가능한 묶음은 고를 수 있고, 중지된 묶음은 목록에 있지만 글로 된 이유와 함께 고를 수 없다', () => {
    const options = bundleOptions(BUNDLES);
    expect(options.map((option) => option.value)).toEqual(['TEST_FIXTURE_BUNDLE_3', 'TEST_FIXTURE_BUNDLE_2', 'TEST_FIXTURE_BUNDLE_1']);
    expect(options.map((option) => option.disabled)).toEqual([true, false, false]);
    expect(options[0]!.label).toContain('중지됨, 선택할 수 없음');
    expect(options[1]!.label).not.toContain('선택할 수 없음');
    expect(options[1]!.label).toContain(shortBundleId('TEST_FIXTURE_BUNDLE_2'));
    expect(options[1]!.label).toContain('2026-10-02 10:00');
  });

  it('상태를 알 수 없는 묶음도 고를 수 없다', () => {
    const [option] = bundleOptions([bundle('TEST_FIXTURE_BUNDLE_9', null)]);
    expect(option!.disabled).toBe(true);
  });
});

describe('적용 확인', () => {
  it('아무것도 고르지 않았으면 안내도 단추도 없다', () => {
    expect(confirmStateOf(row('C1', 'TEST_FIXTURE_BUNDLE_1'), '', BUNDLES)).toEqual({ enabled: false, line: null, hint: null });
  });

  it('다른 묶음을 고르면 "현재 X → 바꿀 Y" 한 줄과 확인 단추가 생긴다', () => {
    const state = confirmStateOf(row('C1', 'TEST_FIXTURE_BUNDLE_1'), 'TEST_FIXTURE_BUNDLE_2', BUNDLES);
    expect(state.enabled).toBe(true);
    expect(state.line).toBe(`현재 ${shortBundleId('TEST_FIXTURE_BUNDLE_1')} → 바꿀 ${shortBundleId('TEST_FIXTURE_BUNDLE_2')}`);
    expect(state.hint).toBeNull();
  });

  it('지정된 묶음이 없던 병원은 "현재 지정된 묶음 없음 → 바꿀 Y" 로 말한다', () => {
    const state = confirmStateOf(row('C1', null), 'TEST_FIXTURE_BUNDLE_1', BUNDLES);
    expect(state.enabled).toBe(true);
    expect(state.line).toBe(`현재 ${SCOPE_COPY.currentNone} → 바꿀 ${shortBundleId('TEST_FIXTURE_BUNDLE_1')}`);
  });

  it('지금 쓰는 묶음과 같은 묶음이면 확인 단추가 없고 이유를 말한다', () => {
    const state = confirmStateOf(row('C1', 'TEST_FIXTURE_BUNDLE_1'), 'TEST_FIXTURE_BUNDLE_1', BUNDLES);
    expect(state).toEqual({ enabled: false, line: null, hint: SCOPE_COPY.sameAsCurrent });
  });

  it('중지된 묶음이나 목록에 없는 묶음은 어떻게 들어왔든 확인할 수 없다', () => {
    expect(confirmStateOf(row('C1', null), 'TEST_FIXTURE_BUNDLE_3', BUNDLES)).toMatchObject({ enabled: false, line: null, hint: SCOPE_COPY.suspendedHint });
    expect(confirmStateOf(row('C1', null), 'TEST_FIXTURE_BUNDLE_X', BUNDLES)).toMatchObject({ enabled: false, line: null, hint: SCOPE_COPY.failure.notFound });
  });

  it('요청 본문은 병원 id 없이 { ruleBundleVersionId, expectedCurrentBundleId } 이고, 기대하는 현재 적용본은 화면이 불러온 값(없으면 null)이다', () => {
    expect(assignRequestOf(row('C1', 'TEST_FIXTURE_BUNDLE_1'), 'TEST_FIXTURE_BUNDLE_2', BUNDLES)).toEqual({ ruleBundleVersionId: 'TEST_FIXTURE_BUNDLE_2', expectedCurrentBundleId: 'TEST_FIXTURE_BUNDLE_1' });
    expect(assignRequestOf(row('C1', null), 'TEST_FIXTURE_BUNDLE_2', BUNDLES)).toEqual({ ruleBundleVersionId: 'TEST_FIXTURE_BUNDLE_2', expectedCurrentBundleId: null });
  });

  it('확인할 수 없는 선택에는 요청 본문을 만들지 않는다', () => {
    expect(assignRequestOf(row('C1', 'TEST_FIXTURE_BUNDLE_1'), '', BUNDLES)).toBeNull();
    expect(assignRequestOf(row('C1', 'TEST_FIXTURE_BUNDLE_1'), 'TEST_FIXTURE_BUNDLE_1', BUNDLES)).toBeNull();
    expect(assignRequestOf(row('C1', 'TEST_FIXTURE_BUNDLE_1'), 'TEST_FIXTURE_BUNDLE_3', BUNDLES)).toBeNull();
  });
});

describe('지정 뒤 병원 줄 갱신', () => {
  it('응답의 병원 줄 하나만 바뀌고 다른 병원 줄은 같은 객체 그대로다', () => {
    const rows = [row('C1', 'TEST_FIXTURE_BUNDLE_1'), row('C2', null), row('C3', 'TEST_FIXTURE_BUNDLE_2')];
    const updated = row('C2', 'TEST_FIXTURE_BUNDLE_2');
    const next = applyAssigned(rows, updated);
    expect(next[1]).toBe(updated);
    expect(next[0]).toBe(rows[0]);
    expect(next[2]).toBe(rows[2]);
    expect(rows[1]!.current).toBeNull();
  });
});

describe('병원별 선택 한 칸', () => {
  it('한 병원의 선택만 바꾸고, 빈 값은 그 병원의 선택을 지운다 (원래 객체를 바꾸지 않는다)', () => {
    const start = { C1: 'TEST_FIXTURE_BUNDLE_1' };
    const withC2 = setDraft(start, 'C2', 'TEST_FIXTURE_BUNDLE_2');
    expect(withC2).toEqual({ C1: 'TEST_FIXTURE_BUNDLE_1', C2: 'TEST_FIXTURE_BUNDLE_2' });
    expect(start).toEqual({ C1: 'TEST_FIXTURE_BUNDLE_1' });
    expect(setDraft(withC2, 'C1', '')).toEqual({ C2: 'TEST_FIXTURE_BUNDLE_2' });
    expect(setDraft(withC2, 'C2', 'TEST_FIXTURE_BUNDLE_1')).toEqual({ C1: 'TEST_FIXTURE_BUNDLE_1', C2: 'TEST_FIXTURE_BUNDLE_1' });
  });
});

describe('다시 불러온 뒤 병원별 선택', () => {
  const oldRows = [row('C1', 'TEST_FIXTURE_BUNDLE_1'), row('C2', null), row('C3', 'TEST_FIXTURE_BUNDLE_2')];

  it('현재 적용본이 그대로인 병원의 선택은 남기고, 바뀐 병원의 선택은 지운다', () => {
    const newRows = [row('C1', 'TEST_FIXTURE_BUNDLE_2'), row('C2', null), row('C3', 'TEST_FIXTURE_BUNDLE_2')];
    const drafts = { C1: 'TEST_FIXTURE_BUNDLE_2', C2: 'TEST_FIXTURE_BUNDLE_1', C3: 'TEST_FIXTURE_BUNDLE_1' };
    expect(reconcileDrafts(drafts, oldRows, newRows, BUNDLES, [])).toEqual({ C2: 'TEST_FIXTURE_BUNDLE_1', C3: 'TEST_FIXTURE_BUNDLE_1' });
  });

  it('거절된 병원은 현재 적용본이 그대로여도 선택을 지운다', () => {
    const drafts = { C1: 'TEST_FIXTURE_BUNDLE_2', C2: 'TEST_FIXTURE_BUNDLE_1' };
    expect(reconcileDrafts(drafts, oldRows, oldRows, BUNDLES, ['C1'])).toEqual({ C2: 'TEST_FIXTURE_BUNDLE_1' });
  });

  it('더는 고를 수 없는 묶음이나 사라진 병원의 선택은 지운다', () => {
    const drafts = { C2: 'TEST_FIXTURE_BUNDLE_1', C3: 'TEST_FIXTURE_BUNDLE_1' };
    const suspendedNow = [bundle('TEST_FIXTURE_BUNDLE_1', 'SUSPENDED'), B2];
    expect(reconcileDrafts(drafts, oldRows, oldRows, suspendedNow, [])).toEqual({});
    expect(reconcileDrafts(drafts, oldRows, [oldRows[1]!], BUNDLES, [])).toEqual({ C2: 'TEST_FIXTURE_BUNDLE_1' });
  });
});

describe('서버 거절 문장', () => {
  const reply = (status: number, body: unknown) => ({ status, body: body as never });

  it('화면이 본 현재 적용본이 바뀌었다는 거절(SCOPE_CHANGED)은 그 사실과 다시 불러왔다는 말을 하고 코드 글자는 보이지 않는다', () => {
    const text = scopeFailureMessage(reply(409, { error: 'CONFLICT', reason: 'SCOPE_CHANGED' }));
    expect(text).toContain(SCOPE_COPY.failure.scopeChanged);
    expect(text).toContain('현재 적용본이 화면을 불러온 뒤');
    expect(text).not.toContain('SCOPE_CHANGED');
    expect(text.endsWith(SCOPE_COPY.nothingChanged)).toBe(true);
  });

  it('그 밖의 409·404·403·401·서버 오류는 각자 문장이고 모두 지정이 바뀌지 않았다는 말로 끝난다', () => {
    const cases: Array<[number, unknown, string]> = [
      [409, { error: 'CONFLICT', reason: 'SOMETHING_NEW' }, SCOPE_COPY.failure.conflictGeneric],
      [404, { error: 'NOT_FOUND' }, SCOPE_COPY.failure.notFound],
      [403, { error: 'FORBIDDEN' }, SCOPE_COPY.forbidden],
      [401, { error: 'UNAUTHENTICATED' }, SCOPE_COPY.unauthenticated],
      [500, { error: 'INTERNAL' }, SCOPE_COPY.failure.server],
      [400, { error: 'INVALID_REQUEST' }, SCOPE_COPY.failure.generic],
    ];
    for (const [status, body, expected] of cases) {
      const text = scopeFailureMessage(reply(status, body));
      expect(text, String(status)).toContain(expected);
      expect(text.endsWith(SCOPE_COPY.nothingChanged), String(status)).toBe(true);
      expect(text, String(status)).not.toContain('SOMETHING_NEW');
    }
  });

  it('403 은 병원 가격 관리 권한이 아니라 이 화면의 권한을 말한다', () => {
    expect(scopeFailureMessage(reply(403, {}))).not.toContain('가격');
  });
});

describe('지정 성공 안내', () => {
  it('어느 병원에 어느 묶음을 지정했는지와 다른 병원은 바뀌지 않았다는 말을 한다', () => {
    const text = assignedMessage('시험 병원 C1', 'TEST_FIXTURE_BUNDLE_2');
    expect(text).toContain('시험 병원 C1');
    expect(text).toContain(shortBundleId('TEST_FIXTURE_BUNDLE_2'));
    expect(text).toContain('다른 병원은 바뀌지 않았습니다');
  });
});
