import { describe, expect, it } from 'vitest';
import type { TreatmentRow } from '../../src/app/admin/api-types';
import { REVIEW_COPY } from '../../src/app/admin/review-copy';
import {
  CALC_CLASS_CHOICES,
  codesToText,
  currentLines,
  differingFields,
  differingFieldsOf,
  hasOpenRequest,
  initialReviewForm,
  latestByTreatment,
  missingCurrentReason,
  parseCodesText,
  proposedLines,
  publishedValuesOf,
  requestBodyOf,
  reviewFailureMessage,
  statusLabel,
} from '../../src/app/admin/review-model';
import type { CurrentPublishedView, CurrentTreatmentView, ProposedValues, ReviewRequestView } from '../../src/app/admin/review-types';

// 검토 요청 화면의 순수 계산 (화면 코드 밖). 시험 자료(TEST_FIXTURE)만 쓴다.
// 서버가 권위이고 이 파일은 입력을 요청 본문 모양으로 옮기고, 치료마다 가장 최근 요청을 고르고, 거절을 문장으로 바꾸는 일만 한다.

const reply = (status: number, body: unknown) => ({ status, body: body as never });

const view = (id: string, treatmentId: string, requestedAt: string, status: ReviewRequestView['status'] = 'REVIEW_REQUESTED', rejectionReason: string | null = null): ReviewRequestView => ({
  id,
  treatmentId,
  treatmentName: `TEST_FIXTURE ${treatmentId}`,
  proposed: { benefitType: 'NON_BENEFIT', procedureCodes: [], calcClass: 'GENERAL_NON_BENEFIT' },
  status,
  rejectionReason,
  requestedAt,
  requestedBy: 'TEST_FIXTURE_HA_CLINIC_1',
});

const treatment = (benefitType: 'BENEFIT' | 'NON_BENEFIT', procedureCodes: string[]): TreatmentRow => ({
  treatmentId: 'TEST_FIXTURE_TREATMENT_1',
  displayName: 'TEST_FIXTURE 시험 치료 A',
  description: '',
  benefitType,
  treatmentCode: 'TEST_FIXTURE_TC_1',
  procedureCodes,
  patientAmount: 10_000,
  priceCondition: '',
  order: 1,
});

describe('parseCodesText: 쉼표로 구분한 행위 코드', () => {
  it('앞뒤 공백을 지우고 빈 칸은 버린다', () => {
    expect(parseCodesText(' TEST_FIXTURE_P1 ,TEST_FIXTURE_P2,, ,  TEST_FIXTURE_P3  ')).toEqual(['TEST_FIXTURE_P1', 'TEST_FIXTURE_P2', 'TEST_FIXTURE_P3']);
  });

  it('비어 있거나 공백·쉼표뿐이면 빈 목록이다 (행위 코드를 비워도 된다)', () => {
    expect(parseCodesText('')).toEqual([]);
    expect(parseCodesText('   ')).toEqual([]);
    expect(parseCodesText(' , ,,')).toEqual([]);
  });

  it('항목 안의 공백은 건드리지 않는다', () => {
    expect(parseCodesText('TEST_FIXTURE P 1, B')).toEqual(['TEST_FIXTURE P 1', 'B']);
  });

  it('codesToText 로 쓴 문장은 parseCodesText 로 같은 목록이 된다', () => {
    const codes = ['TEST_FIXTURE_P1', 'TEST_FIXTURE_P2'];
    expect(codesToText(codes)).toBe('TEST_FIXTURE_P1, TEST_FIXTURE_P2');
    expect(parseCodesText(codesToText(codes))).toEqual(codes);
    expect(codesToText([])).toBe('');
  });
});

describe('initialReviewForm: 입력칸의 처음 값', () => {
  it('급여 구분과 행위 코드는 치료의 지금 값이고 보험 계산 분류는 고르지 않은 상태다 (지금 값을 화면이 알지 못한다)', () => {
    expect(initialReviewForm(treatment('BENEFIT', ['TEST_FIXTURE_P1', 'TEST_FIXTURE_P2']))).toEqual({ benefitType: 'BENEFIT', codesText: 'TEST_FIXTURE_P1, TEST_FIXTURE_P2', calcClass: '' });
    expect(initialReviewForm(treatment('NON_BENEFIT', []))).toEqual({ benefitType: 'NON_BENEFIT', codesText: '', calcClass: '' });
  });
});

describe('requestBodyOf: 입력을 요청 본문으로', () => {
  it('서버가 받는 모양 { proposed: { benefitType, procedureCodes, calcClass } } 하나뿐이고 다른 키가 없다', () => {
    const result = requestBodyOf({ benefitType: 'NON_BENEFIT', codesText: ' TEST_FIXTURE_P1 , TEST_FIXTURE_P2 ', calcClass: 'GENERAL_NON_BENEFIT' });
    expect(result).toEqual({ ok: true, body: { proposed: { benefitType: 'NON_BENEFIT', procedureCodes: ['TEST_FIXTURE_P1', 'TEST_FIXTURE_P2'], calcClass: 'GENERAL_NON_BENEFIT' } } });
    expect(Object.keys((result as { body: object }).body)).toEqual(['proposed']);
  });

  it('행위 코드를 비워도 보낼 수 있다', () => {
    const result = requestBodyOf({ benefitType: 'BENEFIT', codesText: '', calcClass: 'NEEDS_REVIEW' });
    expect(result).toEqual({ ok: true, body: { proposed: { benefitType: 'BENEFIT', procedureCodes: [], calcClass: 'NEEDS_REVIEW' } } });
  });

  it('보험 계산 분류를 고르지 않으면 보내지 않는다 (서버로 가기 전에 화면에서 막는다)', () => {
    expect(requestBodyOf({ benefitType: 'BENEFIT', codesText: '', calcClass: '' })).toEqual({ ok: false, field: 'calcClass' });
  });
});

describe('보험 계산 분류 선택지', () => {
  it('서버가 받는 네 값을 기획서의 이름 그대로 보인다', () => {
    expect(CALC_CLASS_CHOICES.map((choice) => choice.code)).toEqual(['GENERAL_BENEFIT', 'GENERAL_NON_BENEFIT', 'MAJOR_THREE_NON_BENEFIT', 'NEEDS_REVIEW']);
    expect(CALC_CLASS_CHOICES.map((choice) => choice.label)).toEqual(['일반 급여', '일반 비급여', '3대 비급여', '추가 검토 필요']);
  });
});

describe('latestByTreatment: 치료마다 가장 최근 요청', () => {
  it('요청 시각이 가장 늦은 것을 고른다 (목록 순서에 기대지 않는다)', () => {
    const older = view('R1', 'T1', '2026-11-01T01:00:00.000Z', 'REJECTED', 'TEST_FIXTURE 사유');
    const newer = view('R2', 'T1', '2026-11-02T01:00:00.000Z');
    const other = view('R3', 'T2', '2026-11-01T05:00:00.000Z', 'APPROVED');
    for (const list of [[older, newer, other], [other, newer, older], [newer, other, older]]) {
      const map = latestByTreatment(list);
      expect(map.get('T1')?.id).toBe('R2');
      expect(map.get('T2')?.id).toBe('R3');
      expect(map.size).toBe(2);
    }
  });

  it('요청 시각이 같으면 목록에서 앞선 것(서버는 최신순으로 준다)을 고른다', () => {
    const first = view('R1', 'T1', '2026-11-01T01:00:00.000Z');
    const second = view('R2', 'T1', '2026-11-01T01:00:00.000Z', 'REJECTED');
    expect(latestByTreatment([first, second]).get('T1')?.id).toBe('R1');
  });

  it('요청이 없으면 비어 있다', () => {
    expect(latestByTreatment([]).size).toBe(0);
  });
});

describe('상태 표시', () => {
  it('요청이 없으면 "요청 없음", 있으면 상태 이름이다', () => {
    expect(statusLabel(undefined)).toBe('요청 없음');
    expect(statusLabel(view('R1', 'T1', '2026-11-01T01:00:00.000Z'))).toBe('검토 요청됨 (대기 중)');
    expect(statusLabel(view('R1', 'T1', '2026-11-01T01:00:00.000Z', 'APPROVED'))).toBe('승인됨');
    expect(statusLabel(view('R1', 'T1', '2026-11-01T01:00:00.000Z', 'REJECTED', 'TEST_FIXTURE 사유'))).toBe('반려됨');
  });

  it('열린 요청은 검토 요청됨 상태뿐이다 (승인·반려는 닫힌 요청이라 새 요청을 막지 않는다)', () => {
    expect(hasOpenRequest(undefined)).toBe(false);
    expect(hasOpenRequest(view('R1', 'T1', '2026-11-01T01:00:00.000Z'))).toBe(true);
    expect(hasOpenRequest(view('R1', 'T1', '2026-11-01T01:00:00.000Z', 'APPROVED'))).toBe(false);
    expect(hasOpenRequest(view('R1', 'T1', '2026-11-01T01:00:00.000Z', 'REJECTED', 'TEST_FIXTURE 사유'))).toBe(false);
  });
});

describe('reviewFailureMessage: 서버 거절을 문장으로', () => {
  const NOTHING = REVIEW_COPY.nothingChanged;

  it('모든 거절 뒤에 요청도 치료도 바뀌지 않았고 입력이 남아 있다는 말이 붙는다', () => {
    for (const result of [reply(400, { error: 'INVALID_REQUEST', defects: [] }), reply(401, { error: 'UNAUTHENTICATED' }), reply(403, { error: 'FORBIDDEN' }), reply(404, { error: 'NOT_FOUND' }), reply(409, { error: 'CONFLICT', reason: 'REVIEW_ALREADY_REQUESTED' }), reply(500, { error: 'INTERNAL' })]) {
      expect(reviewFailureMessage(result)).toContain(NOTHING);
    }
  });

  it('이미 열린 요청이 있으면 그 사실을 말한다', () => {
    expect(reviewFailureMessage(reply(409, { error: 'CONFLICT', reason: 'REVIEW_ALREADY_REQUESTED' }))).toContain('이미 검토 중인 요청이 있습니다');
  });

  it('게시된 치료가 아니면 그 사실을 말하고 코드 글자는 보이지 않는다', () => {
    const text = reviewFailureMessage(reply(400, { error: 'INVALID_REQUEST', defects: [{ code: 'TREATMENT_NOT_IN_CATALOG', path: 'treatmentId' }] }));
    expect(text).toContain('게시된 치료가 아닙니다');
    expect(text).not.toContain('TREATMENT_NOT_IN_CATALOG');
  });

  it('칸별 결함은 어느 칸인지 말한다', () => {
    const text = reviewFailureMessage(
      reply(400, {
        error: 'INVALID_REQUEST',
        defects: [
          { code: 'VALUE_INVALID', path: 'proposed.benefitType' },
          { code: 'VALUE_INVALID', path: 'proposed.procedureCodes[1]' },
          { code: 'VALUE_MISSING', path: 'proposed.calcClass' },
        ],
      }),
    );
    expect(text).toContain('급여 구분');
    expect(text).toContain('행위 코드');
    expect(text).toContain('보험 계산 분류');
    expect(text).not.toMatch(/VALUE_|proposed\./);
  });

  it('인증·권한 거절은 각자의 안내이고 서버 오류는 서버 오류로 읽힌다', () => {
    expect(reviewFailureMessage(reply(401, { error: 'UNAUTHENTICATED' }))).toContain('로그인이 필요합니다');
    expect(reviewFailureMessage(reply(403, { error: 'FORBIDDEN' }))).toContain(REVIEW_COPY.forbiddenClinic);
    expect(reviewFailureMessage(reply(500, { error: 'INTERNAL' }))).toContain(REVIEW_COPY.errors.server);
  });

  it('알 수 없는 400 은 일반 안내로 읽힌다', () => {
    expect(reviewFailureMessage(reply(400, { error: 'INVALID_REQUEST' }))).toContain(REVIEW_COPY.errors.generic);
    expect(reviewFailureMessage(reply(400, { error: 'INVALID_REQUEST', defects: [{ code: 'NOT_JSON', path: 'request' }] }))).toContain(REVIEW_COPY.errors.generic);
  });
});

describe('검토 요청 문구', () => {
  it('요청은 제안일 뿐이라 분류·보험금 계산이 바뀌지 않는다고 분명히 말한다', () => {
    expect(REVIEW_COPY.proposalNote).toContain('제안');
    expect(REVIEW_COPY.proposalNote).toContain('보험금 계산');
    expect(REVIEW_COPY.sent).toContain('바뀌지 않았습니다');
  });

  it('병원 관리자 화면 문구에는 승인·반려·검토 완료·매핑을 처리하는 단추 문구가 없다', () => {
    const buttonTexts = [REVIEW_COPY.openForm, REVIEW_COPY.submit, REVIEW_COPY.closeForm, REVIEW_COPY.retry];
    for (const text of buttonTexts) expect(text).not.toMatch(/승인|반려|검토 완료|매핑/);
  });
});

// 검토 담당자 대기열: 현재 게시값과 제안값을 같은 모양으로 나란히 보이는 계산.
describe('대기열의 값 줄: 현재 게시값과 제안값', () => {
  const current: CurrentTreatmentView = { displayName: 'TEST_FIXTURE 시험 치료 A', treatmentCode: 'TEST_FIXTURE_TC_1', benefitType: 'BENEFIT', procedureCodes: ['TEST_FIXTURE_PROC_1', 'TEST_FIXTURE_PROC_2'], calcClass: 'GENERAL_BENEFIT' };
  const proposed: ProposedValues = { benefitType: 'NON_BENEFIT', procedureCodes: [], calcClass: 'GENERAL_NON_BENEFIT' };

  it('제안값은 급여 구분·행위 코드·보험 계산 분류를 사람이 읽는 이름으로 낸다 (행위 코드가 없으면 "없음")', () => {
    expect(proposedLines(proposed)).toEqual({ benefit: REVIEW_COPY.nonBenefit, procedures: REVIEW_COPY.noProcedure, calcClass: '일반 비급여' });
    expect(proposedLines({ benefitType: 'BENEFIT', procedureCodes: ['A', 'B'], calcClass: 'NEEDS_REVIEW' })).toEqual({ benefit: REVIEW_COPY.benefit, procedures: 'A, B', calcClass: '추가 검토 필요' });
  });

  it('현재 게시값도 같은 모양이다', () => {
    expect(currentLines(current)).toEqual({ benefit: REVIEW_COPY.benefit, procedures: 'TEST_FIXTURE_PROC_1, TEST_FIXTURE_PROC_2', calcClass: '일반 급여' });
  });

  it('그 병원의 현재 게시본에 치료가 없으면(null) 값 줄이 없다: 화면은 "현재 게시 목록에 없음"을 보인다', () => {
    expect(currentLines(null)).toBeNull();
  });

  it('달라지는 칸만 고른다: 모두 다르면 셋, 같은 칸은 빠진다', () => {
    expect(differingFields(current, proposed)).toEqual(['benefitType', 'procedureCodes', 'calcClass']);
    expect(differingFields(current, { benefitType: 'BENEFIT', procedureCodes: ['TEST_FIXTURE_PROC_1', 'TEST_FIXTURE_PROC_2'], calcClass: 'NEEDS_REVIEW' })).toEqual(['calcClass']);
  });

  it('행위 코드는 순서가 달라도 같은 목록이다', () => {
    expect(differingFields(current, { benefitType: 'BENEFIT', procedureCodes: ['TEST_FIXTURE_PROC_2', 'TEST_FIXTURE_PROC_1'], calcClass: 'GENERAL_BENEFIT' })).toEqual([]);
  });

  it('현재 값이 없으면 어느 칸도 비교할 수 없어 셋 모두 달라지는 것으로 본다', () => {
    expect(differingFields(null, proposed)).toEqual(['benefitType', 'procedureCodes', 'calcClass']);
  });
});

// 서버가 현재 게시값을 네 가지 상태로 나눠 준다. 화면은 값이 있는 상태(PUBLISHED)에서만 줄을 만들고, 값이 없는 이유를 둘로 나눠 보인다:
// 숨김·목록에 없음 = "현재 게시 목록에 없음", 읽지 못함 = 별도 문구(읽지 못한 것을 "목록에 없음"으로 보이지 않는다).
describe('대기열의 현재 게시 상태', () => {
  const published: CurrentPublishedView = { state: 'PUBLISHED', displayName: 'TEST_FIXTURE 시험 치료 A', treatmentCode: 'TEST_FIXTURE_TC_1', benefitType: 'BENEFIT', procedureCodes: ['TEST_FIXTURE_PROC_1'], calcClass: 'GENERAL_BENEFIT' };

  it('게시된 값만 값 줄이 된다 (그 밖의 상태는 null)', () => {
    expect(publishedValuesOf(published)).toMatchObject({ treatmentCode: 'TEST_FIXTURE_TC_1', calcClass: 'GENERAL_BENEFIT' });
    expect(publishedValuesOf({ state: 'HIDDEN' })).toBeNull();
    expect(publishedValuesOf({ state: 'NOT_IN_CATALOG' })).toBeNull();
    expect(publishedValuesOf({ state: 'UNREADABLE', defectCode: 'TREATMENT_MISSING' })).toBeNull();
  });

  it('값이 없는 이유: 숨김·목록에 없음은 NOT_PUBLISHED, 읽지 못함은 UNREADABLE, 값이 있으면 null', () => {
    expect(missingCurrentReason(published)).toBeNull();
    expect(missingCurrentReason({ state: 'HIDDEN' })).toBe('NOT_PUBLISHED');
    expect(missingCurrentReason({ state: 'NOT_IN_CATALOG' })).toBe('NOT_PUBLISHED');
    expect(missingCurrentReason({ state: 'UNREADABLE', defectCode: 'TREATMENT_VERSION_MISSING' })).toBe('UNREADABLE');
  });

  it('읽지 못한 문구는 "현재 게시 목록에 없음" 문구와 다르다', () => {
    expect(REVIEW_COPY.currentUnreadable).not.toBe(REVIEW_COPY.notInPublished);
    expect(REVIEW_COPY.currentUnreadable).toContain('읽지 못');
  });

  it('읽지 못해 비교할 수 없으면 달라지는 칸을 표시하지 않는다 (값이 없는 다른 상태와 달리)', () => {
    const proposed: ProposedValues = { benefitType: 'NON_BENEFIT', procedureCodes: [], calcClass: 'GENERAL_NON_BENEFIT' };
    expect(differingFieldsOf({ state: 'UNREADABLE', defectCode: 'TREATMENT_MISSING' }, proposed)).toEqual([]);
    expect(differingFieldsOf({ state: 'HIDDEN' }, proposed)).toEqual(['benefitType', 'procedureCodes', 'calcClass']);
    expect(differingFieldsOf(published, proposed)).toEqual(['benefitType', 'procedureCodes', 'calcClass']);
  });
});

describe('대기열 문구', () => {
  it('읽기 전용임을 말하고 빈 대기열 문구가 고정되어 있다', () => {
    expect(REVIEW_COPY.queueNote).toContain('확인만');
    expect(REVIEW_COPY.queueEmpty).toBe('처리 전 요청이 없습니다');
  });
});
