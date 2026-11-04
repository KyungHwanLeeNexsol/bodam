import { describe, expect, it } from 'vitest';
import type { DraftView, TreatmentAdditionView, TreatmentRow } from '../../src/app/admin/api-types';
import {
  EMPTY_ADD_FORM,
  appendAddition,
  bodyOfDraft,
  buildAddition,
  canMove,
  compareCodePoints,
  draftBodyOf,
  isAmountText,
  isCalendarDate,
  isEmptyBody,
  listVisibility,
  moveRow,
  nextDraftKey,
  previewSelection,
  removeAddition,
  restoreWorking,
  rowViews,
  sameBody,
  summaryOf,
  toggleHidden,
} from '../../src/app/admin/draft-model';
import type { AddForm } from '../../src/app/admin/draft-model';

// 관리자 화면의 "원하는 초안 전체" 계산 (화면 코드 밖의 순수 함수). 시험 자료(TEST_FIXTURE)만 쓴다.
// 서버가 정한 규칙(순서의 기본값·숨김 제외·가격 수정 걸러내기)을 화면이 같은 모양으로 비교할 수 있는지를 본다. 보험금 계산은 여기에 없다.

const row = (treatmentId: string, patientAmount: number, order: number, benefitType: 'BENEFIT' | 'NON_BENEFIT' = 'BENEFIT'): TreatmentRow => ({
  treatmentId,
  displayName: `이름 ${treatmentId}`,
  description: '',
  benefitType,
  treatmentCode: `CODE_${treatmentId}`,
  procedureCodes: [],
  patientAmount,
  priceCondition: '',
  order,
});

const ROWS: TreatmentRow[] = [row('T1', 10_000, 1), row('T2', 10_000, 2, 'NON_BENEFIT'), row('T3', 11_000, 3)];

const addition = (draftKey: string, overrides: Partial<TreatmentAdditionView> = {}): TreatmentAdditionView => ({
  draftKey,
  displayName: `새 ${draftKey}`,
  description: '',
  benefitType: 'BENEFIT',
  patientAmount: 7_000,
  treatmentCode: `TC_${draftKey}`,
  procedureCodes: ['P1'],
  documentFlags: { imaging: false, biopsy: false, opinionRequired: false },
  amountCondition: { patientType: '성인', assumption: '표준', referenceDate: '2026-11-01' },
  effectiveDate: '2026-11-01',
  ...overrides,
});

const draftOf = (overrides: Partial<DraftView> = {}): DraftView => ({
  baseCatalogVersionId: 'V1',
  priceEdits: [],
  additions: [],
  deactivations: [],
  order: null,
  updatedAt: '2026-11-01T00:00:00.000Z',
  updatedBy: 'TEST_FIXTURE_HA',
  draftDigest: 'd'.repeat(64),
  stale: false,
  ...overrides,
});

const fresh = () => restoreWorking(ROWS, null);

describe('restoreWorking: 서버 응답에서 작업 상태를 다시 세운다', () => {
  it('초안이 없으면 게시된 가격·게시된 표시 순서 그대로이고 바뀐 것이 없다', () => {
    const working = fresh();
    expect(working.priceTexts).toEqual({ T1: '10000', T2: '10000', T3: '11000' });
    expect(working.rowOrder).toEqual(['T1', 'T2', 'T3']);
    expect(working.hidden).toEqual([]);
    expect(working.additions).toEqual([]);
    expect(isEmptyBody(draftBodyOf(working, ROWS).body)).toBe(true);
  });

  it('저장된 초안의 가격·새 치료·숨김·순서를 채운다 (숨긴 치료는 순서에 없지만 화면에서는 원래 자리 가까이에 남는다)', () => {
    const draft = draftOf({
      priceEdits: [{ treatmentId: 'T1', patientAmount: 12_000 }],
      additions: [addition('new-1'), addition('new-2')],
      deactivations: ['T2'],
      order: ['new-2', 'T3', 'T1', 'new-1'],
    });
    const working = restoreWorking(ROWS, draft);
    expect(working.priceTexts.T1).toBe('12000');
    expect(working.priceTexts.T3).toBe('11000');
    expect(working.hidden).toEqual(['T2']);
    expect(working.additions.map((entry) => entry.draftKey)).toEqual(['new-1', 'new-2']);
    // 숨긴 T2 는 게시 목록에서 바로 앞이던 T1 뒤에 놓인다.
    expect(working.rowOrder).toEqual(['new-2', 'T3', 'T1', 'T2', 'new-1']);
  });

  it('저장된 순서가 현재 목록과 어긋나도 던지지 않고 빠진 항목을 기본 순서 끝에 붙인다', () => {
    const working = restoreWorking(ROWS, draftOf({ order: ['T3', 'NO_SUCH', 'T1'] }));
    expect(working.rowOrder).toEqual(['T3', 'T1', 'T2']);
  });

  it('숨긴 치료가 첫 줄이면 맨 앞에, 연달아 숨기면 게시 순서대로 이어 붙는다', () => {
    const working = restoreWorking(ROWS, draftOf({ deactivations: ['T1', 'T2'] }));
    expect(working.rowOrder).toEqual(['T1', 'T2', 'T3']);
    expect(restoreWorking(ROWS, draftOf({ deactivations: ['T1'], order: ['T3', 'T2'] })).rowOrder).toEqual(['T1', 'T3', 'T2']);
  });
});

describe('draftBodyOf: 화면 상태에서 PUT 본문을 만든다 (서버가 저장할 모양과 같다)', () => {
  it('현재 가격과 같은 가격은 가격 수정이 아니다. 바뀐 가격은 id 순으로 나간다', () => {
    const working = { ...fresh(), priceTexts: { T1: '10000', T2: '10000', T3: '12000' } };
    expect(draftBodyOf({ ...working, priceTexts: { ...working.priceTexts, T1: '9000' } }, ROWS).body.priceEdits).toEqual([
      { treatmentId: 'T1', patientAmount: 9_000 },
      { treatmentId: 'T3', patientAmount: 12_000 },
    ]);
    expect(draftBodyOf(working, ROWS).body.priceEdits).toEqual([{ treatmentId: 'T3', patientAmount: 12_000 }]);
  });

  it('숨긴 치료는 가격 수정에서 빠지고 순서에서도 빠지며 숨김 목록에 코드 포인트 순으로 들어간다', () => {
    const hidden = toggleHidden(toggleHidden({ ...fresh(), priceTexts: { T1: '1', T2: '10000', T3: '11000' } }, 'T3'), 'T1');
    const { body, invalid } = draftBodyOf(hidden, ROWS);
    expect(invalid).toBe(false);
    expect(body.priceEdits).toEqual([]);
    expect(body.deactivations).toEqual(['T1', 'T3']);
    expect(body.order).toBeNull();
    // 숨김을 취소하면 입력해 두었던 가격이 되살아난다.
    expect(draftBodyOf(toggleHidden(hidden, 'T1'), ROWS).body.priceEdits).toEqual([{ treatmentId: 'T1', patientAmount: 1 }]);
  });

  it('순서가 기본 순서와 같으면 order 는 null 이고(서버와 같은 정규형), 다르면 보이는 줄만 순서대로 나간다', () => {
    const moved = moveRow(fresh(), 'T3', -1);
    expect(draftBodyOf(moved, ROWS).body.order).toEqual(['T1', 'T3', 'T2']);
    expect(draftBodyOf(moveRow(moved, 'T3', 1), ROWS).body.order).toBeNull();
    // 숨긴 줄이 사이에 있어도 보이는 줄끼리의 순서만 본다.
    expect(draftBodyOf(toggleHidden(moved, 'T2'), ROWS).body.order).toBeNull();
  });

  it('새 치료는 만든 순서대로 additions 에 들어가고, 기본 순서는 새 치료를 그 순서대로 뒤에 붙인 것이다', () => {
    const two = appendAddition(appendAddition(fresh(), addition('new-1')), addition('new-2'));
    const { body } = draftBodyOf(two, ROWS);
    expect(body.additions.map((entry) => entry.draftKey)).toEqual(['new-1', 'new-2']);
    expect(body.order).toBeNull();
    expect(draftBodyOf(moveRow(two, 'new-2', -1), ROWS).body.order).toEqual(['T1', 'T2', 'T3', 'new-2', 'new-1']);
  });

  it('보이는 줄에 잘못된 가격 글자가 있으면 invalid 이고, 숨긴 줄의 글자는 보지 않는다', () => {
    const bad = { ...fresh(), priceTexts: { T1: 'abc', T2: '10000', T3: '11000' } };
    expect(draftBodyOf(bad, ROWS).invalid).toBe(true);
    expect(draftBodyOf(toggleHidden(bad, 'T1'), ROWS).invalid).toBe(false);
    expect(draftBodyOf({ ...fresh(), priceTexts: { T1: '-5', T2: '10000', T3: '11000' } }, ROWS).invalid).toBe(true);
    expect(draftBodyOf({ ...fresh(), priceTexts: { T1: '', T2: '10000', T3: '11000' } }, ROWS).invalid).toBe(true);
  });
});

describe('저장된 초안과의 구조 비교 (sameBody)', () => {
  it('서버가 돌려준 초안과 같은 내용이면 키 순서·항목 복사 방식과 상관없이 같다', () => {
    const working = appendAddition({ ...toggleHidden(fresh(), 'T2'), priceTexts: { T1: '12000', T2: '10000', T3: '11000' } }, addition('new-1'));
    const saved = draftOf({
      priceEdits: [{ patientAmount: 12_000, treatmentId: 'T1' }],
      additions: [{ ...addition('new-1'), documentFlags: { opinionRequired: false, biopsy: false, imaging: false } }],
      deactivations: ['T2'],
      order: null,
    });
    expect(sameBody(draftBodyOf(working, ROWS).body, bodyOfDraft(saved))).toBe(true);
  });

  it('가격·새 치료 내용·숨김·순서 가운데 하나라도 다르면 다르다', () => {
    const base = draftOf({ priceEdits: [{ treatmentId: 'T1', patientAmount: 12_000 }], additions: [addition('new-1')], deactivations: ['T2'], order: ['T3', 'T1', 'new-1'] });
    const working = restoreWorking(ROWS, base);
    const body = draftBodyOf(working, ROWS).body;
    expect(sameBody(body, bodyOfDraft(base))).toBe(true);
    expect(sameBody(body, bodyOfDraft({ ...base, priceEdits: [{ treatmentId: 'T1', patientAmount: 12_001 }] }))).toBe(false);
    expect(sameBody(body, bodyOfDraft({ ...base, additions: [addition('new-1', { patientAmount: 7_001 })] }))).toBe(false);
    expect(sameBody(body, bodyOfDraft({ ...base, additions: [addition('new-1', { procedureCodes: ['P1', 'P2'] })] }))).toBe(false);
    expect(sameBody(body, bodyOfDraft({ ...base, deactivations: ['T3'] }))).toBe(false);
    expect(sameBody(body, bodyOfDraft({ ...base, order: ['T1', 'T3', 'new-1'] }))).toBe(false);
    expect(sameBody(body, bodyOfDraft({ ...base, order: null }))).toBe(false);
  });
});

describe('행 이동·숨김·새 치료 삭제', () => {
  it('위로/아래로: 줄이 한 칸씩 움직이고 양 끝에서는 움직일 수 없다', () => {
    const working = fresh();
    expect(canMove(working, 'T1', -1)).toBe(false);
    expect(canMove(working, 'T3', 1)).toBe(false);
    expect(canMove(working, 'T2', -1)).toBe(true);
    expect(moveRow(working, 'T1', -1)).toBe(working);
    expect(moveRow(working, 'T2', -1).rowOrder).toEqual(['T2', 'T1', 'T3']);
    expect(moveRow(working, 'T2', 1).rowOrder).toEqual(['T1', 'T3', 'T2']);
  });

  it('숨긴 줄은 건너뛰어 가까운 보이는 줄과 자리를 바꾸고, 숨긴 줄 자신은 움직일 수 없다', () => {
    const hiddenMiddle = toggleHidden(fresh(), 'T2');
    expect(canMove(hiddenMiddle, 'T2', -1)).toBe(false);
    expect(canMove(hiddenMiddle, 'T2', 1)).toBe(false);
    expect(canMove(hiddenMiddle, 'T3', -1)).toBe(true);
    expect(draftBodyOf(moveRow(hiddenMiddle, 'T3', -1), ROWS).body.order).toEqual(['T3', 'T1']);
    // 보이는 줄이 하나뿐이면 어디로도 못 간다.
    const onlyOne = toggleHidden(hiddenMiddle, 'T3');
    expect(canMove(onlyOne, 'T1', 1)).toBe(false);
  });

  it('숨기기·숨김 취소는 서로 되돌린다', () => {
    const working = fresh();
    expect(toggleHidden(working, 'T2').hidden).toEqual(['T2']);
    expect(toggleHidden(toggleHidden(working, 'T2'), 'T2').hidden).toEqual([]);
  });

  it('새 치료 삭제는 목록과 순서에서 지우고, 다른 줄은 건드리지 않는다', () => {
    const working = appendAddition(appendAddition(fresh(), addition('new-1')), addition('new-2'));
    const removed = removeAddition(working, 'new-1');
    expect(removed.additions.map((entry) => entry.draftKey)).toEqual(['new-2']);
    expect(removed.rowOrder).toEqual(['T1', 'T2', 'T3', 'new-2']);
  });
});

describe('nextDraftKey: 무작위·시계 없이 정해진 이름표를 낸다', () => {
  it('처음은 new-1, 이어서 가장 큰 번호 다음이다 (저장된 초안을 불러온 뒤에도 겹치지 않는다)', () => {
    expect(nextDraftKey(fresh(), ROWS)).toBe('new-1');
    expect(nextDraftKey(appendAddition(fresh(), addition('new-1')), ROWS)).toBe('new-2');
    expect(nextDraftKey(restoreWorking(ROWS, draftOf({ additions: [addition('new-2'), addition('new-7')] })), ROWS)).toBe('new-8');
  });

  it('게시된 치료 id 와 같은 이름표는 건너뛴다', () => {
    const rows = [row('new-1', 1_000, 1), row('new-2', 1_000, 2)];
    expect(nextDraftKey(restoreWorking(rows, null), rows)).toBe('new-3');
  });
});

describe('rowViews: 줄마다 상태·순번·움직일 수 있는 방향', () => {
  it('아무것도 안 바꾸면 모든 줄이 변경 없음이고 순번은 1부터다', () => {
    const views = rowViews(fresh(), ROWS);
    expect(views.map((view) => [view.key, view.position, view.hidden, view.priceChanged, view.moved, view.isNew])).toEqual([
      ['T1', 1, false, false, false, false],
      ['T2', 2, false, false, false, false],
      ['T3', 3, false, false, false, false],
    ]);
    expect(views.map((view) => [view.canMoveUp, view.canMoveDown])).toEqual([[false, true], [true, true], [true, false]]);
  });

  it('숨긴 줄은 순번이 없고 뒤 줄의 순번이 당겨진다. 순서가 바뀐 줄은 남는 줄끼리의 순위가 달라진 줄이다', () => {
    const working = toggleHidden(fresh(), 'T1');
    const views = rowViews(working, ROWS);
    expect(views.map((view) => [view.key, view.position, view.hidden])).toEqual([['T1', null, true], ['T2', 1, false], ['T3', 2, false]]);
    // 숨겨서 번호만 밀린 것은 순서 변경이 아니다.
    expect(views.some((view) => view.moved)).toBe(false);
    const swapped = rowViews(moveRow(fresh(), 'T3', -1), ROWS);
    expect(swapped.filter((view) => view.moved).map((view) => view.key).sort()).toEqual(['T2', 'T3']);
  });

  it('새 치료 줄은 새 치료이고 가격 글자 대신 자기 가격을 가진다. 가격이 바뀐 줄·잘못된 글자는 따로 표시된다', () => {
    const working = appendAddition({ ...fresh(), priceTexts: { T1: '12000', T2: 'x', T3: '11000' } }, addition('new-1'));
    const views = rowViews(working, ROWS);
    const byKey = Object.fromEntries(views.map((view) => [view.key, view]));
    expect(byKey['T1']).toMatchObject({ priceChanged: true, priceInvalid: false, currentPrice: 10_000 });
    expect(byKey['T2']).toMatchObject({ priceChanged: false, priceInvalid: true });
    expect(byKey['new-1']).toMatchObject({ isNew: true, treatmentId: null, newPrice: 7_000, priceText: null, position: 4 });
  });
});

describe('buildAddition: 새 치료 입력칸 검사 (서버가 거절하는 것만 거른다)', () => {
  const filled = (overrides: Partial<AddForm> = {}): AddForm => ({
    ...EMPTY_ADD_FORM,
    displayName: '  시험 치료  ',
    description: '  설명  ',
    benefitType: 'NON_BENEFIT',
    patientAmount: '12000',
    treatmentCode: ' TC ',
    procedureCodes: 'P1, P2 ,, P3',
    patientType: '성인',
    assumption: '표준',
    referenceDate: '2026-11-01',
    effectiveDate: '2026-11-02',
    ...overrides,
  });

  it('올바른 입력은 앞뒤 공백을 다듬고 쉼표로 나눈 행위 코드의 빈 칸을 버린다. 서류 표시는 기본이 모두 꺼짐이다', () => {
    const result = buildAddition(filled(), 'new-1');
    expect(result).toEqual({
      ok: true,
      addition: {
        draftKey: 'new-1',
        displayName: '시험 치료',
        description: '설명',
        benefitType: 'NON_BENEFIT',
        patientAmount: 12_000,
        treatmentCode: 'TC',
        procedureCodes: ['P1', 'P2', 'P3'],
        documentFlags: { imaging: false, biopsy: false, opinionRequired: false },
        amountCondition: { patientType: '성인', assumption: '표준', referenceDate: '2026-11-01' },
        effectiveDate: '2026-11-02',
      },
    });
    expect(EMPTY_ADD_FORM.imaging || EMPTY_ADD_FORM.biopsy || EMPTY_ADD_FORM.opinionRequired).toBe(false);
  });

  it('행위 코드는 비워도 되고, 설명은 선택이다', () => {
    const result = buildAddition(filled({ procedureCodes: '', description: '' }), 'new-1');
    expect(result.ok && result.addition.procedureCodes).toEqual([]);
    expect(result.ok && result.addition.description).toBe('');
  });

  it('서류 표시 세 칸은 체크한 대로 들어간다', () => {
    const result = buildAddition(filled({ imaging: true, opinionRequired: true }), 'new-1');
    expect(result.ok && result.addition.documentFlags).toEqual({ imaging: true, biopsy: false, opinionRequired: true });
  });

  it.each<[string, Partial<AddForm>, string, string]>([
    ['이름이 비어 있음', { displayName: '   ' }, 'displayName', 'REQUIRED'],
    ['가격이 비어 있음', { patientAmount: '' }, 'patientAmount', 'AMOUNT'],
    ['가격이 음수', { patientAmount: '-1' }, 'patientAmount', 'AMOUNT'],
    ['가격이 소수', { patientAmount: '10.5' }, 'patientAmount', 'AMOUNT'],
    ['치료 코드가 비어 있음', { treatmentCode: '' }, 'treatmentCode', 'REQUIRED'],
    ['환자 유형이 비어 있음', { patientType: '' }, 'patientType', 'REQUIRED'],
    ['가정이 비어 있음', { assumption: ' ' }, 'assumption', 'REQUIRED'],
    ['기준일이 날짜 모양이 아님', { referenceDate: '2026/11/01' }, 'referenceDate', 'DATE'],
    ['적용일이 달력에 없음', { effectiveDate: '2026-02-30' }, 'effectiveDate', 'DATE'],
    ['적용일이 비어 있음', { effectiveDate: '' }, 'effectiveDate', 'DATE'],
  ])('거절: %s', (_name, overrides, field, code) => {
    const result = buildAddition(filled(overrides), 'new-1');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[field as keyof typeof result.errors]).toBe(code);
  });

  it('틀린 칸이 여럿이면 모두 알린다', () => {
    const result = buildAddition(filled({ displayName: '', patientAmount: 'x', effectiveDate: '' }), 'new-1');
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(['displayName', 'effectiveDate', 'patientAmount']);
  });
});

describe('previewSelection: 미리보기에서 계산할 치료', () => {
  it('저장된 초안이 가격을 바꾼 치료는 항상 들어가고, 숨길 치료는 제안도 선택도 되지 않는다', () => {
    const draft = draftOf({ priceEdits: [{ treatmentId: 'T1', patientAmount: 12_000 }], deactivations: ['T2'] });
    const selection = previewSelection(ROWS, draft, { T2: true, T3: true });
    expect(selection.offered.map((entry) => entry.treatmentId)).toEqual(['T1', 'T3']);
    expect([...selection.required]).toEqual(['T1']);
    expect(selection.treatmentIds).toEqual(['T1', 'T3']);
  });

  it('가격 수정이 없고 고른 치료도 없으면 목록이 비어 있다 (요청 본문에서 treatmentIds 를 뺀다)', () => {
    expect(previewSelection(ROWS, draftOf({ deactivations: ['T2'] }), {}).treatmentIds).toEqual([]);
    expect(previewSelection(ROWS, null, { T1: true }).treatmentIds).toEqual(['T1']);
  });
});

describe('summaryOf', () => {
  it('가격 변경·추가·숨김 건수와 순서 변경 여부를 센다', () => {
    const working = moveRow(appendAddition(toggleHidden({ ...fresh(), priceTexts: { T1: '1', T2: '10000', T3: '11000' } }, 'T2'), addition('new-1')), 'new-1', -1);
    expect(summaryOf(draftBodyOf(working, ROWS).body)).toEqual({ priceChanged: 1, added: 1, hidden: 1, reordered: true });
  });
});

describe('listVisibility: 게시된 카탈로그가 없을 때만 화면 전체를 숨긴다', () => {
  it('카탈로그가 없으면 none, 카탈로그는 있는데 활성 치료가 없으면 empty(새 치료 추가·미리보기·이력은 계속 보인다), 치료가 있으면 normal', () => {
    expect(listVisibility(null, 0)).toBe('none');
    expect(listVisibility(null, 3)).toBe('none');
    expect(listVisibility('V1', 0)).toBe('empty');
    expect(listVisibility('V1', 2)).toBe('normal');
  });
});

describe('작은 도우미', () => {
  it('compareCodePoints: 코드 포인트 순 (서버가 저장하는 순서와 같다)', () => {
    expect(['b', 'a', 'B', 'A1', 'A'].sort(compareCodePoints)).toEqual(['A', 'A1', 'B', 'a', 'b']);
  });

  it('isAmountText: 숫자만, 앞뒤 공백은 허용하고 소수·음수·빈 글자는 거절', () => {
    expect([' 12000 ', '0', '12000'].every(isAmountText)).toBe(true);
    expect(['', '-5', '1.5', 'abc', '1,000'].some(isAmountText)).toBe(false);
    expect(isAmountText('9'.repeat(30))).toBe(false);
  });

  it('isCalendarDate: 달력에 실제로 있는 YYYY-MM-DD 만', () => {
    expect(['2026-11-01', '2024-02-29'].every(isCalendarDate)).toBe(true);
    expect(['2026-02-29', '2026-13-01', '2026-11-00', '26-11-01', '', '2026-1-1'].some(isCalendarDate)).toBe(false);
  });
});
