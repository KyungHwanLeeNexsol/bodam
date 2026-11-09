import { describe, expect, it } from 'vitest';
import type { DraftView, TreatmentAdditionView, TreatmentRow } from '../../src/app/admin/api-types';
import {
  appendAddition,
  bodyOfDraft,
  canMove,
  draftBodyOf,
  isEmptyBody,
  moveRow,
  nextDraftKey,
  restoreWorking,
  rowViews,
  sameBody,
  summaryOf,
  toggleHidden,
  toggleReshow,
  visibleKeys,
} from '../../src/app/admin/draft-model';

// 관리자 화면의 "숨긴 치료 다시 표시" 계산 (화면 코드 밖의 순수 함수). 시험 자료(TEST_FIXTURE)만 쓴다.
// 서버가 정한 규칙을 같은 모양으로 따르는지 본다: 기본 위치 = 남는 기존 치료 → 다시 표시(서버가 준 숨긴 치료의 예전 표시 순서) → 새 치료,
// 기본 순서와 같은 최종 순서는 order null 로 줄인다, 다시 표시만 있는 초안도 "변경 있음"이다. 보장 승인·가격 수정은 이 파일에 없다.

const row = (treatmentId: string, order: number, patientAmount = 10_000): TreatmentRow => ({
  treatmentId,
  displayName: `이름 ${treatmentId}`,
  description: '',
  benefitType: 'BENEFIT',
  treatmentCode: `C_${treatmentId}`,
  procedureCodes: [],
  patientAmount,
  priceCondition: '',
  order,
});

const ROWS: TreatmentRow[] = [row('T1', 1), row('T2', 2), row('T3', 3)];
/** 서버가 준 숨긴 치료(예전 표시 순서). H1 과 H2 는 번호가 같아 서버가 id 순으로 준다. */
const HIDDEN: TreatmentRow[] = [row('H1', 1, 7_000), row('H2', 1, 8_000), row('H3', 5, 9_000)];

const addition = (draftKey: string): TreatmentAdditionView => ({
  draftKey,
  displayName: `새 ${draftKey}`,
  description: '',
  benefitType: 'BENEFIT',
  patientAmount: 7_000,
  treatmentCode: `TC_${draftKey}`,
  procedureCodes: [],
  documentFlags: { imaging: false, biopsy: false, opinionRequired: false },
  amountCondition: { patientType: '성인', assumption: '표준', referenceDate: '2026-11-01' },
  effectiveDate: '2026-11-01',
});

const draftOf = (overrides: Partial<DraftView> = {}): DraftView => ({
  baseCatalogVersionId: 'V1',
  priceEdits: [],
  baseFeeEdits: [],
  additions: [],
  deactivations: [],
  reactivations: [],
  order: null,
  updatedAt: '2026-11-01T00:00:00.000Z',
  updatedBy: 'TEST_FIXTURE_HA',
  draftDigest: 'd'.repeat(64),
  stale: false,
  ...overrides,
});

const fresh = () => restoreWorking(ROWS, null, [], HIDDEN);
const bodyOf = (working: ReturnType<typeof fresh>) => draftBodyOf(working, ROWS, [], HIDDEN).body;

describe('toggleReshow: 숨긴 치료를 다시 표시하기로 고른다', () => {
  it('고르면 남는 기존 치료의 뒤에 놓이고, 다시 고르면 되돌아간다 (원래 상태와 같은 객체 내용)', () => {
    const picked = toggleReshow(fresh(), ROWS, HIDDEN, 'H2');
    expect(picked.reshown).toEqual(['H2']);
    expect(picked.rowOrder).toEqual(['T1', 'T2', 'T3', 'H2']);
    expect(toggleReshow(picked, ROWS, HIDDEN, 'H2')).toEqual(fresh());
  });

  it('여러 개는 고른 순서와 무관하게 서버가 준 예전 표시 순서대로 놓인다', () => {
    const forward = toggleReshow(toggleReshow(fresh(), ROWS, HIDDEN, 'H1'), ROWS, HIDDEN, 'H2');
    const backward = toggleReshow(toggleReshow(fresh(), ROWS, HIDDEN, 'H2'), ROWS, HIDDEN, 'H1');
    expect(forward.rowOrder).toEqual(['T1', 'T2', 'T3', 'H1', 'H2']);
    expect(backward.rowOrder).toEqual(['T1', 'T2', 'T3', 'H1', 'H2']);
    const all = toggleReshow(toggleReshow(toggleReshow(fresh(), ROWS, HIDDEN, 'H3'), ROWS, HIDDEN, 'H1'), ROWS, HIDDEN, 'H2');
    expect(all.rowOrder).toEqual(['T1', 'T2', 'T3', 'H1', 'H2', 'H3']);
  });

  it('새 치료보다는 앞에 놓인다 (새 치료를 먼저 추가했어도)', () => {
    const withNew = appendAddition(fresh(), addition('new-1'));
    expect(toggleReshow(withNew, ROWS, HIDDEN, 'H1').rowOrder).toEqual(['T1', 'T2', 'T3', 'H1', 'new-1']);
  });

  it('숨김 예정인 기존 치료 줄이 있어도 마지막 기존 치료 줄 바로 뒤에 놓인다', () => {
    const hiddenLast = toggleHidden(fresh(), 'T3');
    expect(toggleReshow(hiddenLast, ROWS, HIDDEN, 'H1').rowOrder).toEqual(['T1', 'T2', 'T3', 'H1']);
  });

  it('서버가 준 숨긴 치료에 없는 id 는 무시한다 (같은 객체를 돌려준다)', () => {
    const working = fresh();
    expect(toggleReshow(working, ROWS, HIDDEN, 'NOPE')).toBe(working);
    expect(toggleReshow(working, ROWS, HIDDEN, 'T1')).toBe(working); // 표시 중인 치료는 다시 표시 대상이 아니다
  });

  it('입력을 바꾸지 않는다', () => {
    const working = fresh();
    const snapshot = JSON.stringify(working);
    toggleReshow(working, ROWS, HIDDEN, 'H1');
    expect(JSON.stringify(working)).toBe(snapshot);
  });
});

describe('draftBodyOf: 다시 표시를 본문에 담는다', () => {
  it('reactivations 는 코드 포인트 순이고, 기본 위치에 있으면 order 는 null 이다', () => {
    const working = toggleReshow(toggleReshow(fresh(), ROWS, HIDDEN, 'H2'), ROWS, HIDDEN, 'H1');
    const body = bodyOf(working);
    expect(body.reactivations).toEqual(['H1', 'H2']);
    expect(body.order).toBeNull();
    expect(body.deactivations).toEqual([]);
    expect(body.priceEdits).toEqual([]);
  });

  it('다시 표시만 있는 본문도 "변경 있음"이다 (isEmptyBody 가 false)', () => {
    expect(isEmptyBody(bodyOf(fresh()))).toBe(true);
    expect(isEmptyBody(bodyOf(toggleReshow(fresh(), ROWS, HIDDEN, 'H1')))).toBe(false);
  });

  it('줄을 옮기면 명시적인 최종 순서(다시 표시 줄 포함)를 보낸다', () => {
    const moved = moveRow(toggleReshow(fresh(), ROWS, HIDDEN, 'H1'), 'H1', -1);
    const body = bodyOf(moved);
    expect(body.order).toEqual(['T1', 'T2', 'H1', 'T3']);
    expect(visibleKeys(moved)).toEqual(['T1', 'T2', 'H1', 'T3']);
  });

  it('새 치료와 함께면 기본 순서는 기존 → 다시 표시 → 새 치료다 (order null)', () => {
    const working = appendAddition(toggleReshow(fresh(), ROWS, HIDDEN, 'H1'), addition('new-1'));
    expect(bodyOf(working).order).toBeNull();
    expect(bodyOf(moveRow(working, 'new-1', -1)).order).toEqual(['T1', 'T2', 'T3', 'new-1', 'H1']);
  });

  it('숨김과 다시 표시는 서로 다른 치료에 대해 함께 보낼 수 있고, 다시 표시한 줄은 숨기기 대상이 아니다', () => {
    const working = toggleHidden(toggleReshow(fresh(), ROWS, HIDDEN, 'H1'), 'T2');
    const body = bodyOf(working);
    expect(body.deactivations).toEqual(['T2']);
    expect(body.reactivations).toEqual(['H1']);
    expect(body.order).toBeNull(); // 기본 순서: T1, T3, H1
  });

  it('서버가 준 숨긴 치료 목록에 없는 id 는 본문에서 빠진다', () => {
    const stale = { ...toggleReshow(fresh(), ROWS, HIDDEN, 'H1'), reshown: ['H1', 'GONE'] };
    expect(bodyOf(stale).reactivations).toEqual(['H1']);
  });

  it('숨긴 치료 목록을 넘기지 않으면 다시 표시는 본문에 담기지 않는다 (이전 서버 응답과 호환)', () => {
    const working = toggleReshow(fresh(), ROWS, HIDDEN, 'H1');
    expect(draftBodyOf(working, ROWS).body.reactivations).toEqual([]);
  });
});

describe('restoreWorking: 저장된 초안의 다시 표시를 채운다', () => {
  it('초안이 다시 표시하기로 한 치료가 기본 위치에 놓인다', () => {
    const working = restoreWorking(ROWS, draftOf({ reactivations: ['H2', 'H1'] }), [], HIDDEN);
    expect(working.reshown).toEqual(['H1', 'H2']);
    expect(working.rowOrder).toEqual(['T1', 'T2', 'T3', 'H1', 'H2']);
  });

  it('초안의 명시적 순서를 따른다', () => {
    const working = restoreWorking(ROWS, draftOf({ reactivations: ['H1'], order: ['H1', 'T1', 'T2', 'T3'] }), [], HIDDEN);
    expect(working.rowOrder).toEqual(['H1', 'T1', 'T2', 'T3']);
  });

  it('숨긴 치료 목록에 더는 없는 id 는 조용히 빠진다 (낡은 초안)', () => {
    const working = restoreWorking(ROWS, draftOf({ reactivations: ['GONE', 'H1'] }), [], HIDDEN);
    expect(working.reshown).toEqual(['H1']);
    expect(working.rowOrder).not.toContain('GONE');
  });

  it('초안이 없거나 숨긴 치료 목록을 모르면 다시 표시는 비어 있다', () => {
    expect(restoreWorking(ROWS, null, [], HIDDEN).reshown).toEqual([]);
    expect(restoreWorking(ROWS, draftOf({ reactivations: ['H1'] })).reshown).toEqual([]);
  });

  it('저장한 본문을 그대로 되살리면 같은 본문이 나온다 (왕복)', () => {
    const body = bodyOf(appendAddition(toggleHidden(toggleReshow(fresh(), ROWS, HIDDEN, 'H2'), 'T1'), addition('new-1')));
    const saved = draftOf({ ...body, priceEdits: body.priceEdits, baseFeeEdits: body.baseFeeEdits });
    const restored = restoreWorking(ROWS, saved, [], HIDDEN);
    expect(sameBody(draftBodyOf(restored, ROWS, [], HIDDEN).body, bodyOfDraft(saved))).toBe(true);
  });
});

describe('sameBody / bodyOfDraft: 다시 표시가 비교에 들어간다', () => {
  it('다시 표시가 다르면 다른 본문이다 (저장된 초안과 같은지 판단이 어긋나지 않는다)', () => {
    const left = bodyOfDraft(draftOf({ reactivations: ['H1'] }));
    expect(sameBody(left, bodyOfDraft(draftOf({ reactivations: ['H2'] })))).toBe(false);
    expect(sameBody(left, bodyOfDraft(draftOf()))).toBe(false);
  });

  it('순서만 다른 목록은 같은 본문이다', () => {
    expect(sameBody(bodyOfDraft(draftOf({ reactivations: ['H2', 'H1'] })), bodyOfDraft(draftOf({ reactivations: ['H1', 'H2'] })))).toBe(true);
  });
});

describe('rowViews: 다시 표시 줄', () => {
  it('가격 입력칸이 없고(priceText null) 숨기기 전 가격을 보이며, 기본 위치 번호를 갖는다', () => {
    const views = rowViews(toggleReshow(fresh(), ROWS, HIDDEN, 'H1'), ROWS, HIDDEN);
    const view = views.find((entry) => entry.key === 'H1')!;
    expect(view).toMatchObject({ reshown: true, isNew: false, hidden: false, priceText: null, currentPrice: null, newPrice: 7_000, priceChanged: false, priceInvalid: false, position: 4, moved: false });
    expect(views.map((entry) => entry.reshown)).toEqual([false, false, false, true]);
  });

  it('다시 표시 줄이 끼어도 남는 기존 치료의 "순서 바뀜" 표시는 그대로 없다 (서버가 순서 변경으로 세지 않는다)', () => {
    const views = rowViews(moveRow(toggleReshow(fresh(), ROWS, HIDDEN, 'H1'), 'H1', -1), ROWS, HIDDEN);
    expect(views.filter((entry) => !entry.reshown).map((entry) => entry.moved)).toEqual([false, false, false]);
  });

  it('다시 표시 줄도 옮길 수 있다 (맨 아래는 아래로 못 옮기고 위로는 옮긴다)', () => {
    const working = toggleReshow(fresh(), ROWS, HIDDEN, 'H1');
    expect(canMove(working, 'H1', 1)).toBe(false);
    expect(canMove(working, 'H1', -1)).toBe(true);
  });

  it('다시 표시로 고르지 않은 숨긴 치료는 목록 줄이 되지 않는다', () => {
    expect(rowViews(fresh(), ROWS, HIDDEN).map((entry) => entry.key)).toEqual(['T1', 'T2', 'T3']);
  });

  it('숨긴 치료 목록을 모르면 다시 표시 줄은 만들지 않는다', () => {
    const working = toggleReshow(fresh(), ROWS, HIDDEN, 'H1');
    expect(rowViews(working, ROWS).map((entry) => entry.key)).toEqual(['T1', 'T2', 'T3']);
  });
});

describe('그 밖의 계산', () => {
  it('summaryOf 는 다시 표시 건수를 센다', () => {
    expect(summaryOf(bodyOf(toggleReshow(toggleReshow(fresh(), ROWS, HIDDEN, 'H1'), ROWS, HIDDEN, 'H2')))).toMatchObject({ reshown: 2, hidden: 0, added: 0 });
  });

  it('nextDraftKey 는 숨긴 치료 id 와도 겹치지 않는다', () => {
    const hidden = [row('new-1', 1), row('new-2', 2)];
    expect(nextDraftKey(restoreWorking(ROWS, null, [], hidden), ROWS, hidden)).toBe('new-3');
    expect(nextDraftKey(restoreWorking(ROWS, null), ROWS)).toBe('new-1');
  });
});
