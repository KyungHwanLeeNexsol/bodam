import { describe, expect, it } from 'vitest';
import { CalculatingScreen } from '../../../src/app/kiosk/screens/CalculatingScreen';
import { NetworkErrorScreen } from '../../../src/app/kiosk/screens/NetworkErrorScreen';
import { K04Result, K04ResultHold, K04ResultNotCovered } from '../../../src/app/kiosk/screens/ResultScreens';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { T_KIDNEY_SPRAY, T_PHYSIO, T_ULTRASOUND, T_XRAY } from '../../fixtures/kiosk/clinic.fixture';
import { estimatedResponse, holdResponse, notCoveredResponse, resultStateWith } from '../../fixtures/kiosk/estimate.fixture';
import { stateAt } from '../../fixtures/kiosk/state.fixture';
import { buttonLabels, renderWithState, textOf } from './render';

// 결과 쪽 화면의 서버 렌더링 시험 (SPEC-REIMBURSEMENT-001 M6 S3a, AC-013a~f·AC-010e·AC-013d): 마크업·문구·방향/큰 글자 변형. 클릭·초점·배치·잘림은 브라우저 시험(tests/e2e)이 본다.
// 환자 화면 금지 문구는 BANNED 와 정적 검사(tests/kiosk/static)가 같이 지킨다.

// "(?<![\d,])0원" 은 단독 0원 금액이다. 124,000원 같은 금액 안의 "0원" 글자는 해당하지 않는다.
const BANNED = [/tel:/, /<a[\s>]/, /href=/, /1588/, /직원에게 문의하기/, /상담/, /PROFILE_|MAPPING_|LINE_|CLASSIFICATION_|CALC_|RULE_BUNDLE|CLINIC_RULE|GEN\d_|NON_LIFE|MUTUAL_AID/, /requestId|refreshId|sessionId/, /undefined|NaN|null/, /환자분의 실손은/, /오늘 [^<]*만 내면 됩니다/];

function variants(state: KioskState): Array<[string, KioskState]> {
  const withDisplay = (orientation: 'PORTRAIT' | 'LANDSCAPE', largeText: boolean): KioskState => ({ ...state, display: { orientation, largeText } });
  return [
    ['세로 보통', withDisplay('PORTRAIT', false)],
    ['세로 큰 글자', withDisplay('PORTRAIT', true)],
    ['가로 보통', withDisplay('LANDSCAPE', false)],
    ['가로 큰 글자', withDisplay('LANDSCAPE', true)],
  ];
}

const SIX = ['보험 청구에 필요한 서류 확인', '계산 근거 보기', '치료 다시 선택', '보험 조건 수정', '처음으로', '이용 완료'];
const standalone = (html: string): RegExpMatchArray | null => textOf(html).match(/(?<![\d,])0원/);

describe('K04_Result 정상 결과 (AC-013a·e·f)', () => {
  it.each(variants(resultStateWith(estimatedResponse())))('%s: 세 금액 카드(이름·금액·보조 설명)와 고정 문구가 기획서 §4 그대로다', (_name, state) => {
    const { html } = renderWithState(state, <K04Result />);
    const text = textOf(html);
    expect(text).toContain('선택한 조건의 예상 금액입니다');
    expect(text).toContain('예시 계산');
    for (const [label, value] of [['예상 병원 결제액', '124,000원'], ['예상 보험금', '114,000원'], ['보험금 수령 후 예상 본인 부담', '10,000원']] as const) {
      expect(text).toContain(label);
      expect(text).toContain(value);
    }
    expect(html.indexOf('예상 병원 결제액')).toBeLessThan(html.indexOf('예상 보험금'));
    expect(html.indexOf('예상 보험금')).toBeLessThan(html.indexOf('보험금 수령 후 예상 본인 부담'));
    expect(text).toContain('보험금을 받은 뒤 남는 예상 부담액이며, 오늘 병원에 결제할 금액이 아닙니다.');
    expect(text).toContain('오늘 병원 창구에서 결제하는 금액입니다.');
    expect(text).toContain('표준 공제·한도 가정으로 계산한 예상 금액입니다. 실제 지급액은 가입 담보와 보험사 심사 결과에 따라 달라집니다. 자세한 계산 과정은 아래 ‘계산 근거 보기’에서 확인하세요.');
    expect(text).toContain('입력하신 세대·보험사 형태와 표준 가정을 기준으로 예상 금액을 안내합니다. 개인별 부담보, 면책·보장기간, 잔여 한도·횟수, 치료 목적 및 심사 결과에 따라 실제 지급액이 달라질 수 있습니다.');
  });

  it.each(variants(resultStateWith(estimatedResponse())))('%s: 동작은 여섯 개이고 순서가 고정이다 (큰 글자·가로형에서도 줄지 않는다)', (_name, state) => {
    expect(buttonLabels(renderWithState(state, <K04Result />).html)).toEqual(SIX);
  });

  it('세로형은 "보험 조건"·"선택한 치료" 표와 급여·비급여 내역을, 가로형은 한 줄 요약을 보인다 (디자인 K04_Result / L_K04_Result)', () => {
    const state = resultStateWith(estimatedResponse());
    const portrait = textOf(renderWithState({ ...state, display: { orientation: 'PORTRAIT', largeText: false } }, <K04Result />).html);
    expect(portrait).toContain('보험 조건 2세대(C1) · 손해보험사');
    expect(portrait).toContain('선택한 치료 TEST_FIXTURE X-ray, TEST_FIXTURE 초음파, TEST_FIXTURE 신장분사치료, TEST_FIXTURE 물리치료 (4개)');
    expect(portrait).toContain('오늘 병원 창구에서 결제하는 금액입니다. 급여 14,000원 + 비급여 110,000원');
    const landscape = textOf(renderWithState({ ...state, display: { orientation: 'LANDSCAPE', largeText: false } }, <K04Result />).html);
    expect(landscape).toContain('2세대(C1) · 손해보험사 · 치료 4개');
    expect(landscape).not.toContain('보험 조건 2세대');
    expect(landscape).not.toContain('급여 14,000원 + 비급여');
  });

  it('대표 제목이 하나이고 초점 복귀 표지를 가진다. 동작은 진짜 <button> 이다', () => {
    const html = renderWithState(resultStateWith(estimatedResponse()), <K04Result />).html;
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html.match(/data-kiosk-primary/g)).toHaveLength(1);
    expect(html.match(/<button\b/g)).toHaveLength(6);
  });

  it('금지 문구·코드가 없고 단독 0원 금액이 없다 (AC-013f)', () => {
    const html = renderWithState(resultStateWith(estimatedResponse()), <K04Result />).html;
    for (const pattern of BANNED) expect(html, String(pattern)).not.toMatch(pattern);
    expect(standalone(html)).toBeNull();
  });

  it('금액 카드는 글자 수를 CSS 변수로 알린다 (긴 금액을 카드 안에 맞추려고)', () => {
    const html = renderWithState(resultStateWith(estimatedResponse()), <K04Result />).html;
    expect(html).toContain('--kiosk-chars:8');
  });
});

describe('테스트 데이터 표시 (AC-010e)', () => {
  it.each(['TEST_FIXTURE', 'DEMO'] as const)('origin %s: 화면 맨 위에 "테스트 데이터" 표시가 있다 (코드 값은 보이지 않는다)', (origin) => {
    const html = renderWithState(resultStateWith(estimatedResponse({ origin })), <K04Result />).html;
    expect(textOf(html)).toContain('테스트 데이터로 계산한 예시입니다. 실제 보험금 안내에 사용할 수 없습니다.');
    expect(html.indexOf('data-kiosk-test-data')).toBeLessThan(html.indexOf('kiosk-result-bar'));
    // 응답의 origin 값(코드)을 화면에 싣지 않는다. 시험 병원 자료의 치료 이름에도 TEST_FIXTURE 가 들어 있어 표시 요소만 본다.
    expect(html).not.toMatch(/origin/i);
    expect(/class="kiosk-test-data__text">([^<]*)</.exec(html)?.[1]).toBe('테스트 데이터로 계산한 예시입니다. 실제 보험금 안내에 사용할 수 없습니다.');
    if (origin === 'DEMO') expect(html).not.toContain('DEMO');
  });

  it('origin OPERATING: 표시가 없다 (세 결과 종류 모두)', () => {
    const operating = [
      [resultStateWith(estimatedResponse({ origin: 'OPERATING' })), <K04Result key="a" />],
      [resultStateWith(notCoveredResponse({ origin: 'OPERATING' })), <K04ResultNotCovered key="b" />],
      [resultStateWith(holdResponse(undefined, { origin: 'OPERATING' })), <K04ResultHold key="c" />],
    ] as const;
    for (const [state, element] of operating) {
      const html = renderWithState(state, element).html;
      expect(html).not.toContain('data-kiosk-test-data');
      expect(textOf(html)).not.toContain('테스트 데이터');
    }
  });

  it('세 결과 종류 모두 운영이 아니면 표시가 있다', () => {
    for (const [state, element] of [[resultStateWith(notCoveredResponse()), <K04ResultNotCovered key="a" />], [resultStateWith(holdResponse()), <K04ResultHold key="b" />]] as const) {
      expect(renderWithState(state, element).html).toContain('data-kiosk-test-data');
    }
  });
});

describe('K04_Result_NotCovered 보장 제외 결과 (AC-013b)', () => {
  const state = resultStateWith(notCoveredResponse({ reason: '이 치료는 약관에서 보장하지 않습니다' }));

  it.each(variants(state))('%s: 124,000 / 74,000 / 50,000 과 제외 항목·사유, 나머지 항목 기준의 가정 문장이 있다', (_name, display) => {
    const html = renderWithState(display, <K04ResultNotCovered />).html;
    const text = textOf(html);
    expect(text).toContain('124,000원');
    expect(text).toContain('74,000원');
    expect(text).toContain('50,000원');
    expect(text).toContain('일부 항목 보장 제외');
    expect(text).toContain('예시 계산');
    expect(html).toContain('aria-label="보장 제외 항목"');
    expect(text).toContain('TEST_FIXTURE 신장분사치료');
    expect(text).toContain('40,000원');
    expect(text).toContain('이 치료는 약관에서 보장하지 않습니다');
    expect(text).toContain('나머지 항목은 보장 대상이고 한도가 남아 있다고 가정합니다.');
    expect(text).not.toContain('모두 보장 대상');
    // 디자인의 자리 표시 문장은 출시 화면에 없다 (plan.md §E #27).
    expect(text).not.toContain('디자인 예시');
  });

  it('동작은 여섯 개이고 서류 확인이 있다 (보장 제외도 계산이 끝난 결과다)', () => {
    expect(buttonLabels(renderWithState(state, <K04ResultNotCovered />).html)).toEqual(SIX);
  });

  it('"보장 제외 항목" 구역은 이름·금액·"보장 제외" 표시·사유 순이고 내부 코드·단독 0원이 없다', () => {
    const html = renderWithState({ ...state, display: { orientation: 'PORTRAIT', largeText: false } }, <K04ResultNotCovered />).html;
    expect(textOf(html)).toContain('TEST_FIXTURE 신장분사치료 40,000원 보장 제외 이 치료는 약관에서 보장하지 않습니다 나머지 항목은 보장 대상이고');
    for (const pattern of BANNED) expect(html, String(pattern)).not.toMatch(pattern);
    expect(standalone(html)).toBeNull();
  });
});

describe('K04_Result_Hold 보류 결과 (AC-013c, DD-07·DD-21)', () => {
  const response = holdResponse([
    [T_XRAY, 'MAPPING_ABSENT'],
    [T_ULTRASOUND, 'PROFILE_VALUE_MISSING'],
    [T_KIDNEY_SPRAY, 'CLASSIFICATION_NEEDS_REVIEW'],
    [T_PHYSIO, 'LINE_ORIGIN_NOT_ACCEPTED'],
  ]);
  const state = resultStateWith(response);

  it.each(variants(state))('%s: 병원 결제액만 숫자이고 나머지 둘은 "확인 필요", 단독 0원이 없다', (_name, display) => {
    const html = renderWithState(display, <K04ResultHold />).html;
    const text = textOf(html);
    expect(text).toContain('124,000원');
    expect(text.match(/확인 필요/g)).toHaveLength(2);
    expect(standalone(html)).toBeNull();
    expect(text).not.toContain('114,000');
    expect(text).not.toContain('987,654');
  });

  it('보류 줄은 환자용 분류 문구로 묶여 보이고 내부 코드·참고 그룹 값이 없다', () => {
    const html = renderWithState(state, <K04ResultHold />).html;
    const text = textOf(html);
    for (const phrase of ['표준 가정 자료가 아직 준비되지 않았습니다', '이 치료의 보장 분류를 검토하고 있습니다', '이 치료의 분류 확인이 필요합니다', '이 치료의 가격 자료 확인이 필요합니다']) expect(text).toContain(phrase);
    for (const pattern of BANNED) expect(html, String(pattern)).not.toMatch(pattern);
    expect(html).not.toContain('referenceGroups');
  });

  it('결과 문구 원칙은 없고 개인 계약 조건 문장만 있다', () => {
    const text = textOf(renderWithState(state, <K04ResultHold />).html);
    expect(text).not.toContain('표준 공제·한도 가정으로 계산한 예상 금액입니다');
    expect(text).not.toContain('입력하신 세대·보험사 형태와 표준 가정을 기준으로');
    expect(text).not.toContain('예시 계산');
    expect(text).toContain('개인별 부담보, 면책·보장기간, 잔여 한도·횟수, 치료 목적 및 심사 결과에 따라 실제 지급액이 달라질 수 있습니다.');
    expect(text).toContain('산출 보류');
  });

  it.each(variants(state))('%s: 동작은 정확히 "치료 다시 선택 / 보험 조건 수정 / 처음으로 / 이용 완료" 넷이다', (_name, display) => {
    expect(buttonLabels(renderWithState(display, <K04ResultHold />).html)).toEqual(['치료 다시 선택', '보험 조건 수정', '처음으로', '이용 완료']);
  });

  it('세 번째 금액의 보조 설명은 보류에서도 같다 (수령 후 부담은 오늘 결제액이 아니다)', () => {
    expect(textOf(renderWithState(state, <K04ResultHold />).html)).toContain('보험금을 받은 뒤 남는 예상 부담액이며, 오늘 병원에 결제할 금액이 아닙니다.');
  });

  it('이름을 모르는 치료의 보류 줄도 분류 문구는 보이고 이름 줄은 없다 (id·코드를 이름 자리에 쓰지 않는다)', () => {
    const html = renderWithState(resultStateWith(holdResponse([['TEST_FIXTURE_ID_NOT_IN_CATALOG', 'MAPPING_ABSENT']])), <K04ResultHold />).html;
    expect(textOf(html)).toContain('이 치료의 보장 분류를 검토하고 있습니다');
    expect(html).not.toContain('kiosk-hold__items');
    expect(html).not.toContain('TEST_FIXTURE_ID_NOT_IN_CATALOG');
  });

  it('모르는 새 코드는 첫 분류로 보이고 원문 코드는 보이지 않는다', () => {
    const html = renderWithState(resultStateWith(holdResponse([[T_XRAY, 'BRAND_NEW_CODE' as never]])), <K04ResultHold />).html;
    expect(html).not.toContain('BRAND_NEW_CODE');
    expect(textOf(html)).toContain('표준 가정 자료가 아직 준비되지 않았습니다');
  });
});

describe('결과 화면의 방어: 응답이 없거나 종류가 맞지 않으면 0원·빈 결과 대신 안내와 "처음으로"만 둔다', () => {
  it('저장된 응답이 없다', () => {
    const state = stateAt('K04_Result');
    const html = renderWithState(state, <K04Result />).html;
    expect(buttonLabels(html)).toEqual(['처음으로']);
    expect(textOf(html)).toContain('결과를 보여 드리지 못했어요');
    expect(standalone(html)).toBeNull();
    expect(html).not.toContain('kiosk-amount');
  });

  it('화면과 응답의 결과 종류가 다르다', () => {
    const html = renderWithState({ ...resultStateWith(holdResponse()), screen: 'K04_Result' }, <K04Result />).html;
    expect(html).toContain('data-result="unavailable"');
    expect(html).not.toContain('kiosk-amount');
  });
});

describe('Calculating 계산 중 (KXX_Loading_Calculating, AC-015l~p)', () => {
  it.each(variants(stateAt('Calculating')))('%s: 상태 안내 + 비활성 "이전"·"계산 중…" + 동작 가능한 "처음으로"', (_name, state) => {
    const html = renderWithState(state, <CalculatingScreen />).html;
    const text = textOf(html);
    expect(html).toContain('role="status"');
    expect(text).toContain('예상 금액을 계산하고 있습니다');
    expect(text).toContain('잠시만 기다려 주세요.');
    expect(text).toContain('계산이 끝나면 결과 화면으로 넘어갑니다.');
    expect(text).toContain('계산 중에는 버튼이 비활성화되어 중복 실행되지 않습니다.');
    expect(buttonLabels(html)).toEqual(['처음으로', '이전', '계산 중…']);
    const disabled = [...html.matchAll(/<button\b[^>]*aria-disabled="true"[^>]*>(.*?)<\/button>/gs)].map((match) => (match[1] ?? '').replace(/<[^>]+>/g, '').trim());
    expect(disabled).toEqual(['이전', '계산 중…']);
    expect(html.match(/data-kiosk-primary/g)).toHaveLength(1);
  });
});

describe('KXX_Error_Network 통신 오류 (AC-013d)', () => {
  it.each(variants(stateAt('KXX_Error_Network')))('%s: "다시 시도"·"이용 종료" 둘과 안내 문장, 코드·금액·링크가 없다', (_name, state) => {
    const html = renderWithState(state, <NetworkErrorScreen />).html;
    const text = textOf(html);
    // 세로는 위아래(다시 시도 → 이용 종료), 가로는 한 줄에 보조 동작이 왼쪽이다. DOM 순서가 눈에 보이는 순서다.
    expect(buttonLabels(html)).toEqual(state.display.orientation === 'LANDSCAPE' ? ['이용 종료', '다시 시도'] : ['다시 시도', '이용 종료']);
    expect(text).toContain('계산하지 못했어요');
    expect(text).toContain('통신 오류');
    expect(text).toContain('통신 오류로 보험 계산 정보를 불러오지 못했습니다.');
    expect(text).toContain('잠시 후 다시 시도해 주세요.');
    expect(text).toContain('계속 안 되면 접수 직원에게 문의해 주세요.');
    for (const pattern of BANNED) expect(html, String(pattern)).not.toMatch(pattern);
    // 금액 표시가 없다: 숫자 뒤의 "원"이 없다. (안내 문장의 "0원이라는 뜻이 아닙니다"는 디자인 문장이고 금액이 아니다.)
    expect(text).not.toMatch(/\d[\d,]*원(?!이라는)/);
    expect(html).not.toContain('kiosk-amount');
  });

  it('"접수 직원에게 문의해 주세요"는 문장이고 버튼·링크가 아니다', () => {
    const html = renderWithState(stateAt('KXX_Error_Network'), <NetworkErrorScreen />).html;
    expect(buttonLabels(html).some((label) => label.includes('접수 직원'))).toBe(false);
    expect(html).not.toMatch(/<a[\s>]|href=/);
  });

  it('갱신이 필요한 동안(진행 중·실패)은 "다시 시도"가 비활성이다 (DD-09 규칙 1)', () => {
    const idle = renderWithState(resultStateWith(estimatedResponse(), { screen: 'KXX_Error_Network' }), <NetworkErrorScreen />).html;
    expect(idle).not.toMatch(/aria-disabled="true"[^>]*>(?:(?!<\/button>).)*다시 시도/s);
    for (const refreshState of ['RUNNING', 'FAILED'] as const) {
      const html = renderWithState(resultStateWith(estimatedResponse(), { screen: 'KXX_Error_Network', refreshState }), <NetworkErrorScreen />).html;
      expect(html, refreshState).toMatch(/aria-disabled="true"[^>]*>(?:(?!<\/button>).)*다시 시도/s);
    }
  });
});
