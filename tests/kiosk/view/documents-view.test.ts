import { describe, expect, it } from 'vitest';
import { DOCUMENT_LINE_KEYS } from '../../../src/engine/types';
import type { DocumentLine, DocumentsResult } from '../../../src/engine/types';
import type { CauseCode } from '../../../src/app/kiosk/state/api-types';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { DOCUMENT_NAME, DOCUMENT_PAGE_SIZE, buildDocumentsView, groupOfPage, pageOfDocuments, pageSizeFor } from '../../../src/app/kiosk/view/documents-view';
import { docLine, estimatedResponse, notCoveredResponse, resultStateWith, singleCauseDocuments, unknownCauseDocuments } from '../../fixtures/kiosk/estimate.fixture';

// 필요 서류 화면의 읽기 전용 값 (SPEC-REIMBURSEMENT-001 M6 S3b, design.md DD-06·DD-12, AC-007g·i, AC-014c·g).
// 서류 목록은 응답(documents)의 값 그대로다: 키오스크가 서류를 더하거나 줄이지 않는다. 규칙을 쓸 수 없으면 목록이 아니라 안내 문구다.
// 쪽 나눔은 줄이 빠지거나 반복되지 않고 체크·사유를 그대로 둔다.

function stateWith(documents: DocumentsResult | null, cause: CauseCode = 'INJURY', patch: Partial<KioskState> = {}): KioskState {
  const base = resultStateWith(estimatedResponse({ documents }), patch);
  return { ...base, inputs: { ...base.inputs, cause }, screen: cause === 'UNKNOWN' ? 'K07_Documents_Unknown' : 'K07_Documents' };
}

const NINE = [...DOCUMENT_LINE_KEYS];

describe('고정 9줄 (SINGLE_CAUSE)', () => {
  it('응답 줄의 순서와 관계없이 고정 순서의 아홉 줄이고, 필요 여부·사유가 응답 그대로다', () => {
    const shuffled = [...(singleCauseDocuments().state === 'AVAILABLE' ? (singleCauseDocuments() as { lines: DocumentLine[] }).lines : [])].reverse();
    const view = buildDocumentsView(stateWith(singleCauseDocuments({ lines: shuffled })));
    expect(view?.available).toBe(true);
    expect(view?.entries.map((entry) => entry.line.key)).toEqual(NINE);
    expect(view?.entries.map((entry) => entry.line.name)).toEqual(NINE.map((key) => DOCUMENT_NAME[key]));
    const required = view?.entries.filter((entry) => entry.line.required).map((entry) => entry.line.key);
    expect(required).toEqual(['OUTPATIENT_CONFIRMATION', 'RECEIPT_AND_ITEMIZED', 'INITIAL_EXAM_RECORD', 'MEDICAL_OPINION', 'IMAGING_READING']);
    const imaging = view?.entries.find((entry) => entry.line.key === 'IMAGING_READING')?.line;
    expect(imaging?.reasons).toEqual(['X-ray · 초음파 검사가 있어 필요합니다.']);
    expect(view?.entries.find((entry) => entry.line.key === 'DIAGNOSIS_CERT')?.line.reasons).toEqual([]);
  });

  it('줄 이름은 디자인의 아홉 줄 이름이다 (영수증·세부내역서는 한 줄)', () => {
    expect(NINE.map((key) => DOCUMENT_NAME[key])).toEqual(['진단서', '통원확인서', '진료확인서', '영수증 · 세부내역서', '초진기록지', '입퇴원확인서', '소견서', '판독지', '조직검사결과지']);
  });

  it('청구 기준과 선택한 치료는 환자가 고른 값과 병원 자료에서 온다', () => {
    const view = buildDocumentsView(stateWith(singleCauseDocuments()));
    expect(view?.claimBasis).toBe('상해 · 손해보험사 · 통원');
    expect(view?.treatmentSummary).toBe('TEST_FIXTURE X-ray, TEST_FIXTURE 초음파, TEST_FIXTURE 신장분사치료, TEST_FIXTURE 물리치료 (4개)');
    expect(view?.compactLine).toBe('상해 · 손해보험사 · 통원 · 치료 4개');
    expect(buildDocumentsView(stateWith(singleCauseDocuments(), 'ILLNESS'))?.claimBasis).toBe('질병 · 손해보험사 · 통원');
  });

  it('보장 제외 결과에서 들어와도 같다 (결과 종류와 무관)', () => {
    const state = { ...resultStateWith(notCoveredResponse({ documents: singleCauseDocuments() })), screen: 'K07_Documents' as const };
    expect(buildDocumentsView(state)?.entries).toHaveLength(9);
  });

  it('안내 문구는 기획서 §4 의 고정 문장이다', () => {
    expect(buildDocumentsView(stateWith(singleCauseDocuments()))?.hint).toBe('서류는 병원 원무과에서 발급합니다. 보험사와 상품에 따라 추가 서류를 요구할 수 있습니다.');
  });
});

describe('원인 모름 (UNKNOWN_CAUSE): 세 범위에 줄이 정확히 한 번씩', () => {
  const view = (documents: DocumentsResult | null = unknownCauseDocuments()) => buildDocumentsView(stateWith(documents, 'UNKNOWN'));

  it('공통(필요한 줄이 먼저) → 상해 전용 → 질병 전용 순서로 아홉 줄이 한 번씩 나온다', () => {
    const entries = view()?.entries ?? [];
    expect(entries.map((entry) => entry.scope)).toEqual(['COMMON', 'COMMON', 'COMMON', 'COMMON', 'COMMON', 'COMMON', 'COMMON', 'INJURY_ONLY', 'ILLNESS_ONLY']);
    // 필요한 줄이 먼저(고정 줄 순서), 그다음 필요 없는 줄(고정 줄 순서).
    expect(entries.slice(0, 7).map((entry) => [entry.line.key, entry.line.required])).toEqual([
      ['OUTPATIENT_CONFIRMATION', true],
      ['RECEIPT_AND_ITEMIZED', true],
      ['MEDICAL_OPINION', true],
      ['IMAGING_READING', true],
      ['TREATMENT_CONFIRMATION', false],
      ['ADMISSION_DISCHARGE_CONFIRMATION', false],
      ['BIOPSY_RESULT', false],
    ]);
    expect(entries.slice(7).map((entry) => entry.line.key)).toEqual(['INITIAL_EXAM_RECORD', 'DIAGNOSIS_CERT']);
    expect([...entries].map((entry) => entry.line.key).sort()).toEqual([...NINE].sort());
  });

  it('상해 전용 줄과 질병 전용 줄이 여럿이어도(2+3, 0+4) 아홉 줄이 한 번씩이고 줄을 잃지 않는다 (AC-007h·i)', () => {
    for (const [injury, illness] of [
      [['INITIAL_EXAM_RECORD', 'ADMISSION_DISCHARGE_CONFIRMATION'], ['DIAGNOSIS_CERT', 'MEDICAL_OPINION', 'BIOPSY_RESULT']],
      [[], ['DIAGNOSIS_CERT', 'MEDICAL_OPINION', 'BIOPSY_RESULT', 'IMAGING_READING']],
      [[], []],
    ] as const) {
      const documents = unknownCauseDocuments({
        injuryOnly: injury.map((key) => docLine(key, true, [`${key} 상해 사유`], 'INJURY_ONLY')),
        illnessOnly: illness.map((key) => docLine(key, true, [`${key} 질병 사유`], 'ILLNESS_ONLY')),
      });
      const result = view(documents);
      const entries = result?.entries ?? [];
      expect([...entries].map((entry) => entry.line.key).sort()).toEqual([...NINE].sort());
      expect(entries.filter((entry) => entry.scope === 'INJURY_ONLY')).toHaveLength(injury.length);
      expect(entries.filter((entry) => entry.scope === 'ILLNESS_ONLY')).toHaveLength(illness.length);
    }
  });

  it('두 평가의 사유가 다른 공통 줄은 사유를 모두 가진다 (한쪽을 고르지 않는다)', () => {
    const base = unknownCauseDocuments();
    if (base.state !== 'AVAILABLE') throw new Error('시험 자료');
    const documents = { ...base, lines: base.lines.map((entry) => (entry.line === 'RECEIPT_AND_ITEMIZED' ? { ...entry, reasons: ['사유 하나', '사유 둘'] } : entry)) };
    const first = view(documents)?.entries.find((entry) => entry.line.key === 'RECEIPT_AND_ITEMIZED')?.line;
    expect(first?.reasons).toEqual(['사유 하나', '사유 둘']);
  });

  it('청구 기준은 "상해 또는 질병 (선택 안 함)" 이고 모름 전용 안내 문장이 있다', () => {
    const result = view();
    expect(result?.claimBasis).toBe('상해 또는 질병 (선택 안 함) · 손해보험사 · 통원');
    expect(result?.compactLine).toBe('상해 또는 질병 (선택 안 함) · 손해보험사 · 통원 · 치료 4개');
  });

  it('안내 문구는 실제 전용 줄 이름을 따라간다 (줄 이름을 적어 두지 않는다)', () => {
    expect(view()?.hint).toBe('다쳐서 오셨으면 초진기록지, 아파서 오셨으면 진단서를 함께 받으세요. 서류는 병원 원무과에서 발급하며, 보험사와 상품에 따라 추가 서류를 요구할 수 있습니다.');
    const many = view(
      unknownCauseDocuments({
        injuryOnly: [docLine('INITIAL_EXAM_RECORD', true, ['a'], 'INJURY_ONLY'), docLine('ADMISSION_DISCHARGE_CONFIRMATION', true, ['b'], 'INJURY_ONLY')],
        illnessOnly: [],
      }),
    );
    expect(many?.hint).toBe('다쳐서 오셨으면 초진기록지·입퇴원확인서를 함께 받으세요. 서류는 병원 원무과에서 발급하며, 보험사와 상품에 따라 추가 서류를 요구할 수 있습니다.');
    const none = view(unknownCauseDocuments({ injuryOnly: [], illnessOnly: [] }));
    expect(none?.hint).toBe('서류는 병원 원무과에서 발급합니다. 보험사와 상품에 따라 추가 서류를 요구할 수 있습니다.');
  });
});

describe('목록을 쓸 수 없을 때: 빈 목록도 지어낸 서류도 없다 (AC-007g)', () => {
  it.each([
    ['RULES_UNAVAILABLE', { state: 'RULES_UNAVAILABLE' } as DocumentsResult],
    ['null (보류 결과의 서류)', null],
    ['알 수 없는 상태', { state: 'SOMETHING_ELSE' } as never],
    ['줄이 빠진 목록', (() => { const full = singleCauseDocuments(); return full.state === 'AVAILABLE' ? { ...full, lines: full.lines.slice(1) } : full; })()],
    ['줄이 겹친 목록', (() => { const full = singleCauseDocuments(); return full.state === 'AVAILABLE' ? { ...full, lines: [...full.lines.slice(1), full.lines[1] as DocumentLine] } : full; })()],
    ['아는 줄이 아닌 줄', (() => { const full = singleCauseDocuments(); return full.state === 'AVAILABLE' ? { ...full, lines: [...full.lines.slice(1), { line: 'MADE_UP', required: true }] } : full; })() as never],
    ['사유가 문자열 배열이 아님', singleCauseDocuments({ lines: NINE.map((key) => ({ line: key, required: true, reasons: [1 as never] })) })],
    ['필요 여부가 불리언이 아님', singleCauseDocuments({ lines: NINE.map((key) => ({ line: key, required: 'yes' as never })) })],
    ['원인과 모드가 어긋남 (단일 원인 화면에 원인 모름 서류)', unknownCauseDocuments()],
  ])('%s: 사용할 수 없음이고 줄이 하나도 없다', (_name, documents) => {
    const view = buildDocumentsView(stateWith(documents));
    expect(view?.available).toBe(false);
    expect(view?.entries).toEqual([]);
  });

  it('원인 모름 화면에 줄의 범위가 빠진 단일 원인 서류가 오면 사용할 수 없음이다', () => {
    expect(buildDocumentsView(stateWith(singleCauseDocuments(), 'UNKNOWN'))?.available).toBe(false);
  });

  it('저장된 응답이 없으면 null (화면은 안내 화면)', () => {
    expect(buildDocumentsView({ ...stateWith(null), derived: { estimate: null, documents: null, basis: null, returnContext: null } })).toBeNull();
  });
});

describe('테스트 데이터 표시 (AC-010e)', () => {
  it('응답 또는 서류의 출처가 운영이 아니면 표시한다', () => {
    expect(buildDocumentsView(stateWith(singleCauseDocuments({ origin: 'OPERATING' })))?.testData).toBe(true); // 응답 origin 이 TEST_FIXTURE
    const operating = { ...resultStateWith(estimatedResponse({ origin: 'OPERATING', documents: singleCauseDocuments({ origin: 'OPERATING' }) })), screen: 'K07_Documents' as const };
    expect(buildDocumentsView(operating)?.testData).toBe(false);
    const mixed = { ...resultStateWith(estimatedResponse({ origin: 'OPERATING', documents: singleCauseDocuments({ origin: 'DEMO' }) })), screen: 'K07_Documents' as const };
    expect(buildDocumentsView(mixed)?.testData).toBe(true);
  });
});

describe('쪽 나눔: 줄이 빠지거나 반복되지 않는다 (AC-007i, DD-06·DD-12)', () => {
  const entries = buildDocumentsView(stateWith(singleCauseDocuments()))?.entries ?? [];

  it('어떤 쪽 크기와 시작 위치에서도 쪽을 모두 이으면 아홉 줄이 한 번씩이다', () => {
    for (let size = 1; size <= 12; size += 1) {
      const seen: string[] = [];
      let offset = 0;
      for (let guard = 0; guard < 20; guard += 1) {
        const page = pageOfDocuments(entries, offset, size);
        seen.push(...page.items.map((entry) => entry.line.key));
        if (!page.hasNext) break;
        offset = (page.pageIndex + 1) * size;
      }
      expect(seen, `쪽 크기 ${size}`).toEqual(NINE);
    }
  });

  it('쪽의 줄은 체크(필요 여부)와 사유를 그대로 가진다', () => {
    const page = pageOfDocuments(entries, 0, 4);
    expect(page.items.map((entry) => [entry.line.key, entry.line.required, entry.line.reasons.length])).toEqual([
      ['DIAGNOSIS_CERT', false, 0],
      ['OUTPATIENT_CONFIRMATION', true, 1],
      ['TREATMENT_CONFIRMATION', false, 0],
      ['RECEIPT_AND_ITEMIZED', true, 1],
    ]);
    expect(page.pageCount).toBe(3);
    expect(page.hasPrev).toBe(false);
    expect(page.hasNext).toBe(true);
  });

  it('쪽 크기가 바뀌어도 보던 첫 줄이 보이는 쪽에 머문다 (위치로 쪽을 정한다)', () => {
    const before = pageOfDocuments(entries, 4, 4); // 5번째 줄부터 둘째 쪽
    expect(before.items[0]?.line.key).toBe('INITIAL_EXAM_RECORD');
    const after = pageOfDocuments(entries, before.pageIndex * 4, 2); // 큰 글자: 쪽 크기 2 → 5번째 줄이 든 쪽
    expect(after.items.map((entry) => entry.line.key)).toContain('INITIAL_EXAM_RECORD');
  });

  it('범위를 벗어난 위치는 마지막 쪽이 된다 (빈 쪽이 없다)', () => {
    const page = pageOfDocuments(entries, 999, 4);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.hasNext).toBe(false);
    expect(pageOfDocuments([], 0, 4).pageCount).toBe(1);
  });

  it('쪽 안의 줄은 범위별로 묶이고 범위 순서가 COMMON → INJURY_ONLY → ILLNESS_ONLY 다 (원인 모름)', () => {
    const unknown = buildDocumentsView(stateWith(unknownCauseDocuments(), 'UNKNOWN'))?.entries ?? [];
    const all = groupOfPage(unknown);
    expect(all.map((group) => [group.scope, group.lines.length])).toEqual([['COMMON', 7], ['INJURY_ONLY', 1], ['ILLNESS_ONLY', 1]]);
    expect(all.map((group) => group.title)).toEqual(['공통으로 필요한 서류', '다쳐서 오셨다면 (상해)', '아파서 오셨다면 (질병)']);
    const second = groupOfPage(pageOfDocuments(unknown, 5, 5).items);
    expect(second.map((group) => [group.scope, group.lines.length])).toEqual([['COMMON', 2], ['INJURY_ONLY', 1], ['ILLNESS_ONLY', 1]]);
  });

  it('쪽 크기: 일반 글자는 아홉 줄이 한 쪽이고 큰 글자는 나눈다 (줄 수는 레이아웃이 정한다)', () => {
    expect(pageSizeFor({ orientation: 'PORTRAIT', largeText: false })).toBe(DOCUMENT_PAGE_SIZE.portrait.normal);
    expect(pageSizeFor({ orientation: 'LANDSCAPE', largeText: true })).toBe(DOCUMENT_PAGE_SIZE.landscape.largeText);
    expect(pageSizeFor({ orientation: 'LANDSCAPE', largeText: true }, true)).toBe(DOCUMENT_PAGE_SIZE.landscape.largeTextUnknown);
    expect(pageSizeFor({ orientation: 'PORTRAIT', largeText: true }, true)).toBe(DOCUMENT_PAGE_SIZE.portrait.largeText);
    expect(pageSizeFor({ orientation: 'LANDSCAPE', largeText: false }, true)).toBe(DOCUMENT_PAGE_SIZE.landscape.normal);
    expect(DOCUMENT_PAGE_SIZE.portrait.normal).toBeGreaterThanOrEqual(9);
    expect(DOCUMENT_PAGE_SIZE.landscape.normal).toBeGreaterThanOrEqual(9);
    expect(DOCUMENT_PAGE_SIZE.portrait.largeText).toBeLessThan(9);
  });
});
