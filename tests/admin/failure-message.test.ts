import { describe, expect, it } from 'vitest';
import { ADMIN_COPY } from '../../src/app/admin/copy';
import { failureMessage } from '../../src/app/admin/failure-message';

// 서버 거절을 사람이 읽는 문장으로 바꾸는 순수 함수. 코드를 그대로 보이지 않고, 모든 거절 뒤에 "무엇이 바뀌지 않았는지"가 붙는지를 본다.

const reply = (status: number, body: unknown) => ({ status, body: body as never });
const defects = (...codes: string[]) => reply(400, { error: 'INVALID_REQUEST', defects: codes.map((code) => ({ code, path: 'x' })) });

describe('failureMessage', () => {
  it('새 결함 코드는 한국어 문장이 되고 코드 글자는 화면에 나오지 않는다', () => {
    const codes = Object.keys(ADMIN_COPY.errors.defects);
    expect(codes).toEqual(
      expect.arrayContaining([
        'PRICE_EDIT_ON_DEACTIVATED',
        'TREATMENT_DEACTIVATED_IN_DRAFT',
        'DRAFT_KEY_COLLIDES',
        'ORDER_INCOMPLETE',
        'ORDER_UNKNOWN_ENTRY',
        'DUPLICATE_ORDER_ENTRY',
        'DUPLICATE_DRAFT_KEY',
        'DUPLICATE_TREATMENT_ID',
        'NO_DRAFT_CHANGE',
        'UNKNOWN_FIELD',
        'ORIGIN_NOT_ACCEPTED',
        'TOO_MANY_ADDITIONS',
        'NO_TREATMENT_REMAINS',
        'TREATMENT_ALREADY_VISIBLE',
        'REACTIVATION_CONFLICTS_WITH_DEACTIVATION',
        'PRICE_EDIT_ON_REACTIVATED',
      ]),
    );
    for (const code of codes) {
      const text = failureMessage(defects(code), 'save');
      expect(text, code).not.toContain(code);
      expect(text, code).toContain(ADMIN_COPY.nothingChanged.save);
    }
  });

  it('모든 치료를 숨기려 한 거절은 최소 한 개는 남아야 한다고 알린다', () => {
    const text = failureMessage(defects('NO_TREATMENT_REMAINS'), 'save');
    expect(text).toContain('모든 치료를 숨길 수는 없습니다. 최소 한 개는 게시된 채로 남아야 합니다.');
    expect(text).not.toContain('NO_TREATMENT_REMAINS');
  });

  it('여러 결함이면 서로 다른 문장을 최대 셋까지 잇고, 같은 문장은 한 번만 쓴다', () => {
    const text = failureMessage(defects('ORDER_INCOMPLETE', 'ORDER_UNKNOWN_ENTRY', 'NO_DRAFT_CHANGE', 'UNKNOWN_FIELD', 'TOO_MANY_ADDITIONS'), 'save');
    expect(text.split(ADMIN_COPY.errors.defects.ORDER_INCOMPLETE as string)).toHaveLength(2);
    expect(text).toContain(ADMIN_COPY.errors.defects.NO_DRAFT_CHANGE as string);
    expect(text).toContain(ADMIN_COPY.errors.defects.UNKNOWN_FIELD as string);
    expect(text).not.toContain(ADMIN_COPY.errors.defects.TOO_MANY_ADDITIONS as string);
  });

  it('모르는 코드·결함 없는 400 은 일반 문장이다', () => {
    expect(failureMessage(defects('SOMETHING_NEW'), 'preview')).toContain(ADMIN_COPY.errors.generic);
    expect(failureMessage(reply(400, { error: 'INVALID_REQUEST' }), 'preview')).toContain(ADMIN_COPY.errors.generic);
  });

  it('409 는 사유별 문장이고, 게시 거절은 키오스크가 그대로라는 말이 붙는다', () => {
    expect(failureMessage(reply(409, { error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' }), 'publish')).toContain('미리보기를 다시 실행한 뒤 게시');
    expect(failureMessage(reply(409, { error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' }), 'publish')).toContain('키오스크는 그대로입니다');
    expect(failureMessage(reply(409, { error: 'CONFLICT', reason: 'DRAFT_STALE' }), 'publish')).toContain(ADMIN_COPY.errors.stale);
    expect(failureMessage(reply(409, { error: 'CONFLICT', reason: 'DRAFT_ABSENT' }), 'publish')).toContain(ADMIN_COPY.errors.absent);
    expect(failureMessage(reply(409, { error: 'CONFLICT', reason: 'CATALOG_ABSENT' }), 'publish')).toContain(ADMIN_COPY.errors.catalogAbsent);
    expect(failureMessage(reply(409, { error: 'CONFLICT' }), 'publish')).toContain(ADMIN_COPY.errors.generic);
  });

  it('401·403·5xx·그 밖의 상태도 문장이 되고 모두 입력이 남아 있다는 말이 붙는다', () => {
    expect(failureMessage(reply(401, { error: 'UNAUTHENTICATED' }), 'save')).toContain(ADMIN_COPY.unauthenticated);
    expect(failureMessage(reply(403, { error: 'FORBIDDEN' }), 'save')).toContain(ADMIN_COPY.forbidden);
    expect(failureMessage(reply(500, { error: 'INTERNAL_ERROR' }), 'preview')).toContain(ADMIN_COPY.errors.server);
    expect(failureMessage(reply(404, {}), 'discard')).toContain(ADMIN_COPY.errors.generic);
    for (const kind of ['save', 'preview', 'publish'] as const) {
      expect(failureMessage(reply(500, {}), kind)).toContain('화면에 그대로 남아 있습니다');
    }
  });
});
