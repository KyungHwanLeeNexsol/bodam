import { describe, expect, it } from 'vitest';
import { CHANGE_COPY } from '../../src/app/admin/change-history-copy';
import { actionLabel, describeVersion, outcomeOf, parseHistoryResponse, roleLabel, scopeNotice, targetLabel, truncationNotice } from '../../src/app/admin/change-history-model';

// 변경 이력 화면의 순수 계산 (M7 변경 이력). 서버 응답을 화면 단계로 바꾸고 표시 글자를 고른다. 읽기만 하며 기록에 없는 값을 만들어 내지 않는다.

const DIGEST = 'a'.repeat(64);

const entry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  sequence: 2,
  at: '2026-10-16T09:00:00.000Z',
  actor: { id: 'TEST_FIXTURE_HA_CLINIC_1', role: 'HA' },
  action: 'CATALOG_DRAFT_SAVE',
  target: 'CATALOG_DRAFT/TEST_FIXTURE_CLINIC_1',
  beforeVersion: null,
  afterVersion: DIGEST,
  reason: null,
  ...overrides,
});

const response = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  clinic: { id: 'TEST_FIXTURE_CLINIC_1', displayName: '시험 의원' },
  coveredActions: ['CATALOG_DRAFT_SAVE', 'CATALOG_DRAFT_DISCARD', 'CATALOG_DRAFT_PUBLISH', 'IDLE_POLICY_SAVE'],
  entries: [entry({ sequence: 2 }), entry({ sequence: 1, action: 'IDLE_POLICY_SAVE', target: 'CLINIC/TEST_FIXTURE_CLINIC_1/IDLE_POLICY' })],
  page: { limit: 100, returned: 2, total: 2, truncated: false },
  ...overrides,
});

describe('서버 응답 읽기', () => {
  it('올바른 응답은 그대로 읽는다 (알 수 없는 속성은 옮기지 않는다)', () => {
    const parsed = parseHistoryResponse({ ...response(), extra: 'x', entries: [entry({ revision: 'SECRET' })] , page: { limit: 100, returned: 1, total: 1, truncated: false } });
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!).sort()).toEqual(['clinic', 'coveredActions', 'entries', 'page']);
    expect(Object.keys(parsed!.entries[0]!).sort()).toEqual(['action', 'actor', 'afterVersion', 'at', 'beforeVersion', 'reason', 'sequence', 'target']);
    expect(JSON.stringify(parsed)).not.toContain('SECRET');
  });

  it.each([
    ['본문이 객체가 아님', null],
    ['본문이 배열', []],
    ['병원이 없음', response({ clinic: undefined })],
    ['병원 id 가 숫자', response({ clinic: { id: 1, displayName: 'x' } })],
    ['다루는 동작이 배열이 아님', response({ coveredActions: 'CATALOG_DRAFT_SAVE' })],
    ['다루는 동작에 숫자가 섞임', response({ coveredActions: ['CATALOG_DRAFT_SAVE', 3] })],
    ['항목이 배열이 아님', response({ entries: {} })],
    ['항목 하나가 깨짐(시각 없음)', response({ entries: [entry({ at: undefined }), entry()], page: { limit: 100, returned: 2, total: 2, truncated: false } })],
    ['번호가 소수', response({ entries: [entry({ sequence: 1.5 })], page: { limit: 100, returned: 1, total: 1, truncated: false } })],
    ['수행자 역할이 없음', response({ entries: [entry({ actor: { id: 'x' } })], page: { limit: 100, returned: 1, total: 1, truncated: false } })],
    ['이전 버전이 숫자', response({ entries: [entry({ beforeVersion: 3 })], page: { limit: 100, returned: 1, total: 1, truncated: false } })],
    ['사유가 undefined', response({ entries: [entry({ reason: undefined })], page: { limit: 100, returned: 1, total: 1, truncated: false } })],
    ['페이지 정보가 없음', response({ page: undefined })],
    ['건수가 음수', response({ page: { limit: 100, returned: 2, total: -1, truncated: false } })],
    ['truncated 가 불리언이 아님', response({ page: { limit: 100, returned: 2, total: 2, truncated: 'no' } })],
    ['returned 가 항목 수와 다름', response({ page: { limit: 100, returned: 5, total: 5, truncated: false } })],
  ])('읽을 수 없는 응답은 null 이다: %s', (_name, body) => {
    expect(parseHistoryResponse(body)).toBeNull();
  });
});

describe('화면 단계', () => {
  it('200 이고 서버가 정한 병원이 주소의 병원과 같으면 ready 다', () => {
    const outcome = outcomeOf(200, response(), 'TEST_FIXTURE_CLINIC_1');
    expect(outcome.phase).toBe('ready');
  });

  it('서버가 정한 병원이 주소의 병원과 다르면 이력을 보이지 않는다 (mismatch)', () => {
    expect(outcomeOf(200, response(), 'TEST_FIXTURE_CLINIC_2')).toEqual({ phase: 'mismatch' });
    expect(outcomeOf(200, response(), 'test_fixture_clinic_1')).toEqual({ phase: 'mismatch' });
    expect(outcomeOf(200, response(), 'TEST_FIXTURE_CLINIC_1 ')).toEqual({ phase: 'mismatch' });
  });

  it('빈 목록은 ready 이고 항목이 없다', () => {
    const outcome = outcomeOf(200, response({ entries: [], page: { limit: 100, returned: 0, total: 0, truncated: false } }), 'TEST_FIXTURE_CLINIC_1');
    expect(outcome.phase).toBe('ready');
    expect(outcome.phase === 'ready' ? outcome.data.entries : null).toEqual([]);
  });

  it('401·403·404·409(병원을 하나로 정할 수 없음)는 각각 안내 단계이고, 그 밖의 상태와 읽을 수 없는 200 은 불러오지 못한 것이다', () => {
    expect(outcomeOf(401, { error: 'UNAUTHENTICATED' }, 'x')).toEqual({ phase: 'unauthenticated' });
    expect(outcomeOf(403, { error: 'FORBIDDEN' }, 'x')).toEqual({ phase: 'forbidden' });
    expect(outcomeOf(404, { error: 'NOT_FOUND' }, 'x')).toEqual({ phase: 'notFound' });
    expect(outcomeOf(409, { error: 'CONFLICT', reason: 'CLINIC_AMBIGUOUS' }, 'x')).toEqual({ phase: 'ambiguous' });
    expect(outcomeOf(409, { error: 'CONFLICT', reason: 'OTHER' }, 'x')).toEqual({ phase: 'error' });
    expect(outcomeOf(409, null, 'x')).toEqual({ phase: 'error' });
    for (const status of [400, 405, 500, 502, 0]) {
      expect(outcomeOf(status, {}, 'x'), String(status)).toEqual({ phase: 'error' });
    }
    expect(outcomeOf(200, { entries: 'broken' }, 'TEST_FIXTURE_CLINIC_1')).toEqual({ phase: 'error' });
    expect(outcomeOf(200, null, 'TEST_FIXTURE_CLINIC_1')).toEqual({ phase: 'error' });
  });

  it('모든 실패 단계에 안내 문구가 있다', () => {
    for (const phase of ['unauthenticated', 'forbidden', 'ambiguous', 'notFound', 'mismatch', 'error'] as const) {
      expect(CHANGE_COPY.failure[phase].length, phase).toBeGreaterThan(10);
    }
  });
});

describe('표시 글자', () => {
  it('동작은 사람이 읽는 이름으로 바꾸고 모르는 동작은 기록된 코드를 그대로 보인다', () => {
    expect(actionLabel('CATALOG_DRAFT_SAVE')).toBe('카탈로그 초안 저장');
    expect(actionLabel('CATALOG_DRAFT_DISCARD')).toBe('카탈로그 초안 폐기');
    expect(actionLabel('CATALOG_DRAFT_PUBLISH')).toBe('카탈로그 초안 게시');
    expect(actionLabel('IDLE_POLICY_SAVE')).toBe('무조작 시간 저장');
    expect(actionLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(targetLabel('IDLE_POLICY_SAVE')).toBe('무조작 시간 설정');
    expect(targetLabel('SOMETHING_NEW')).toBe(CHANGE_COPY.targetUnknown);
    expect(roleLabel('HA')).toBe('병원 관리자');
    expect(roleLabel('RV')).toBe('검토 담당자');
    expect(roleLabel('PO')).toBe('플랫폼 운영자');
    expect(roleLabel('SOMEONE')).toBe('SOMEONE');
  });

  it('이전/이후 칸: 값이 없으면 "없음", 게시는 카탈로그 버전 id 그대로, 그 밖은 내용 지문(64자는 앞 12자만, 전체는 따로 둔다)', () => {
    expect(describeVersion('CATALOG_DRAFT_SAVE', null)).toEqual({ kind: 'none', text: '없음', full: null });
    expect(describeVersion('CATALOG_DRAFT_PUBLISH', 'CATALOG_7')).toEqual({ kind: 'catalog', text: 'CATALOG_7', full: 'CATALOG_7' });
    expect(describeVersion('CATALOG_DRAFT_SAVE', DIGEST)).toEqual({ kind: 'digest', text: `${'a'.repeat(12)}…`, full: DIGEST });
    expect(describeVersion('IDLE_POLICY_SAVE', 'short-value')).toEqual({ kind: 'digest', text: 'short-value', full: 'short-value' });
    // 게시의 카탈로그 버전은 64자 16진수여도 줄이지 않는다.
    expect(describeVersion('CATALOG_DRAFT_PUBLISH', DIGEST).text).toBe(DIGEST);
  });

  it('다루는 동작 안내는 서버가 알린 목록으로 만든다 (화면이 목록을 따로 정하지 않고, 모든 이력이라고 말하지 않는다)', () => {
    const notice = scopeNotice(['CATALOG_DRAFT_SAVE', 'IDLE_POLICY_SAVE']);
    expect(notice).toContain('카탈로그 초안 저장 · 무조작 시간 저장');
    expect(notice).not.toContain('카탈로그 초안 게시');
    expect(notice).toContain('모든 변경 이력이 아닙니다');
    expect(scopeNotice(['NEW_ACTION'])).toContain('NEW_ACTION');
  });

  it('상한 안내: 잘렸을 때만 보이고 보여 주는 건수와 전체 건수를 함께 말한다', () => {
    expect(truncationNotice({ limit: 100, returned: 100, total: 130, truncated: true })).toBe('가장 최근 100건만 보여 줍니다 (전체 130건). 더 오래된 기록은 이 화면에서 볼 수 없습니다.');
    expect(truncationNotice({ limit: 100, returned: 100, total: 100, truncated: false })).toBeNull();
  });

  it('화면 문구가 읽기 전용임을 밝히고 수정·삭제·복구를 권하지 않는다', () => {
    expect(CHANGE_COPY.readOnlyNote).toContain('읽기 전용');
    expect(CHANGE_COPY.readOnlyNote).toContain('고치거나 지우거나 되돌릴 수 없습니다');
    expect(CHANGE_COPY.noDetailNote).toContain('짐작해 채우지 않습니다');
  });
});
