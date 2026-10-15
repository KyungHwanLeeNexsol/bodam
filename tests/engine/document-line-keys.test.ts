import { describe, expect, it } from 'vitest';
import { DOCUMENT_CODE_LINE, DOCUMENT_LINE_KEYS } from '../../src/engine/types';
import type { Cause, DocumentCode, DocumentLine, DocumentLineKey, DocumentScope, DocumentsResult } from '../../src/engine/types';

// M2.A: 서류 형식과 고정 9줄 (design.md DD-06). 형식 수준 시험이며 값은 모두 TEST_FIXTURE 와 무관한 이름뿐이다.

/** 닫힌 10종 문서 코드. DD-06 의 DocumentCode 순서다. */
const TEN_CODES: DocumentCode[] = [
  'DIAGNOSIS_CERT',
  'OUTPATIENT_CONFIRMATION',
  'TREATMENT_CONFIRMATION',
  'RECEIPT',
  'ITEMIZED_STATEMENT',
  'INITIAL_EXAM_RECORD',
  'ADMISSION_DISCHARGE_CONFIRMATION',
  'MEDICAL_OPINION',
  'IMAGING_READING',
  'BIOPSY_RESULT',
];

describe('고정 9줄 (DocumentLineKey) — DD-06', () => {
  it('9줄이며 디자인의 순서 그대로다', () => {
    expect([...DOCUMENT_LINE_KEYS]).toEqual([
      'DIAGNOSIS_CERT',
      'OUTPATIENT_CONFIRMATION',
      'TREATMENT_CONFIRMATION',
      'RECEIPT_AND_ITEMIZED',
      'INITIAL_EXAM_RECORD',
      'ADMISSION_DISCHARGE_CONFIRMATION',
      'MEDICAL_OPINION',
      'IMAGING_READING',
      'BIOPSY_RESULT',
    ]);
    expect(DOCUMENT_LINE_KEYS).toHaveLength(9);
    expect(new Set(DOCUMENT_LINE_KEYS).size).toBe(9);
  });
});

describe('문서 코드 10종 → 표시 줄 9줄 — DD-06 "규칙 평가" 3번', () => {
  it('매핑의 키는 닫힌 10종 전부이고 그 밖의 키는 없다', () => {
    expect(Object.keys(DOCUMENT_CODE_LINE)).toEqual(TEN_CODES);
  });

  it('모든 코드가 정확히 하나의 표시 줄로 가고, 그 줄은 고정 9줄 가운데 하나다 (전수)', () => {
    for (const code of TEN_CODES) {
      const line = DOCUMENT_CODE_LINE[code];
      expect((DOCUMENT_LINE_KEYS as readonly string[]).includes(line), code).toBe(true);
    }
  });

  it('모든 표시 줄에 도달할 수 있다: 값의 집합이 고정 9줄과 같다', () => {
    const reached = new Set<DocumentLineKey>(TEN_CODES.map((code) => DOCUMENT_CODE_LINE[code]));
    expect([...reached].sort()).toEqual([...DOCUMENT_LINE_KEYS].sort());
  });

  it('영수증과 진료비 세부내역서만 한 줄 RECEIPT_AND_ITEMIZED 를 나눠 쓰고, 나머지 여덟 코드는 같은 이름의 줄로 간다', () => {
    expect(DOCUMENT_CODE_LINE.RECEIPT).toBe('RECEIPT_AND_ITEMIZED');
    expect(DOCUMENT_CODE_LINE.ITEMIZED_STATEMENT).toBe('RECEIPT_AND_ITEMIZED');
    const shared = TEN_CODES.filter((code) => DOCUMENT_CODE_LINE[code] === 'RECEIPT_AND_ITEMIZED');
    expect(shared).toEqual(['RECEIPT', 'ITEMIZED_STATEMENT']);
    for (const code of TEN_CODES.filter((entry) => !shared.includes(entry))) {
      expect(DOCUMENT_CODE_LINE[code], code).toBe(code);
    }
  });
});

describe('서류 형식 (컴파일 시점 확인)', () => {
  it('원인은 세 값이며 UNKNOWN 은 명시적인 값이다', () => {
    const causes: Cause[] = ['INJURY', 'ILLNESS', 'UNKNOWN'];
    expect(causes).toHaveLength(3);
  });

  it('DocumentsResult 는 AVAILABLE(단일 원인·원인 모름)과 RULES_UNAVAILABLE 두 모양이다', () => {
    const scopes: DocumentScope[] = ['COMMON', 'INJURY_ONLY', 'ILLNESS_ONLY'];
    const line: DocumentLine = { line: 'RECEIPT_AND_ITEMIZED', required: true, scope: 'COMMON', reasons: ['시험 사유'] };
    const single: DocumentsResult = {
      state: 'AVAILABLE',
      mode: 'SINGLE_CAUSE',
      lines: [{ line: 'MEDICAL_OPINION', required: false }],
      ruleSetId: 'TEST_DOCUMENT_RULES_1',
      ruleSetVersion: 'v1',
      origin: 'TEST_FIXTURE',
    };
    const unknown: DocumentsResult = { ...single, mode: 'UNKNOWN_CAUSE', lines: [line] };
    const unavailable: DocumentsResult = { state: 'RULES_UNAVAILABLE' };
    expect(scopes).toHaveLength(3);
    expect([single.state, unknown.state, unavailable.state]).toEqual(['AVAILABLE', 'AVAILABLE', 'RULES_UNAVAILABLE']);
  });
});
