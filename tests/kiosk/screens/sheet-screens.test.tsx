import { describe, expect, it } from 'vitest';
import { K04BasisCalculation } from '../../../src/app/kiosk/screens/BasisScreen';
import { K06Complete } from '../../../src/app/kiosk/screens/CompleteScreen';
import { K07Documents, K07DocumentsUnknown } from '../../../src/app/kiosk/screens/DocumentsScreens';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import type { CauseCode } from '../../../src/app/kiosk/state/api-types';
import { makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { estimatedResponse, holdResponse, notCoveredResponse, resultStateWith, singleCauseDocuments, unknownCauseDocuments } from '../../fixtures/kiosk/estimate.fixture';
import { stateAt } from '../../fixtures/kiosk/state.fixture';
import { buttonLabels, renderWithState, textOf } from './render';

// 계산 근거·필요 서류·이용 완료 화면의 서버 렌더링 시험 (SPEC-REIMBURSEMENT-001 M6 S3b, AC-007g·i, AC-013f, AC-014f, AC-015f, AC-010e).
// 마크업·문구·방향/큰 글자 변형만 본다. 클릭·초점·배치·잘림은 브라우저 시험(tests/e2e)이 본다.

const BANNED = [/tel:/, /<a[\s>]/, /href=/, /1588/, /직원에게 문의하기/, /상담/, /PROFILE_|MAPPING_|LINE_|CLASSIFICATION_|CALC_|RULE_BUNDLE|CLINIC_RULE|GEN\d_|NON_LIFE|MUTUAL_AID/, /requestId|refreshId|sessionId/, /undefined|NaN|null/, /환자분의 실손은/, /오늘 [^<]*만 내면 됩니다/, /디자인 예시|구현 단계에서|표시되는 자리/];

function variants(state: KioskState): Array<[string, KioskState]> {
  const withDisplay = (orientation: 'PORTRAIT' | 'LANDSCAPE', largeText: boolean): KioskState => ({ ...state, display: { orientation, largeText } });
  return [
    ['세로 보통', withDisplay('PORTRAIT', false)],
    ['세로 큰 글자', withDisplay('PORTRAIT', true)],
    ['가로 보통', withDisplay('LANDSCAPE', false)],
    ['가로 큰 글자', withDisplay('LANDSCAPE', true)],
  ];
}

const basisState = (response = estimatedResponse()): KioskState => ({ ...resultStateWith(response), screen: 'K04_Basis_Calculation' });
const docsState = (documents = singleCauseDocuments(), cause: CauseCode = 'INJURY'): KioskState => {
  const base = resultStateWith(estimatedResponse({ documents }));
  return { ...base, inputs: { ...base.inputs, cause }, screen: cause === 'UNKNOWN' ? 'K07_Documents_Unknown' : 'K07_Documents' };
};
const FOOTER = ['처음으로', '결과로 돌아가기', '이용 완료'];

describe('K04_Basis_Calculation 계산 근거 (AC-014f, AC-013f)', () => {
  it.each(variants(basisState()))('%s: 정상 결과의 근거 — 제목·예시 계산·입력 확인·치료 표·공제·한도(가정)·약관 출처·가정·확인하지 않은 전제', (_name, state) => {
    const { html } = renderWithState(state, <K04BasisCalculation />);
    const text = textOf(html);
    expect(text).toContain('계산 근거');
    expect(text).toContain('예시 계산');
    expect(text).toContain('예상 금액을 이렇게 계산했습니다');
    expect(text).toContain('TEST_FIXTURE X-ray');
    expect(text).toContain('예상 병원 결제액 합계');
    expect(text).toContain('124,000원');
    expect(text).toContain('공제(가정)');
    expect(text).toContain('- 10,000원');
    expect(text).toContain('지급한도(가정)');
    expect(text).toContain('250,000원');
    expect(text).toContain('예상 보험금');
    expect(text).toContain('114,000원');
    expect(text).toContain('약관 출처');
    expect(text).toContain('TEST_FIXTURE 약관 문서 A');
    expect(text).toContain('2026.01.01 개정');
    expect(text).toContain('적용한 계산 가정');
    expect(text).toContain('개인별 공제·한도·특약·잔여 한도·면책 기간·부담보는 묻거나 조회하지 않았습니다.');
    for (const pattern of BANNED) expect(html, String(pattern)).not.toMatch(pattern);
  });

  it('보장 제외 결과에서 들어오면 제외 항목과 사유가 함께 보인다 (AC-014f)', () => {
    const html = renderWithState(basisState(notCoveredResponse({ reason: '약관상 보장하지 않는 치료입니다' })), <K04BasisCalculation />).html;
    const text = textOf(html);
    expect(html).toContain('aria-label="보장 제외 항목"');
    expect(html).toContain('data-kiosk-panel="exclusion"');
    expect(text).toContain('약관상 보장하지 않는 치료입니다');
    expect(text).toContain('40,000원');
    expect(text).toContain('나머지 항목은 보장 대상이고 한도가 남아 있다고 가정합니다.');
    expect(text).toContain('74,000원');
  });

  it('정상 결과에서 들어오면 제외 항목 패널이 없다', () => {
    expect(renderWithState(basisState(), <K04BasisCalculation />).html).not.toContain('data-kiosk-panel="exclusion"');
  });

  it('하단 동작은 "처음으로 / 결과로 돌아가기 / 이용 완료"이고 진짜 <button> 이다', () => {
    const html = renderWithState(basisState(), <K04BasisCalculation />).html;
    expect(buttonLabels(html)).toEqual(FOOTER);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html.match(/data-kiosk-primary/g)).toHaveLength(1);
  });

  it('테스트 데이터로 계산한 결과면 맨 위에 표시가 있고, 운영 자료이면 없다 (AC-010e)', () => {
    expect(renderWithState(basisState(), <K04BasisCalculation />).html).toContain('data-kiosk-test-data');
    expect(renderWithState(basisState(estimatedResponse({ origin: 'OPERATING' })), <K04BasisCalculation />).html).not.toContain('data-kiosk-test-data');
  });

  it('보류 결과이거나 저장된 응답이 없으면 근거를 그리지 않고 "처음으로"만 둔다 (0원·빈 표 없음)', () => {
    for (const state of [basisState(holdResponse()), { ...basisState(), derived: { estimate: null, documents: null, basis: null, returnContext: null } }]) {
      const { html } = renderWithState(state, <K04BasisCalculation />);
      expect(buttonLabels(html)).toEqual(['처음으로']);
      expect(textOf(html)).not.toMatch(/\d원/);
      expect(html).toContain('data-sheet="unavailable"');
    }
  });

  it('그룹이 둘이고 공유 한도가 적용되면 묶음 이름·그룹 지급액·적용 후 지급액이 표에 보이고 내부 그룹 이름은 없다', () => {
    const response = estimatedResponse();
    const steps = [
      { groupKey: 'INTERNAL_GROUP_A', E: 50_000, D: 10_000, D_applied: 10_000, L: 100_000, P: 40_000, P_pooled: 30_000, poolKey: 'INTERNAL_POOL' },
      { groupKey: 'INTERNAL_GROUP_B', E: 20_000, D: 5_000, D_applied: 5_000, L: 'UNLIMITED' as const, P: 15_000, P_pooled: 15_000 },
    ];
    const html = renderWithState(basisState({ ...response, result: { ...response.result, basis: { ...response.result.basis, steps } } }), <K04BasisCalculation />).html;
    const text = textOf(html);
    expect(text).toContain('계산 묶음 1');
    expect(text).toContain('계산 묶음 2');
    expect(text).toContain('공유 한도 적용 후 지급액 30,000원');
    expect(text).toContain('한도 없음');
    expect(html.match(/kiosk-table__group/g)).toHaveLength(2);
    expect(html).not.toMatch(/INTERNAL_/);
  });

  it('계산 단계가 응답에 없으면 공제·한도 표가 없다', () => {
    const response = estimatedResponse();
    const bare = { ...response, result: { ...response.result, basis: { ruleBundleId: null, profile: null, steps: [] } } };
    const html = renderWithState(basisState(bare), <K04BasisCalculation />).html;
    expect(html).not.toContain('data-basis-table="steps"');
    expect(html).not.toContain('약관 출처');
    expect(html).toContain('data-basis-table="treatments"');
  });
});

describe('K07_Documents 필요 서류 (AC-007g·i, AC-014c)', () => {
  it.each(variants(docsState()).filter(([, current]) => !current.display.largeText))('%s: 아홉 줄이 모두 있고 필요한 줄만 체크·사유가 있다', (_name, state) => {
    const { html } = renderWithState(state, <K07Documents />);
    const text = textOf(html);
    expect(text).toContain('필요 서류 안내');
    expect(text).toContain('예시 기준');
    expect(text).toContain('청구에 필요한 서류입니다');
    expect(text).toContain('서류 9가지 중 이번 청구에 필요한 항목에 체크했습니다.');
    expect(text).toContain('서류는 병원 원무과에서 발급합니다. 보험사와 상품에 따라 추가 서류를 요구할 수 있습니다.');
    expect(html.match(/data-doc-line=/g)).toHaveLength(9);
    expect(html.match(/data-required="true"/g)).toHaveLength(5);
    expect(html.match(/data-required="false"/g)).toHaveLength(4);
    expect(text).toContain('X-ray · 초음파 검사가 있어 필요합니다.');
    expect(buttonLabels(html)).toEqual(FOOTER);
    for (const pattern of BANNED) expect(html, String(pattern)).not.toMatch(pattern);
  });

  it('필요한 줄은 색뿐 아니라 글로도 구분된다 (화면 낭독기용 "필요"/"이번 청구에는 필요하지 않음")', () => {
    const html = renderWithState(docsState(), <K07Documents />).html;
    expect(html.match(/>필요</g)).toHaveLength(5);
    expect(html.match(/>이번 청구에는 필요하지 않음</g)).toHaveLength(4);
  });

  it('청구 기준과 선택한 치료 요약이 있다 (세로: 표, 가로: 한 줄)', () => {
    const portrait = textOf(renderWithState({ ...docsState(), display: { orientation: 'PORTRAIT', largeText: false } }, <K07Documents />).html);
    expect(portrait).toContain('청구 기준 상해 · 손해보험사 · 통원');
    expect(portrait).toContain('선택한 치료 TEST_FIXTURE X-ray, TEST_FIXTURE 초음파, TEST_FIXTURE 신장분사치료, TEST_FIXTURE 물리치료 (4개)');
    const landscape = textOf(renderWithState({ ...docsState(), display: { orientation: 'LANDSCAPE', largeText: false } }, <K07Documents />).html);
    expect(landscape).toContain('상해 · 손해보험사 · 통원 · 치료 4개');
    expect(landscape).not.toContain('청구 기준');
  });

  it('규칙을 쓸 수 없으면 목록 대신 안내 문구이고 서류 줄·체크가 없다. 동작은 그대로다 (AC-007g)', () => {
    const html = renderWithState(docsState({ state: 'RULES_UNAVAILABLE' } as never), <K07Documents />).html;
    expect(html).not.toContain('data-doc-line');
    expect(html).not.toContain('서류 9가지 중');
    expect(textOf(html)).toContain('필요 서류 목록을 안내하지 못했어요');
    expect(textOf(html)).toContain('접수 직원에게 문의해 주세요.');
    expect(buttonLabels(html)).toEqual(FOOTER);
  });

  it('1544-8069 와 전화·링크가 이 화면에 없다 (문의 번호는 세대 확인 안내에만 문구로 있다)', () => {
    const html = renderWithState(docsState(), <K07Documents />).html;
    expect(html).not.toMatch(/1544|tel:|<a[\s>]|href=/);
  });

  it('원인에 맞지 않는 서류(모름 서류가 단일 원인 화면에 옴)는 목록 없이 안내 문구다', () => {
    const html = renderWithState(docsState(unknownCauseDocuments() as never), <K07Documents />).html;
    expect(html).not.toContain('data-doc-line');
    expect(textOf(html)).toContain('필요 서류 목록을 안내하지 못했어요');
  });

  it('쪽이 하나이면 쪽 넘김이 없다 (일반 글자 아홉 줄)', () => {
    const html = renderWithState({ ...docsState(), display: { orientation: 'PORTRAIT', largeText: false } }, <K07Documents />).html;
    expect(html).not.toContain('kiosk-pager');
  });

  it('큰 글자에서는 쪽으로 나뉘고 "n / m 페이지"와 "이전 목록 / 다음 목록" 이 보이며 처음 쪽은 첫 줄들이다 (AC-007i)', () => {
    const html = renderWithState({ ...docsState(), display: { orientation: 'PORTRAIT', largeText: true } }, <K07Documents />).html;
    expect(html).toContain('kiosk-pager');
    expect(textOf(html)).toMatch(/1 \/ \d+ 페이지/);
    expect(html.match(/data-doc-line=/g)?.length ?? 0).toBeLessThan(9);
    expect(html).toContain('data-doc-line="DIAGNOSIS_CERT"');
    // 쪽 넘김은 목록과 하단 동작 사이에 있다: 화면에 보이는 순서와 키보드 초점 순서가 같다.
    expect(buttonLabels(html)).toEqual(['이전 목록', '다음 목록', ...FOOTER]);
  });
});

describe('K07_Documents_Unknown 원인 모름 (AC-007h·i)', () => {
  it.each(variants(docsState(unknownCauseDocuments(), 'UNKNOWN')))('%s: 공통·상해·질병 묶음 머리글과 분기 안내가 있고 아홉 줄이 한 번씩이다', (_name, state) => {
    const { html } = renderWithState(state, <K07DocumentsUnknown />);
    const text = textOf(html);
    expect(text).toContain('치료 원인을 고르지 않으셔서 상해일 때와 질병일 때를 나눠서 안내합니다.');
    expect(text).toContain('상해 또는 질병 (선택 안 함)');
    const keys = [...html.matchAll(/data-doc-line="([A-Z_]+)"/g)].map((match) => match[1]);
    if (state.display.largeText) {
      expect(new Set(keys).size).toBe(keys.length); // 큰 글자: 쪽으로 나뉘어도 한 쪽 안에서 줄이 겹치지 않는다
    } else {
      expect(keys).toHaveLength(9);
      expect(new Set(keys).size).toBe(9);
      expect(text).toContain('공통으로 필요한 서류');
      expect(text).toContain('치료 원인에 따라 추가되는 서류 (해당하는 쪽만 받으세요)');
      expect(text).toContain('다쳐서 오셨다면 (상해)');
      expect(text).toContain('아파서 오셨다면 (질병)');
      expect(text).toContain('다쳐서 오셨으면 초진기록지, 아파서 오셨으면 진단서를 함께 받으세요.');
    }
    expect(buttonLabels(html).filter((label) => FOOTER.includes(label))).toEqual(FOOTER);
  });

  it('전용 줄이 0+4 이면 상해 쪽 묶음이 비어 보이지 않는다 (머리글이 없다), 둘 다 0 이면 분기 머리글이 없다', () => {
    const illnessOnly = unknownCauseDocuments({ injuryOnly: [], illnessOnly: ['DIAGNOSIS_CERT', 'MEDICAL_OPINION', 'BIOPSY_RESULT', 'IMAGING_READING'].map((line) => ({ line, required: true, reasons: [`${line} 사유`], scope: 'ILLNESS_ONLY' as const })) as never });
    const html = renderWithState({ ...docsState(illnessOnly, 'UNKNOWN'), display: { orientation: 'LANDSCAPE', largeText: false } }, <K07DocumentsUnknown />).html;
    expect(textOf(html)).toContain('아파서 오셨다면 (질병)');
    expect(textOf(html)).not.toContain('다쳐서 오셨다면 (상해)');
    const none = renderWithState({ ...docsState(unknownCauseDocuments({ injuryOnly: [], illnessOnly: [] }), 'UNKNOWN'), display: { orientation: 'PORTRAIT', largeText: false } }, <K07DocumentsUnknown />).html;
    expect(textOf(none)).not.toContain('치료 원인에 따라 추가되는 서류');
  });

  it('공통 줄의 사유가 여럿이면 사유가 모두 보인다 (여러 줄)', () => {
    const base = unknownCauseDocuments();
    if (base.state !== 'AVAILABLE') throw new Error('시험 자료');
    const documents = { ...base, lines: base.lines.map((entry) => (entry.line === 'RECEIPT_AND_ITEMIZED' ? { ...entry, reasons: ['사유 하나입니다.', '사유 둘입니다.'] } : entry)) };
    const text = textOf(renderWithState({ ...docsState(documents, 'UNKNOWN'), display: { orientation: 'PORTRAIT', largeText: false } }, <K07DocumentsUnknown />).html);
    expect(text).toContain('사유 하나입니다.');
    expect(text).toContain('사유 둘입니다.');
  });

  it('규칙을 쓸 수 없으면 안내 문구뿐이다', () => {
    const html = renderWithState(docsState({ state: 'RULES_UNAVAILABLE' } as never, 'UNKNOWN'), <K07DocumentsUnknown />).html;
    expect(html).not.toContain('data-doc-line');
    expect(textOf(html)).toContain('필요 서류 목록을 안내하지 못했어요');
    expect(buttonLabels(html)).toEqual(FOOTER);
  });
});

describe('K06_Complete 이용 완료 (AC-015f)', () => {
  const state = (hold: number | null) => stateAt('K06_Complete', {}, { catalog: makeCatalog({ idlePolicy: { completionHoldSeconds: hold } }) });

  it.each(variants(state(10)))('%s: 감사 문구·지워졌다는 안내·다음 환자 안내와 "처음 화면으로" 버튼 하나', (_name, current) => {
    const { html } = renderWithState(current, <K06Complete />);
    const text = textOf(html);
    expect(text).toContain('이용해 주셔서 감사합니다');
    expect(text).toContain('선택하신 보험 조건과 치료 내용은 모두 지워졌습니다.');
    expect(text).toContain('잠시 후 첫 화면으로 돌아갑니다.');
    expect(text).toContain('다음 환자에게 이전 선택 내용과 금액이 보이지 않습니다.');
    expect(buttonLabels(html)).toEqual(['처음 화면으로']);
    expect(html.match(/data-kiosk-primary/g)).toHaveLength(1);
    expect(text).not.toMatch(/\d[\d,]*원/);
    for (const pattern of BANNED) expect(html, String(pattern)).not.toMatch(pattern);
  });

  it('completionHoldSeconds 가 null 이면 자동 복귀를 약속하지 않는다 (버튼만)', () => {
    const text = textOf(renderWithState(state(null), <K06Complete />).html);
    expect(text).not.toContain('잠시 후');
    expect(text).toContain('‘처음 화면으로’');
  });
});
