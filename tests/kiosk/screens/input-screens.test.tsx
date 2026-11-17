import { describe, expect, it } from 'vitest';
import { InputScreen } from '../../../src/app/kiosk/components/InputScreen';
import { K01Generation } from '../../../src/app/kiosk/screens/K01Generation';
import { K01GenerationHelp } from '../../../src/app/kiosk/screens/K01GenerationHelp';
import { K02Type } from '../../../src/app/kiosk/screens/K02Type';
import { K02bCause } from '../../../src/app/kiosk/screens/K02bCause';
import { K03Treatments } from '../../../src/app/kiosk/screens/K03Treatments';
import { selectTotals } from '../../../src/app/kiosk/state/selectors';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { formatWon } from '../../../src/app/kiosk/view/format';
import { T_KIDNEY_SPRAY, T_PHYSIO, T_ULTRASOUND, T_XRAY, makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';
import { stateAt } from '../../fixtures/kiosk/state.fixture';
import { render, renderWithState, textOf } from './render';

// 입력 단계 화면의 서버 렌더링 시험(마크업·문구·방향/큰 글자 변형). 클릭·초점·배치는 브라우저 시험(tests/e2e)이 본다.
// 환자 화면 금지 문구(AC-012c·h, BRIEF §2)는 이 파일의 BANNED 와 정적 검사(tests/kiosk/static)가 같이 지킨다.

const BANNED = [/tel:/, /<a[\s>]/, /href=/, /1588/, /type="(date|datetime|month|text|tel|number)"/, /직원에게 문의하기/, /상담/, /자기부담금|공제액|공제금|한도|특약/, /PROFILE_|MAPPING_|LINE_|GEN\d_|NON_LIFE|MUTUAL_AID/, /requestId|refreshId|sessionId/, /0원 확인|undefined|NaN|null/];

const inputsWith = (patch: Partial<KioskState['inputs']>): KioskState['inputs'] => ({ generation: null, insurerType: null, cause: null, treatmentIds: [], ...patch });

function states(screen: Parameters<typeof stateAt>[0], patch: Partial<KioskState> = {}): Array<[string, KioskState]> {
  const base = stateAt(screen, patch);
  const withDisplay = (orientation: 'PORTRAIT' | 'LANDSCAPE', largeText: boolean): KioskState => ({ ...base, display: { orientation, largeText } });
  return [
    ['세로 보통', withDisplay('PORTRAIT', false)],
    ['세로 큰 글자', withDisplay('PORTRAIT', true)],
    ['가로 보통', withDisplay('LANDSCAPE', false)],
    ['가로 큰 글자', withDisplay('LANDSCAPE', true)],
  ];
}

describe('K01_Generation (AC-012a·b·d·h·i)', () => {
  it.each(states('K01_Generation'))('%s: 제목·단계 표시·카드 다섯 장(응답 label 순서)·"세대를 모르겠어요"·가입 시기 안내·하단 단추', (_name, state) => {
    const html = renderWithState(state, <K01Generation />).html;
    const text = textOf(html);
    expect(text).toContain('1 / 4');
    expect(html).toContain('<h1');
    expect(text).toContain('내 실손보험을 선택해 주세요');
    expect((html.match(/type="radio"/g) ?? []).length).toBe(5);
    expect([...html.matchAll(/aria-label="([^"]+)"[^>]*type="radio"|type="radio"[^>]*aria-label="([^"]+)"/g)].length).toBeGreaterThanOrEqual(5);
    for (const label of ['1세대(A·S)', '2세대(C1)', '2.5세대(C2)', '3세대(C3)', '4세대(C4)']) expect(html).toContain(`aria-label="${label}"`);
    expect(text).toContain('세대를 모르겠어요');
    expect(text).toContain('가입 시기를 모르실 때');
    expect(text).toContain('보험증권이나 보험사 앱에서 가입일을 확인해 주세요.');
    expect(text).toContain('처음으로');
    expect(text).toContain('다음');
  });

  it.each(states('K01_Generation'))('%s: 경계 안내 임시 문구는 세대 선택 화면에 없다 (2026-11-04: "세대를 모르겠어요" 도움말로 옮김, §E #35)', (_name, state) => {
    const html = renderWithState(state, <K01Generation />).html;
    expect(html).not.toContain('data-kiosk-boundary-pending');
    expect(textOf(html)).not.toContain('가입 시기 경계 안내');
    expect(html).not.toMatch(/checked=""/);
  });

  it('아무것도 고르지 않은 상태: 라디오는 모두 해제이고 "다음" 은 aria-disabled 이다; 가입일 입력·자동 추정·다섯째 세대 카드가 없다', () => {
    const html = renderWithState(stateAt('K01_Generation'), <K01Generation />).html;
    expect(html).not.toMatch(/checked=""/);
    expect(html).toMatch(/aria-disabled="true"[^>]*>(?:(?!<\/button>).)*다음/s);
    expect(html).not.toMatch(/<input[^>]*type="(date|text|number|tel)"/);
    expect(html.match(/kiosk-choice--generation/g)).toHaveLength(5);
    expect(html).not.toMatch(/자동|추정|가입일 입력/);
  });

  it('세대를 고르면 그 카드만 checked 이고 "선택됨" 표시가 하나이며 "다음" 이 활성이다', () => {
    const html = renderWithState(stateAt('K01_Generation', { inputs: inputsWith({ generation: 'GEN3_C3' }) }), <K01Generation />).html;
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html.match(/선택됨/g)).toHaveLength(1);
    const next = /<button[^>]*>(?:(?!<\/button>).)*다음(?:(?!<\/button>).)*<\/button>/s.exec(html)?.[0] ?? '';
    expect(next).not.toContain('aria-disabled');
  });

  it('카드는 코드 칩·이름·가입 기간 줄을 가진다 (옛 세대는 "가입기간 … 이전", 4세대는 응답 문구 그대로)', () => {
    const text = textOf(renderWithState(stateAt('K01_Generation'), <K01Generation />).html);
    expect(text).toContain('가입기간 2009.08.01 이전');
    expect(text).toContain('가입기간 2009.08.01 ~ 2015.09.01 이전');
    expect(text).toContain('2021.07.01부터의 4세대 계약');
    expect(text).toContain('C1');
  });

  it('가입 시기 안내는 응답 문장을 줄로 나눠 그대로 보인다 (응답에 없는 연락처·시간을 보태지 않는다)', () => {
    const options = makeOptions({ guidance: { generationUnknown: '첫 문장입니다. 둘째 문장입니다.' } });
    const html = renderWithState(stateAt('K01_Generation', {}, { options }), <K01Generation />).html;
    expect(html).toContain('<p>첫 문장입니다.</p>');
    expect(html).toContain('<p>둘째 문장입니다.</p>');
  });

  it.each(states('K01_Generation'))('%s: 금지 문구·링크·전화 연결이 없다', (_name, state) => {
    const html = renderWithState(state, <K01Generation />).html;
    for (const banned of BANNED) expect(html, String(banned)).not.toMatch(banned);
  });

  it('"확인 방법 보기" 와 "세대를 모르겠어요" 가 모두 있다 (디자인 저장본과 인수 기준의 이름이 달라 둘 다 그린다)', () => {
    const text = textOf(renderWithState(stateAt('K01_Generation'), <K01Generation />).html);
    expect(text).toContain('확인 방법 보기');
    expect(text).toContain('세대를 모르겠어요');
  });
});

describe('K01_Generation_Unknown (AC-012d)', () => {
  it.each(states('K01_Generation_Unknown'))('%s: 제목·두 안내 단계·돌아가기 하나; 1544-8069 는 글자일 뿐이다', (_name, state) => {
    const html = renderWithState(state, <K01GenerationHelp />).html;
    const text = textOf(html);
    expect(text).toContain('보험 세대가 특정되지 않으면 정확한 안내가 어렵습니다');
    expect(text).toContain('1544-8069로 문의해 주세요');
    // §E #32: 운영 주체·문의 가능 시간은 확정 전이라 값을 지어내지 않고 "확인 중"으로만 표시한다. 시간대·요일·다른 번호는 없다.
    expect(text).toContain('운영 주체와 문의 가능 시간은 확인 중입니다.');
    expect(text).not.toMatch(/\d{1,2}\s*[:시]\s*\d{0,2}|평일|주말|09:00|18:00|\b1588\b/);
    expect(text).toContain('키오스크에서 전화가 걸리지는 않습니다');
    expect(text).toContain('보험 선택으로 돌아가기');
    expect(html.match(/<button/g)).toHaveLength(1);
    for (const banned of BANNED.filter((pattern) => !/1588/.test(String(pattern)))) expect(html, String(banned)).not.toMatch(banned);
    expect(html).not.toMatch(/\d{3,4}-\d{4}<\/a>/);
  });

  it.each(states('K01_Generation_Unknown'))('%s: 경계 안내 임시 문구 "가입 시기 경계 안내: 문구 검토 중" 한 줄이 하나만 있고 버튼·링크가 아니며 세대를 정하거나 제안하지 않는다 (§E #35)', (_name, state) => {
    const html = renderWithState(state, <K01GenerationHelp />).html;
    expect(html.match(/data-kiosk-boundary-pending/g)).toHaveLength(1);
    expect(/<p class="kiosk-help-screen__pending" data-kiosk-boundary-pending="true">([^<]*)<\/p>/.exec(html)?.[1]).toBe('가입 시기 경계 안내: 문구 검토 중');
    expect(html).not.toMatch(/2009\.0[89]\.[^"<]*경계|경계 계약|추천|권장/);
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});

describe('K02_Type (AC-012a·b·c·g)', () => {
  it.each(states('K02_Type'))('%s: 2 / 4, 카드 세 장, 안내 문장은 문장일 뿐 단추가 아니다', (_name, state) => {
    const html = renderWithState(state, <K02Type />).html;
    const text = textOf(html);
    expect(text).toContain('2 / 4');
    expect(text).toContain('실손보험이 가입된 보험사의 형태를 선택해 주세요');
    expect((html.match(/type="radio"/g) ?? []).length).toBe(3);
    for (const label of ['손해보험사', '생명보험사', '그외 공제 조합']) expect(text).toContain(label);
    expect(text).toContain('접수 직원에게 문의해 주세요');
    expect(textOf(html.replace(/<button[\s\S]*?<\/button>/g, ''))).toContain('접수 직원에게 문의해 주세요');
    for (const banned of BANNED) expect(html, String(banned)).not.toMatch(banned);
  });

  it('보험사 이름 목록·검색·추가 질문이 없다 (카드 문구는 응답 그대로)', () => {
    const text = textOf(renderWithState(stateAt('K02_Type'), <K02Type />).html);
    expect(text).not.toMatch(/삼성|현대|DB|KB|검색|보험사 이름/);
    expect(text).toContain('우체국, 새마을금고 공제회, 농협');
  });
});

describe('K02b_Cause (AC-012a·b)', () => {
  it.each(states('K02b_Cause'))('%s: 3 / 4, 카드 세 장(잘 모르겠어요 포함)', (_name, state) => {
    const html = renderWithState(state, <K02bCause />).html;
    const text = textOf(html);
    expect(text).toContain('3 / 4');
    expect(text).toContain('어떤 일로 병원에 오셨나요?');
    expect((html.match(/type="radio"/g) ?? []).length).toBe(3);
    for (const label of ['다쳐서 왔어요 (상해)', '아파서 왔어요 (질병)', '잘 모르겠어요']) expect(text).toContain(label);
    expect(text).toContain('예상 금액은 달라지지 않습니다');
    for (const banned of BANNED) expect(html, String(banned)).not.toMatch(banned);
  });
});

describe('K03_Treatments (AC-012e·f·014d·019c)', () => {
  const picked = (ids: string[], patch: Partial<KioskState> = {}): KioskState => stateAt('K03_Treatments', { inputs: inputsWith({ generation: 'GEN2_C1', insurerType: 'NON_LIFE', cause: 'INJURY', treatmentIds: ids }), ...patch });
  const display = (state: KioskState, orientation: 'PORTRAIT' | 'LANDSCAPE', largeText: boolean): KioskState => ({ ...state, display: { orientation, largeText } });

  it('세로 보통: 한 쪽 네 장, 급여/비급여 표시, 치료 이름·가격, 쪽 번호 "1 / 2 페이지", 선택 유지 안내, 선택 요약 막대', () => {
    const html = renderWithState(picked([T_XRAY, T_KIDNEY_SPRAY]), <K03Treatments />).html;
    const text = textOf(html);
    expect(text).toContain('4 / 4');
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(4);
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(text).toContain('1 / 2 페이지');
    expect(text).toContain('이전 목록');
    expect(text).toContain('다음 목록');
    expect(text).toContain('다른 목록 페이지로 넘어가도 이미 선택한 치료는 그대로 유지됩니다.');
    expect(text).toContain('선택한 치료 2개');
    expect(text).toContain('급여 10,000원 · 비급여 40,000원');
    expect(text).toContain('총 예상 결제액');
    expect(text).toContain('50,000원');
    expect(text).toContain('환자 예상 결제액');
    expect(html).toContain('kiosk-summary--bar');
    expect(html).not.toContain('kiosk-summary--panel');
  });

  it('선택 요약의 금액은 selectTotals 의 값과 정확히 같다 (이 화면에는 덧셈이 없다, AC-019c)', () => {
    for (const ids of [[], [T_XRAY], [T_XRAY, T_ULTRASOUND, T_KIDNEY_SPRAY, T_PHYSIO]]) {
      const state = picked(ids);
      const totals = selectTotals(state);
      const text = textOf(renderWithState(state, <K03Treatments />).html);
      expect(text).toContain(`선택한 치료 ${totals.selectedCount}개`);
      expect(text).toContain(`급여 ${formatWon(totals.benefit)} · 비급여 ${formatWon(totals.nonBenefit)}`);
      expect(text).toContain(formatWon(totals.total));
    }
  });

  it('예시 네 가지 치료의 합계는 급여 14,000원 · 비급여 110,000원 · 총 124,000원이다 (AC-012f)', () => {
    const text = textOf(renderWithState(picked([T_XRAY, T_ULTRASOUND, T_KIDNEY_SPRAY, T_PHYSIO]), <K03Treatments />).html);
    expect(text).toContain('선택한 치료 4개');
    expect(text).toContain('급여 14,000원 · 비급여 110,000원');
    expect(text).toContain('124,000원');
  });

  it('공통 기본비용이 등록된 병원은 치료를 고른 뒤에만 합계에 들어간다 (고르기 전 합계는 0원)', () => {
    const catalog = makeCatalog({ baseFeeIncluded: 'INCLUDED', baseFees: [{ benefitType: 'BENEFIT', amount: 5_000 } as never] });
    const empty = textOf(renderWithState(stateAt('K03_Treatments', {}, { catalog }), <K03Treatments />).html);
    expect(empty).toContain('선택한 치료 0개');
    const chosen = renderWithState(stateAt('K03_Treatments', { inputs: inputsWith({ treatmentIds: [T_XRAY] }) }, { catalog }), <K03Treatments />).html;
    expect(textOf(chosen)).toContain('급여 15,000원');
  });

  it('아무것도 고르지 않으면 비활성 이유 문장이 보이고 확인 단추가 그 문장을 aria-describedby 로 가리킨다 (0원은 선택 합계일 뿐이다)', () => {
    const html = renderWithState(picked([]), <K03Treatments />).html;
    expect(textOf(html)).toContain('치료를 1개 이상 선택하면 예상 부담액을 확인할 수 있습니다.');
    const id = /aria-describedby="([^"]+)"[^>]*>(?:(?!<\/button>).)*예상 부담액 확인/s.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`id="${id ?? ''}"`);
    expect(html).toMatch(/aria-disabled="true"[^>]*aria-describedby=/);
  });

  it('치료를 고르면 비활성 이유 문장이 사라지고 확인 단추가 활성이다', () => {
    const html = renderWithState(picked([T_XRAY]), <K03Treatments />).html;
    expect(textOf(html)).not.toContain('치료를 1개 이상 선택하면');
    const confirm = /<button[^>]*>(?:(?!<\/button>).)*예상 부담액 확인(?:(?!<\/button>).)*<\/button>/s.exec(html)?.[0] ?? '';
    expect(confirm).not.toContain('aria-disabled');
  });

  it('둘째 쪽은 다섯째·여섯째 치료만 보이고 "2 / 2 페이지", 첫 쪽에서 고른 선택은 요약에 남는다 (쪽을 넘겨도 선택이 유지된다, AC-014d)', () => {
    const state = picked([T_XRAY], { treatmentPageOffset: 4 });
    const html = renderWithState(state, <K03Treatments />).html;
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(2);
    expect(textOf(html)).toContain('2 / 2 페이지');
    expect(textOf(html)).toContain('선택한 치료 1개');
    expect(textOf(html)).toContain('10,000원');
  });

  it('큰 글자 보기는 한 쪽에 두 장이고 페이지 수가 늘어난다 (3 페이지); 선택 요약·기능은 그대로다', () => {
    const state = display(picked([T_XRAY]), 'PORTRAIT', true);
    const html = renderWithState(state, <K03Treatments />).html;
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(2);
    expect(textOf(html)).toContain('1 / 3 페이지');
    expect(textOf(html)).toContain('선택한 치료 1개');
    expect(textOf(html)).toContain('예상 부담액 확인');
  });

  it.each([
    ['가로 보통', 'LANDSCAPE', false],
    ['가로 큰 글자', 'LANDSCAPE', true],
  ] as const)('%s: 왼쪽 선택 패널(선택한 치료·급여 합계·비급여 합계)과 하단 합계 두 줄을 쓰고 세로형 막대는 쓰지 않는다', (_name, orientation, largeText) => {
    const html = renderWithState(display(picked([T_XRAY, T_KIDNEY_SPRAY]), orientation, largeText), <K03Treatments />).html;
    const text = textOf(html);
    expect(html).toContain('kiosk-summary--panel');
    expect(html).toContain('kiosk-summary--line');
    expect(html).not.toContain('kiosk-summary--bar');
    expect(text).toContain('선택한 치료');
    expect(text).toContain('급여 합계');
    expect(text).toContain('비급여 합계');
    expect(text).toContain('총 예상 결제액 (급여 10,000원 · 비급여 40,000원)');
    expect(text).toContain('50,000원');
  });

  it('치료 카드 문구는 응답의 이름·설명·가격 조건 그대로이고 내부 코드·"N" 값이 보이지 않는다', () => {
    const html = renderWithState(picked([]), <K03Treatments />).html;
    expect(html).toContain('TEST_FIXTURE X-ray');
    expect(html).toContain('TEST_FIXTURE 설명 TEST_FIXTURE X-ray · TEST_FIXTURE_PATIENT · TEST_FIXTURE_ASSUMPTION · 기준일 2026-10-16');
    expect(html).not.toMatch(/BENEFIT<|NON_BENEFIT|treatmentId|TEST_FIXTURE_TREATMENT_1/);
  });

  it.each(states('K03_Treatments'))('%s: 금지 문구·링크·전화 연결이 없다', (_name, state) => {
    const html = renderWithState({ ...state, inputs: inputsWith({ treatmentIds: [T_XRAY] }) }, <K03Treatments />).html;
    for (const banned of BANNED) expect(html, String(banned)).not.toMatch(banned);
  });

  it('치료 목록이 비어 있으면 빈 목록 안내만 보이고 확인 단추는 비활성이다', () => {
    const base = picked([]);
    const html = renderWithState({ ...base, clinic: { ...base.clinic, catalog: makeCatalog({ treatments: [] }) } }, <K03Treatments />).html;
    expect(html).toContain('지금 선택할 수 있는 치료가 없습니다.');
    expect(html).not.toContain('type="checkbox"');
  });

  describe('자료 갱신 표시 (DD-09, AC-020b~i)', () => {
    const refreshing: Partial<KioskState> = { refreshState: 'RUNNING', activeRefresh: { refreshId: 'RFR-MARKER-0001', sessionId: 'SID-MARKER-0001', inputRevision: 1, reason: 'VERSION_MISMATCH' } };

    it('진행 중: 진행 안내(role=status)가 보이고 카드는 aria-disabled·잠금 스타일, "이전" 은 비활성; 처음으로·쪽 넘김은 잠기지 않는다', () => {
      const html = renderWithState(picked([T_XRAY], refreshing), <K03Treatments />).html;
      expect(html).toContain('role="status"');
      expect(html).toContain('data-kiosk-refresh="running"');
      expect(textOf(html)).toContain('가격과 보험 기준을 다시 확인하고 있어요');
      expect(textOf(html)).toContain('확인이 끝나면 예상 부담액 확인을 다시 눌러 주세요.');
      expect((html.match(/kiosk-choice--locked/g) ?? []).length).toBe(4);
      expect((html.match(/<input[^>]*aria-disabled="true"/g) ?? []).length).toBe(4);
      const previous = /<button[^>]*>(?:(?!<\/button>).)*>이전<(?:(?!<\/button>).)*<\/button>/s.exec(html)?.[0] ?? '';
      expect(previous).toContain('aria-disabled="true"');
      const home = /<button[^>]*>(?:(?!<\/button>).)*처음으로(?:(?!<\/button>).)*<\/button>/s.exec(html)?.[0] ?? '';
      expect(home).not.toContain('aria-disabled');
      expect(html).not.toMatch(/RFR-MARKER|SID-MARKER|refreshId/);
    });

    it('진행 중에는 "치료를 1개 이상 선택하면" 문장 대신 갱신 안내가 이유를 말한다', () => {
      const html = renderWithState(picked([], refreshing), <K03Treatments />).html;
      expect(textOf(html)).not.toContain('치료를 1개 이상 선택하면');
      expect(textOf(html)).toContain('가격과 보험 기준을 다시 확인하고 있어요');
    });

    it('실패: 실패 안내(role=alert)와 인라인 "다시 시도" 가 보이고 계산 결과 문구가 없다; 새 화면이 아니다', () => {
      const html = renderWithState(picked([T_XRAY], { refreshState: 'FAILED' }), <K03Treatments />).html;
      expect(html).toContain('role="alert"');
      expect(html).toContain('data-kiosk-refresh="failed"');
      expect(textOf(html)).toContain('최신 정보를 불러오지 못했어요');
      expect(textOf(html)).toContain('다시 시도');
      expect(html).toContain('data-input="treatments"');
      expect(html).not.toMatch(/0원 확인|결과/);
    });

    it('성공 뒤 선택에서 빠진 치료가 있으면 이름과 안내가 보이고, 자동 계산 없이 화면은 그대로이다', () => {
      const html = renderWithState(picked([T_XRAY], { refreshNotice: { removed: [{ treatmentId: T_PHYSIO, displayName: '물리치료' }, { treatmentId: T_ULTRASOUND, displayName: '초음파' }] } }), <K03Treatments />).html;
      expect(html).toContain('data-kiosk-refresh="removed"');
      expect(textOf(html)).toContain('더 이상 선택할 수 없는 치료를 목록에서 뺐어요');
      expect(textOf(html)).toContain('‘물리치료’, ‘초음파’');
      expect(textOf(html)).toContain('가격이 바뀌었을 수 있으니 예상 부담액 확인을 다시 눌러 주세요.');
    });

    it('빠진 치료가 없는 성공이면 안내가 없다', () => {
      const html = renderWithState(picked([T_XRAY], { refreshNotice: { removed: [] } }), <K03Treatments />).html;
      expect(html).not.toContain('data-kiosk-refresh');
    });

    it('갱신 안내가 없으면 그리지 않는다', () => {
      expect(renderWithState(picked([T_XRAY]), <K03Treatments />).html).not.toContain('data-kiosk-refresh');
    });
  });
});

describe('카드·뼈대의 드문 모양 (응답이 다른 모양이어도 화면이 깨지지 않는다)', () => {
  it('괄호가 없는 세대 label 은 코드 칩 없이 이름만 그린다', () => {
    const options = makeOptions({ generations: [{ code: 'GEN1_AS', label: '새 세대', period: '2030.01.01부터의 계약' }] });
    const html = renderWithState(stateAt('K01_Generation', {}, { options }), <K01Generation />).html;
    expect(html).not.toContain('kiosk-choice__chip');
    expect(textOf(html)).toContain('새 세대');
    expect(textOf(html)).toContain('2030.01.01부터의 계약');
  });

  it('설명·가격 조건이 비어 있는 치료는 빈 설명 줄을 그리지 않고 금액은 그대로 보인다', () => {
    const base = makeCatalog();
    const catalog = makeCatalog({ treatments: base.treatments.map((entry) => ({ ...entry, description: '', priceCondition: ' ' })) });
    const html = renderWithState(stateAt('K03_Treatments', {}, { catalog }), <K03Treatments />).html;
    expect(html).toMatch(/kiosk-choice__desc kiosk-choice__desc--small"[^>]*><\/span>/);
    expect(textOf(html)).toContain('10,000원');
  });

  it('가로형에서 치료를 고르지 않으면 합계 줄과 패널이 0원으로 흐리게 보인다 (선택 합계가 0이라는 뜻이다)', () => {
    const state = stateAt('K03_Treatments');
    const html = renderWithState({ ...state, display: { orientation: 'LANDSCAPE', largeText: false } }, <K03Treatments />).html;
    expect(html).toContain('kiosk-summary__total--muted');
    expect(textOf(html)).toContain('총 예상 결제액 (급여 0원 · 비급여 0원) 0원');
  });

  it('세로형에서 치료를 고르지 않으면 합계 막대의 총액이 흐리게 보인다', () => {
    const html = renderWithState(stateAt('K03_Treatments'), <K03Treatments />).html;
    expect(html).toContain('kiosk-summary__total kiosk-summary__total--muted');
  });

  it('InputScreen 은 부제·안내·부속이 없어도 제목과 목록과 하단만으로 그려진다', () => {
    const html = render(
      <InputScreen step={2} kind="type" title="제목" footer={<div id="footer" />}>
        <div id="choices" />
      </InputScreen>,
    );
    expect(html).toContain('제목');
    expect(html).not.toContain('kiosk-input__subtitle');
    expect(html).not.toContain('kiosk-input__notice');
    expect(html).not.toContain('kiosk-input__aside');
    expect(html).not.toContain('data-has-notice');
    expect(html.indexOf('kiosk-input__title')).toBeLessThan(html.indexOf('kiosk-input__choices'));
  });

  it('안내가 있으면 본문에 data-has-notice 가 붙고 DOM 순서는 제목 → 안내 → 목록 → 부속이다 (초점 순서가 화면 순서와 같다)', () => {
    const html = render(
      <InputScreen step={4} kind="treatments" title="제목" subtitle="부제" notice={<span>안내</span>} aside={<span>부속</span>} footer={null}>
        <span>목록</span>
      </InputScreen>,
    );
    expect(html).toContain('data-has-notice="true"');
    const order = ['제목', '부제', '안내', '목록', '부속'].map((text) => html.indexOf(text));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index >= 0)).toBe(true);
  });
});
