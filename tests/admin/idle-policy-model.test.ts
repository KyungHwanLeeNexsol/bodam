import { describe, expect, it } from 'vitest';
import { IDLE_COPY, IDLE_SCREEN_LABEL } from '../../src/app/admin/idle-policy-copy';
import { bodyOfServer, editRow, formFromServer, holdHint, isDirty, isOutcomeUnknown, isPolicyChanged, isPolicyView, putBodyOf, requestBodyOf, revertRow, rowHint, sameServerSettings, saveFailureMessage, serverMatchesBody, setHoldEnabled, setHoldText } from '../../src/app/admin/idle-policy-model';
import { IDLE_SCREEN_KINDS } from '../../src/app/admin/idle-policy-types';
import type { IdlePolicyView, IdleScreenKind, IdleThreshold } from '../../src/app/admin/idle-policy-types';

// 병원 무조작 정책 화면의 순수 계산. 서버가 권위이고, 화면은 PUT 전체 교체의 규칙(생략한 종류는 기본값)을 어기지 않는 본문을 만든다.

const DEFAULTS: Record<IdleScreenKind, IdleThreshold> = {
  INPUT: { warnSeconds: 100, resetSeconds: 120 },
  RESULT: { warnSeconds: 160, resetSeconds: 180 },
  BASIS_AND_DOCUMENTS: { warnSeconds: 160, resetSeconds: 180 },
  HOLD_RESULT: { warnSeconds: 160, resetSeconds: 180 },
  NOTICE_PROGRESS_ERROR: { warnSeconds: 100, resetSeconds: 120 },
};

const DIGEST = 'ab12'.repeat(16);

function view(overrides: Partial<Record<IdleScreenKind, IdleThreshold>> = {}, completionHoldSeconds: number | null = null): IdlePolicyView {
  const screens = { ...DEFAULTS, ...overrides } as Record<IdleScreenKind, IdleThreshold>;
  return {
    clinic: { id: 'C1', slug: 'c1', displayName: '병원 1' },
    idlePolicy: { screens, completionHoldSeconds },
    customizedScreens: IDLE_SCREEN_KINDS.filter((kind) => overrides[kind] !== undefined),
    defaults: DEFAULTS,
    minLeadSeconds: 20,
    policyDigest: DIGEST,
  };
}

describe('서버 값으로 화면 채우기', () => {
  it('저장한 적 없는 병원: 다섯 종류가 모두 기본값을 따르고(useDefault) 자동 복귀는 꺼져 있다', () => {
    const form = formFromServer(view());
    for (const kind of IDLE_SCREEN_KINDS) {
      expect(form.rows[kind], kind).toEqual({ warn: String(DEFAULTS[kind].warnSeconds), reset: String(DEFAULTS[kind].resetSeconds), useDefault: true });
    }
    expect(form.holdEnabled).toBe(false);
    expect(form.holdText).toBe('');
  });

  it('직접 저장한 종류만 useDefault 가 아니고, 자동 복귀 값이 있으면 켜진다', () => {
    const form = formFromServer(view({ RESULT: { warnSeconds: 50, resetSeconds: 80 } }, 12));
    expect(form.rows.RESULT).toEqual({ warn: '50', reset: '80', useDefault: false });
    expect(form.rows.INPUT.useDefault).toBe(true);
    expect(form.holdEnabled).toBe(true);
    expect(form.holdText).toBe('12');
  });
});

describe('저장 본문: PUT 전체 교체에서 다른 설정을 잃지 않는다', () => {
  it('고치지 않으면 본문이 서버 값과 같고 저장할 것이 없다', () => {
    const server = view({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15);
    const form = formFromServer(server);
    expect(requestBodyOf(form)).toEqual(bodyOfServer(server));
    expect(isDirty(form, server)).toBe(false);
  });

  it('한 종류만 고쳐도 앞서 직접 저장한 다른 종류와 자동 복귀 값이 본문에 그대로 다시 담긴다 (잃지 않는다)', () => {
    const server = view({ INPUT: { warnSeconds: 90, resetSeconds: 110 }, RESULT: { warnSeconds: 50, resetSeconds: 80 } }, 15);
    const form = editRow(formFromServer(server), 'INPUT', 'reset', '115', server);
    expect(requestBodyOf(form)).toEqual({
      screens: { INPUT: { warnSeconds: 90, resetSeconds: 115 }, RESULT: { warnSeconds: 50, resetSeconds: 80 } },
      completionHoldSeconds: 15,
    });
    expect(isDirty(form, server)).toBe(true);
  });

  it('기본값을 따르던 종류는 고치지 않으면 본문에 없다 (서버가 계속 기본값으로 읽는다). 고친 종류는 직접 설정이 되어 담긴다', () => {
    const server = view({ INPUT: { warnSeconds: 90, resetSeconds: 110 } });
    const edited = editRow(formFromServer(server), 'HOLD_RESULT', 'warn', '170', server);
    expect(Object.keys(requestBodyOf(edited).screens).sort()).toEqual(['HOLD_RESULT', 'INPUT']);
    expect(requestBodyOf(edited).screens.HOLD_RESULT).toEqual({ warnSeconds: 170, resetSeconds: 180 });
    expect(edited.rows.HOLD_RESULT.useDefault).toBe(false);
    expect(Object.keys(requestBodyOf(formFromServer(server)).screens)).toEqual(['INPUT']);
  });

  it('기본값으로 되돌리기: 값을 기본값으로 채우고 본문에서 뺀다 → 저장하면 서버가 기본값으로 되돌린다. 저장할 것이 생긴다', () => {
    const server = view({ INPUT: { warnSeconds: 90, resetSeconds: 110 } });
    const form = revertRow(formFromServer(server), 'INPUT', DEFAULTS);
    expect(form.rows.INPUT).toEqual({ warn: '100', reset: '120', useDefault: true });
    expect(requestBodyOf(form).screens).toEqual({});
    expect(isDirty(form, server)).toBe(true);
  });

  it('기본값을 따르던 종류에 되돌리기를 눌러도 저장할 것이 생기지 않는다', () => {
    const server = view();
    expect(isDirty(revertRow(formFromServer(server), 'INPUT', DEFAULTS), server)).toBe(false);
  });

  it('자동 복귀: 켜지 않으면 null, 켜고 정수를 쓰면 그 정수, 끄면 다시 null. 기본 시간을 만들어 채우지 않는다 (켜면 빈 칸)', () => {
    const server = view();
    const on = setHoldEnabled(formFromServer(server), true);
    expect(on.holdText).toBe('');
    expect(requestBodyOf(on).completionHoldSeconds).toBe('');
    expect(requestBodyOf(setHoldText(on, '5')).completionHoldSeconds).toBe(5);
    expect(requestBodyOf(setHoldText(on, ' 30 ')).completionHoldSeconds).toBe(30);
    expect(requestBodyOf(setHoldEnabled(setHoldText(on, '5'), false)).completionHoldSeconds).toBeNull();
  });

  it('숫자로 읽을 수 없는 입력은 고치지 않고 글자 그대로 보낸다 (서버가 거절한다): 빈 칸·소수·음수·글자', () => {
    const base = formFromServer(view());
    const sent = (warn: string) => requestBodyOf(editRow(base, 'INPUT', 'warn', warn, view())).screens.INPUT?.warnSeconds;
    expect(sent('')).toBe('');
    expect(sent('9.5')).toBe('9.5');
    expect(sent('-3')).toBe('-3');
    expect(sent('abc')).toBe('abc');
    expect(sent(' 90 ')).toBe(90);
    expect(sent('0')).toBe(0);
  });

  it('본문은 키를 쓴 순서와 상관없이 같은 정본으로 비교된다 (직접 설정 → 서버 값과 같으면 저장할 것 없음)', () => {
    const server = view({ RESULT: { warnSeconds: 50, resetSeconds: 80 }, INPUT: { warnSeconds: 90, resetSeconds: 110 } });
    const form = editRow(editRow(formFromServer(server), 'INPUT', 'warn', '91', server), 'INPUT', 'warn', '90', server);
    expect(isDirty(form, server)).toBe(false);
  });
});

describe('기본값을 따르던 종류는 값이 기본값으로 돌아오면 계속 기본값을 따른다', () => {
  it('101 로 고쳤다가 100 으로 되돌리면(또는 지웠다가 다시 쓰면) 직접 설정이 되지 않고 저장할 것도 없다', () => {
    const server = view();
    const typed = (form: ReturnType<typeof formFromServer>, warn: string) => editRow(form, 'INPUT', 'warn', warn, server);
    const away = typed(formFromServer(server), '101');
    expect(away.rows.INPUT.useDefault).toBe(false);
    expect(isDirty(away, server)).toBe(true);
    const back = typed(away, '100');
    expect(back.rows.INPUT.useDefault).toBe(true);
    expect(isDirty(back, server)).toBe(false);
    // 한 글자씩 지웠다 쓰는 중간 상태도 마지막에 기본값이면 기본값을 따른다.
    const stepwise = typed(typed(typed(typed(formFromServer(server), ''), '1'), '10'), '100');
    expect(stepwise.rows.INPUT.useDefault).toBe(true);
    expect(isDirty(stepwise, server)).toBe(false);
  });

  it('이미 직접 설정했던 종류는 기본값과 같은 값을 쓰면 직접 설정으로 남는다 (병원이 고른 값이라 기본값이 바뀌어도 따라가지 않는다)', () => {
    const server = view({ INPUT: { warnSeconds: 90, resetSeconds: 110 } });
    const form = editRow(editRow(formFromServer(server), 'INPUT', 'warn', '100', server), 'INPUT', 'reset', '120', server);
    expect(form.rows.INPUT.useDefault).toBe(false);
    expect(requestBodyOf(form).screens.INPUT).toEqual({ warnSeconds: 100, resetSeconds: 120 });
  });
});

describe('저장 요청의 지문', () => {
  it('저장 본문은 입력에서 만든 본문에 근거로 삼은 서버 값의 지문을 expectedDigest 로 더한다. 지문은 읽은 그대로이고 본문의 다른 값은 바뀌지 않는다', () => {
    const base = view({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15);
    const body = requestBodyOf(formFromServer(base));
    const put = putBodyOf(body, base);
    expect(put).toEqual({ ...body, expectedDigest: DIGEST });
    expect(Object.keys(put).sort()).toEqual(['completionHoldSeconds', 'expectedDigest', 'screens']);
    // 지문은 근거로 삼은 서버 값의 것이다: 다른 지문을 가진 서버 값을 근거로 하면 그 지문을 보낸다.
    expect(putBodyOf(body, { ...base, policyDigest: 'cd34'.repeat(16) }).expectedDigest).toBe('cd34'.repeat(16));
    // 비교용 본문(서버 값과 견주는 정본)에는 지문이 끼지 않는다.
    expect(bodyOfServer(base)).not.toHaveProperty('expectedDigest');
  });
});

describe('낡은 화면 판단과 응답 모양 확인', () => {
  it('서버 값이 근거와 같으면 같은 설정이고, 직접 저장한 종류·값·자동 복귀 중 하나라도 다르면 다르다', () => {
    const base = view({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15);
    expect(sameServerSettings(base, view({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15))).toBe(true);
    expect(sameServerSettings(base, view({ INPUT: { warnSeconds: 91, resetSeconds: 110 } }, 15))).toBe(false);
    expect(sameServerSettings(base, view({ INPUT: { warnSeconds: 90, resetSeconds: 110 }, RESULT: { warnSeconds: 50, resetSeconds: 80 } }, 15))).toBe(false);
    expect(sameServerSettings(base, view({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, null))).toBe(false);
  });

  it('쓸 수 있는 모양만 값으로 받는다: 빈 객체·문자열·null·종류가 빠진 응답은 거절', () => {
    expect(isPolicyView(view())).toBe(true);
    for (const bad of [{}, '<html>', null, undefined, 5, { ...view(), idlePolicy: null }, { ...view(), customizedScreens: 'INPUT' }, { ...view(), defaults: {} }, { ...view(), minLeadSeconds: '20' }, { ...view(), policyDigest: undefined }, { ...view(), policyDigest: '' }, { ...view(), policyDigest: 5 }]) {
      expect(isPolicyView(bad), JSON.stringify(bad)).toBe(false);
    }
    const missingKind = view();
    delete (missingKind.idlePolicy.screens as Partial<typeof missingKind.idlePolicy.screens>).RESULT;
    expect(isPolicyView(missingKind)).toBe(false);
  });
});

describe('응답이 끊긴 저장: 서버 값을 다시 읽어 입력과 같은지 가린다', () => {
  const body = { screens: { INPUT: { warnSeconds: 90, resetSeconds: 110 } }, completionHoldSeconds: 15 };

  it('서버 값이 방금 보낸 본문과 같으면 일치', () => {
    expect(serverMatchesBody(view({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15), body)).toBe(true);
  });

  it('서버 값이 저장 전 그대로이면 불일치 (저장되지 않았다)', () => {
    expect(serverMatchesBody(view(), body)).toBe(false);
  });

  it('직접 저장한 종류의 집합·값·자동 복귀 중 하나라도 다르면 불일치', () => {
    expect(serverMatchesBody(view({ INPUT: { warnSeconds: 90, resetSeconds: 110 }, RESULT: { warnSeconds: 50, resetSeconds: 80 } }, 15), body)).toBe(false);
    expect(serverMatchesBody(view({ INPUT: { warnSeconds: 90, resetSeconds: 111 } }, 15), body)).toBe(false);
    expect(serverMatchesBody(view({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, null), body)).toBe(false);
  });

  it('서버가 받을 수 없는 글자 값이 든 본문은 서버 값과 같을 수 없다', () => {
    expect(serverMatchesBody(view({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15), { ...body, completionHoldSeconds: '15' })).toBe(false);
  });

  it('5xx 는 결과를 알 수 없는 응답이고 4xx 는 분명한 거절이다', () => {
    expect([500, 502, 503].every(isOutcomeUnknown)).toBe(true);
    expect([400, 401, 403, 404, 409].some(isOutcomeUnknown)).toBe(false);
  });
});

describe('입력 안내 (입력을 막지 않는다)', () => {
  const row = (warn: string, reset: string) => ({ warn, reset, useDefault: false });

  it('간격이 하한 미만·경고 ≥ 초기화이면 안내하고, 정수가 아니면 정수 안내를 한다. 문제없으면 null', () => {
    expect(rowHint(row('100', '120'), 20)).toBeNull();
    expect(rowHint(row('100', '119'), 20)).toBe(IDLE_COPY.hintLead(20));
    expect(rowHint(row('130', '100'), 20)).toBe(IDLE_COPY.hintLead(20));
    expect(rowHint(row('', '120'), 20)).toBe(IDLE_COPY.hintInteger);
    expect(rowHint(row('1.5', '120'), 20)).toBe(IDLE_COPY.hintInteger);
  });

  it('간격 하한은 서버가 알려 준 값을 쓴다 (화면에 20 을 박아 두지 않는다)', () => {
    expect(rowHint(row('100', '125'), 30)).toBe(IDLE_COPY.hintLead(30));
    expect(IDLE_COPY.hintLead(30)).toContain('30초');
  });

  it('자동 복귀 안내: 꺼져 있으면 없음, 켜고 1 이상 정수면 없음 (20초 하한 없음), 0·빈 칸·소수는 안내', () => {
    const on = setHoldEnabled(formFromServer(view()), true);
    expect(holdHint(formFromServer(view()))).toBeNull();
    expect(holdHint(setHoldText(on, '1'))).toBeNull();
    expect(holdHint(setHoldText(on, '5'))).toBeNull();
    for (const text of ['', '0', '1.5', 'x', '-1']) {
      expect(holdHint(setHoldText(on, text)), text).toBe(IDLE_COPY.hintHold);
    }
  });
});

describe('서버 거절 문장', () => {
  const failure = (status: number, defects?: Array<{ code: string; path: string }>) => ({ status, body: { error: 'X', ...(defects !== undefined ? { defects } : {}) } });

  it('400 은 결함마다 화면 종류 이름과 어떤 시간이 틀렸는지를 말하고, 코드 글자를 보이지 않으며, 서버 설정이 그대로라는 말로 끝난다', () => {
    const text = saveFailureMessage(
      failure(400, [
        { code: 'LEAD_TIME_TOO_SHORT', path: 'screens.INPUT.resetSeconds' },
        { code: 'VALUE_INVALID', path: 'screens.RESULT.warnSeconds' },
        { code: 'VALUE_MISSING', path: 'screens.HOLD_RESULT.resetSeconds' },
        { code: 'VALUE_INVALID', path: 'completionHoldSeconds' },
      ]),
      20,
    );
    expect(text).toContain(`${IDLE_SCREEN_LABEL.INPUT.name}: 초기화 시간은 경고 시간보다 20초 이상 길어야 합니다.`);
    expect(text).toContain(IDLE_COPY.failure.warnInvalid(IDLE_SCREEN_LABEL.RESULT.name));
    expect(text).toContain(IDLE_COPY.failure.resetMissing(IDLE_SCREEN_LABEL.HOLD_RESULT.name));
    expect(text).toContain(IDLE_COPY.failure.holdInvalid);
    expect(text).toMatch(/서버의 설정은 그대로입니다\. 입력한 값은 화면에 남아 있습니다\.$/);
    expect(text).not.toMatch(/LEAD_TIME_TOO_SHORT|VALUE_INVALID|VALUE_MISSING|screens\./);
  });

  it('401·403·404 는 각각 다른 문장이고 모두 저장되지 않았다는 말을 담는다. 알 수 없는 400 결함도 문장이 된다', () => {
    const texts = [401, 403, 404].map((status) => saveFailureMessage(failure(status), 20));
    expect(new Set(texts).size).toBe(3);
    for (const text of texts) expect(text).toContain('저장되지 않았고 서버의 설정은 그대로입니다');
    expect(saveFailureMessage(failure(400, [{ code: 'SOMETHING_NEW', path: 'screens.UNKNOWN.warnSeconds' }]), 20)).toContain(IDLE_COPY.failure.other);
    expect(saveFailureMessage(failure(400), 20)).toBe(IDLE_COPY.failure.generic);
  });

  it('409 IDLE_POLICY_CHANGED 는 "다른 곳에서 바뀌었다" 는 별도 문장이고, 저장되지 않았다·입력이 남았다·서버 값을 다시 읽는다는 말을 담는다. 다른 사유의 409 는 일반 문장이다', () => {
    const changed = { status: 409, body: { error: 'CONFLICT', reason: 'IDLE_POLICY_CHANGED' } };
    expect(isPolicyChanged(changed)).toBe(true);
    const text = saveFailureMessage(changed, 20);
    expect(text).toBe(IDLE_COPY.failure.policyChanged);
    expect(text).toContain('다른 창이나 다른 사람이');
    expect(text).toContain('아무것도 저장하지 않았고 서버의 설정은 그대로입니다');
    expect(text).toContain('입력한 값은 화면에 남아 있습니다');
    expect(text).toContain('서버 값 다시 읽기');
    expect(text).not.toMatch(/IDLE_POLICY_CHANGED|expectedDigest/);
    for (const other of [{ status: 409, body: { error: 'CONFLICT', reason: 'SOMETHING_ELSE' } }, { status: 409, body: { error: 'CONFLICT' } }, { status: 400, body: { error: 'X', reason: 'IDLE_POLICY_CHANGED' } }]) {
      expect(isPolicyChanged(other), JSON.stringify(other)).toBe(false);
    }
    expect(saveFailureMessage({ status: 409, body: { error: 'CONFLICT', reason: 'SOMETHING_ELSE' } }, 20)).toBe(IDLE_COPY.failure.generic);
  });

  it('같은 결함이 겹쳐도 문장은 한 번만 나온다', () => {
    const defect = { code: 'VALUE_INVALID', path: 'completionHoldSeconds' };
    const text = saveFailureMessage(failure(400, [defect, defect]), 20);
    expect(text.split(IDLE_COPY.failure.holdInvalid)).toHaveLength(2);
  });
});

describe('문구', () => {
  it('화면 종류 다섯 개의 이름이 모두 있고 서로 다르다', () => {
    const names = IDLE_SCREEN_KINDS.map((kind) => IDLE_SCREEN_LABEL[kind].name);
    expect(new Set(names).size).toBe(5);
  });

  it('머리말은 열려 있는 키오스크에는 바로 적용되지 않는다는 것, 가격·보장 규칙·계산이 바뀌지 않는다는 것, 저장이 전체 교체라는 것을 말한다', () => {
    expect(IDLE_COPY.applyNote).toContain('이미 열려 있는 키오스크에는 적용되지 않습니다');
    expect(IDLE_COPY.applyNote).toContain('처음 화면으로 돌아가는 것만으로는 다시 읽지 않습니다');
    expect(IDLE_COPY.applyNote).toContain('가격·보장 규칙·계산 결과는 이 설정으로 바뀌지 않습니다');
    expect(IDLE_COPY.replaceNote).toContain('설정 전체를 한 번에 바꿉니다');
  });

  it('자동 복귀 안내는 기본 시간이 없고 20초 하한도 없다고 말한다', () => {
    expect(IDLE_COPY.holdNote).toContain('기본 시간은 정해져 있지 않고');
    expect(IDLE_COPY.holdNote).toContain('20초 이상 같은 하한도 없습니다');
  });

  it('응답이 끊긴 저장의 세 결과 문장이 서로 다르고 단정하지 않는다', () => {
    expect(new Set([IDLE_COPY.lostConfirmed, IDLE_COPY.lostNotSaved, IDLE_COPY.lostUnverified]).size).toBe(3);
    expect(IDLE_COPY.lostUnverified).toContain('저장에 성공했을 수도, 실패했을 수도 있습니다');
    // 서버 오류(5xx)처럼 응답은 받았지만 결과를 믿을 수 없는 경우에도 맞는 말이다: '응답을 받지 못했' 이라고 단정하지 않는다.
    expect(IDLE_COPY.lostConfirmed).not.toContain('응답을 받지 못');
    expect(IDLE_COPY.lostNotSaved).not.toContain('응답을 받지 못');
  });
});
