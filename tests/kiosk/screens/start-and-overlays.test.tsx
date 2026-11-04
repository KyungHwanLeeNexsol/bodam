import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayHost } from '../../../src/app/kiosk/overlays/OverlayHost';
import { ResetConfirm } from '../../../src/app/kiosk/overlays/ResetConfirm';
import { TimeoutDialog, redrawDelay, secondsLeft } from '../../../src/app/kiosk/overlays/TimeoutDialog';
import { LiveKiosk } from '../../../src/app/kiosk/runtime/LiveKiosk';
import { K00Start } from '../../../src/app/kiosk/screens/K00Start';
import { LoadFailedScreen, LoadingScreen, NoTreatmentsScreen, NotFoundScreen } from '../../../src/app/kiosk/screens/NonReadyScreens';
import { ScreenRouter } from '../../../src/app/kiosk/screens/ScreenRouter';
import { createKioskControllerFromState } from '../../../src/app/kiosk/state/controller';
import type { KioskController } from '../../../src/app/kiosk/state/controller';
import { SCREEN_STATES } from '../../../src/app/kiosk/state/session-store';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { COPY } from '../../../src/app/kiosk/view/copy';
import { makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { estimatedResponse, holdResponse, notCoveredResponse, resultStateWith, singleCauseDocuments, unknownCauseDocuments } from '../../fixtures/kiosk/estimate.fixture';
import { initialState, stateAt } from '../../fixtures/kiosk/state.fixture';
import { buttonLabels, render, renderWithState, textOf } from './render';
import { renderToStaticMarkup } from 'react-dom/server';

// K00_Start·비정상 시작 상태 넷·겹침창 둘·LiveKiosk 루트의 서버 렌더링 시험 (BRIEF D2·D6·D8·D12). 버튼의 사건 연결과 초점은 브라우저 시험(tests/e2e)이 본다.

const FIXTURE_NAME = 'TEST_FIXTURE 시험 의원';
const BANNED = [/PROFILE_/, /MAPPING_/, /LINE_/, /CLINIC_NOT_FOUND/, /INTERNAL_ERROR/, /VERSION_MISMATCH/, /\b404\b/, /\b500\b/, /1588/, /tel:/, /<a[\s>]/, /href=/, /직원에게 문의하기/];

describe('K00Start', () => {
  const portrait = renderWithState(initialState(), <K00Start />);

  it('병원명·서비스명·서비스 설명·안내·흐름·시작 안내를 보여 준다 (이전 금액·선택 없음)', () => {
    const text = textOf(portrait.html);
    expect(text).toContain(FIXTURE_NAME);
    expect(text).toContain('보담');
    expect(text).toContain(COPY.serviceDescription);
    expect(text).toContain(COPY.start.guide);
    expect(text).toContain(COPY.start.hint);
    expect(text).toContain('1 실손보험');
    expect(text).toContain('4 치료 선택');
    expect(text).not.toMatch(/\d[\d,]*원/);
  });

  it('누를 수 있는 것은 "시작하기" 단추 하나뿐이다 ("처음으로"는 지울 데이터가 없어 없다)', () => {
    expect(buttonLabels(portrait.html)).toEqual(['시작하기']);
    expect(portrait.html).not.toContain('처음으로');
  });

  it('세로형은 흐름 칩 사이에 화살표가 있고 짧은 이름이다. 서비스명은 h1 이고 초점 복귀 표지를 가진다', () => {
    expect(portrait.html).toContain('class="kiosk-k00"');
    expect(portrait.html.match(/kiosk-k00__arrow/g)).toHaveLength(3);
    expect(portrait.html).toMatch(/<h1 class="kiosk-k00__wordmark" tabindex="-1" data-kiosk-primary="true">보담<\/h1>/);
    expect(textOf(portrait.html)).not.toContain('실손보험 선택');
  });

  it('가로형은 세로 목록 변형이고 이름이 L_K00_Start 프레임 그대로다 (앞의 셋은 "선택"이 붙고 넷째는 "치료 선택")', () => {
    const html = renderWithState(initialState({ orientation: 'LANDSCAPE' }), <K00Start />).html;
    expect(html).toContain('kiosk-k00 kiosk-k00--stack');
    expect(html).not.toContain('kiosk-k00__arrow');
    expect(textOf(html)).toContain('1 실손보험 선택 2 보험사 형태 선택 3 치료 원인 선택 4 치료 선택');
  });

  it('큰 글자 보기는 세로형에서도 같은 목록 변형이다 (기능을 빼지 않고 배치만 바꾼다)', () => {
    const html = renderWithState(initialState({}), <K00Start />, 0).html;
    const large = renderWithState({ ...initialState(), display: { largeText: true, orientation: 'PORTRAIT' } }, <K00Start />).html;
    expect(html).not.toContain('kiosk-k00--stack');
    expect(large).toContain('kiosk-k00--stack');
    expect(buttonLabels(large)).toEqual(['시작하기']);
  });

  it('병원명은 응답 값이다 (다른 병원이면 다른 이름)', () => {
    const state = initialState({ catalog: makeCatalog({ clinic: { slug: 'x', displayName: '다른 의원', setting: 'OUTPATIENT_ONLY' }, serviceDisplayName: '보담이' }) });
    const text = textOf(renderWithState(state, <K00Start />).html);
    expect(text).toContain('다른 의원');
    expect(text).toContain('보담이');
    expect(text).not.toContain(FIXTURE_NAME);
  });

  it('금지 요소가 없다 (링크·전화·내부 코드)', () => {
    for (const pattern of BANNED) expect(portrait.html, String(pattern)).not.toMatch(pattern);
  });
});

describe('시작 단계의 비정상 상태', () => {
  const catalog = makeCatalog();
  const cases = [
    ['LOADING', <LoadingScreen key="a" orientation="PORTRAIT" />, COPY.bootstrap.loading.title, []],
    ['NOT_FOUND', <NotFoundScreen key="b" orientation="PORTRAIT" />, COPY.bootstrap.notFound.title, []],
    ['LOAD_FAILED', <LoadFailedScreen key="c" orientation="PORTRAIT" onRetry={() => undefined} />, COPY.bootstrap.loadFailed.title, ['다시 시도']],
    ['NO_TREATMENTS', <NoTreatmentsScreen key="d" orientation="PORTRAIT" catalog={catalog} />, COPY.bootstrap.noTreatments.title, []],
  ] as const;

  it.each(cases)('%s: 제목이 있고 누를 수 있는 것은 %j 뿐이다. 시작할 길이 없다', (_name, element, title, labels) => {
    const html = render(element);
    expect(textOf(html)).toContain(title);
    expect(buttonLabels(html)).toEqual(labels);
    expect(html).not.toContain('시작하기');
    expect(html).toContain('data-kiosk-primary');
  });

  it.each(cases)('%s: 환자 문구에 코드·상태 번호·링크·금액이 없다', (_name, element) => {
    const html = render(element);
    for (const pattern of BANNED) expect(html, String(pattern)).not.toMatch(pattern);
    expect(textOf(html)).not.toMatch(/\d[\d,]*원/);
  });

  it('LOAD_FAILED 는 통신 오류 막대와 "접수 직원에게 문의해 주세요" 문장이 있고, 이 문장은 버튼이 아니다', () => {
    const html = render(<LoadFailedScreen orientation="PORTRAIT" onRetry={() => undefined} />);
    expect(textOf(html)).toContain('통신 오류');
    expect(textOf(html)).toContain('계속 안 되면 접수 직원에게 문의해 주세요.');
    expect(buttonLabels(html).join()).not.toContain('문의');
  });

  it('NOT_FOUND·NO_TREATMENTS 도 "접수 직원에게 문의해 주세요"는 문장뿐이다', () => {
    for (const html of [render(<NotFoundScreen orientation="PORTRAIT" />), render(<NoTreatmentsScreen orientation="PORTRAIT" catalog={catalog} />)]) {
      expect(textOf(html)).toContain('접수 직원에게 문의해 주세요.');
      expect(buttonLabels(html)).toEqual([]);
    }
  });

  it('LOADING 은 상태(role="status")로 알리고, 상단에는 병원명도 큰 글자 토글도 없다 (컨트롤러가 없다)', () => {
    const html = render(<LoadingScreen orientation="PORTRAIT" />);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('kiosk-hospital');
    expect(html).not.toContain('aria-pressed');
    expect(html).toContain('data-orientation="portrait" data-large-text="false"');
  });

  it('NO_TREATMENTS 는 병원명을 보여 준다(응답은 받았다). 가로형 루트 표지도 따른다', () => {
    const html = render(<NoTreatmentsScreen orientation="LANDSCAPE" catalog={catalog} />);
    expect(textOf(html)).toContain(FIXTURE_NAME);
    expect(html).toContain('data-orientation="landscape"');
  });
});

describe('ResetConfirm (ConfirmDialog)', () => {
  const state: KioskState = stateAt('K03_Treatments', { overlay: { kind: 'RESET_CONFIRM' } });
  const { html } = renderWithState(state, <ResetConfirm />);

  it('제목·본문·두 버튼의 문구가 디자인·기획서 그대로다', () => {
    expect(textOf(html)).toContain('선택 내용을 지우고 처음으로 돌아갈까요?');
    expect(textOf(html)).toContain('지금까지 선택한 보험 조건과 치료가 모두 지워집니다.');
    expect(buttonLabels(html)).toEqual(['계속 이용', '처음으로']);
  });

  it('모달 의미: role=dialog, aria-modal, 제목·본문으로 이름을 붙인다. 처음 초점은 안전한 "계속 이용"이다', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="kiosk-reset-title"');
    expect(html).toContain('aria-describedby="kiosk-reset-body"');
    expect(html).toMatch(/data-kiosk-initial-focus="true"[^>]*><span class="kiosk-button__label">계속 이용</);
  });
});

describe('TimeoutDialog', () => {
  const NOW = 50_000;
  const state: KioskState = stateAt('K03_Treatments', { overlay: { kind: 'TIMEOUT_DIALOG', openedAt: NOW, resetAt: NOW + 20_000 } });

  it('남은 시간과 두 버튼을 보여 준다. 디자인 문구에서 병원 정책과 달라질 수 있는 수치 문장은 싣지 않는다', () => {
    const { html } = renderWithState(state, <TimeoutDialog />, NOW);
    const text = textOf(html);
    expect(text).toContain('남은 시간 20 초');
    expect(text).toContain('계속 사용하시겠어요?');
    expect(text).toContain('20초 후 처음 화면으로 돌아갑니다. 지금까지 선택한 내용은 모두 지워집니다.');
    expect(text).toContain('연장 횟수 제한은 없습니다.');
    expect(text).not.toContain('100초');
    expect(text).not.toContain('160초');
    expect(buttonLabels(html)).toEqual(['처음으로', '계속 사용할게요']);
  });

  it('모달 의미와 처음 초점("계속 사용할게요")', () => {
    const { html } = renderWithState(state, <TimeoutDialog />, NOW);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="kiosk-timeout-title"');
    expect(html).toMatch(/data-kiosk-initial-focus="true"[^>]*><span class="kiosk-button__label">계속 사용할게요</);
  });

  it('남은 시간은 지금 시각에서 읽는다 (올림, 0 아래로 내려가지 않는다)', () => {
    expect(textOf(renderWithState(state, <TimeoutDialog />, NOW + 1_000).html)).toContain('남은 시간 19 초');
    expect(textOf(renderWithState(state, <TimeoutDialog />, NOW + 1_001).html)).toContain('남은 시간 19 초');
    expect(textOf(renderWithState(state, <TimeoutDialog />, NOW + 19_500).html)).toContain('남은 시간 1 초');
    expect(textOf(renderWithState(state, <TimeoutDialog />, NOW + 20_000).html)).toContain('남은 시간 0 초');
    expect(textOf(renderWithState(state, <TimeoutDialog />, NOW + 99_000).html)).toContain('남은 시간 0 초');
  });

  it('표시 값 계산: 올림이고, 다음 다시 그리기는 값이 한 칸 내려가는 순간 + 1ms 다', () => {
    expect(secondsLeft(20_000)).toBe(20);
    expect(secondsLeft(19_001)).toBe(20);
    expect(secondsLeft(19_000)).toBe(19);
    expect(secondsLeft(1)).toBe(1);
    expect(secondsLeft(0)).toBe(0);
    expect(redrawDelay(20_000)).toBe(1_001);
    expect(redrawDelay(19_500)).toBe(501);
    expect(redrawDelay(1)).toBe(2);
  });
});

describe('OverlayHost · LiveKiosk 루트', () => {
  let controllers: KioskController[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    for (const controller of controllers) controller.dispose();
    controllers = [];
    vi.useRealTimers();
  });
  const live = (state: KioskState): string => {
    const controller = createKioskControllerFromState({}, state);
    controllers.push(controller);
    return renderToStaticMarkup(<LiveKiosk controller={controller} />);
  };

  it('겹침창이 없으면 밑 화면은 inert 가 아니고 대화상자가 없다. 방향·큰 글자는 상태에서 온다', () => {
    const html = live(initialState());
    expect(html).not.toContain('inert');
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('data-orientation="portrait" data-large-text="false"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('방향·큰 글자는 상태(selectLayout)가 유일한 출처다', () => {
    const html = live({ ...initialState(), display: { largeText: true, orientation: 'LANDSCAPE' } });
    expect(html).toContain('data-orientation="landscape" data-large-text="true"');
    expect(html).toContain('aria-pressed="true"');
  });

  it.each([
    ['RESET_CONFIRM', { kind: 'RESET_CONFIRM' } as const, '선택 내용을 지우고 처음으로 돌아갈까요?'],
    ['TIMEOUT_DIALOG', { kind: 'TIMEOUT_DIALOG', openedAt: performance.now(), resetAt: performance.now() + 20_000 } as const, '계속 사용하시겠어요?'],
  ])('%s: 대화상자는 하나뿐이고, 밑 화면은 inert·aria-hidden 이며 대화상자는 그 형제다', (_name, overlay, title) => {
    const html = live(stateAt('K01_Generation', { overlay }));
    expect(html.match(/role="dialog"/g)).toHaveLength(1);
    expect(html).toContain(title);
    expect(html).toMatch(/<div class="kiosk-underlay" inert="" aria-hidden="true">/);
    const underlayEnd = html.indexOf('</main></div>');
    expect(html.indexOf('role="dialog"')).toBeGreaterThan(underlayEnd);
  });

  it('OverlayHost 는 겹침창이 없으면 아무것도 그리지 않는다', () => {
    expect(renderWithState(initialState(), <OverlayHost />).html).toBe('');
  });

  it('계산 시도·갱신 시도 식별자는 DOM 에 나오지 않는다 (속성·글 어디에도)', () => {
    const state = stateAt('Calculating', {
      activeRequest: { requestId: 'RID-MARKER-0001', sessionId: 'SID-MARKER-0001', inputRevision: 4 },
      activeRefresh: { refreshId: 'RFR-MARKER-0001', sessionId: 'SID-MARKER-0001', inputRevision: 4, reason: 'RETRY' },
      sessionId: 'SID-MARKER-0001',
    });
    const html = live(state);
    expect(html).not.toMatch(/RID-MARKER|RFR-MARKER|SID-MARKER/);
    expect(html).not.toMatch(/requestId|refreshId|sessionId/);
  });
});

describe('ScreenRouter', () => {
  // 화면 상태 열다섯 가지가 모두 자기 화면이다 (S3b 로 임시 화면이 사라졌다). 표지는 각 화면 뼈대의 기능 표지다.
  const REAL_SCREENS: Record<string, string> = {
    K00_Start: 'kiosk-k00',
    K01_Generation: 'data-input="generation"',
    K01_Generation_Unknown: 'kiosk-help-screen',
    K02_Type: 'data-input="type"',
    K02b_Cause: 'data-input="type"',
    K03_Treatments: 'data-input="treatments"',
    Calculating: 'data-kiosk-state="CALCULATING"',
    K04_Result: 'data-result="normal"',
    K04_Result_NotCovered: 'data-result="not-covered"',
    K04_Result_Hold: 'data-result="hold"',
    KXX_Error_Network: 'data-kiosk-state="NETWORK_ERROR"',
    K04_Basis_Calculation: 'data-sheet="basis"',
    K07_Documents: 'data-sheet="documents"',
    K07_Documents_Unknown: 'data-sheet="documents-unknown"',
    K06_Complete: 'data-kiosk-state="COMPLETE"',
  };
  const RESPONSE_OF: Record<string, () => ReturnType<typeof estimatedResponse>> = { K04_Result: estimatedResponse, K04_Result_NotCovered: notCoveredResponse, K04_Result_Hold: holdResponse };

  /** 결과를 가진 상태에서 근거·서류 화면. 원인 모름 서류 화면은 원인 모름 서류와 원인 모름 입력을 가진다. */
  function sheetState(screen: 'K04_Basis_Calculation' | 'K07_Documents' | 'K07_Documents_Unknown'): KioskState {
    if (screen === 'K07_Documents_Unknown') {
      const base = resultStateWith(estimatedResponse({ documents: unknownCauseDocuments() }));
      return { ...base, screen, inputs: { ...base.inputs, cause: 'UNKNOWN' } };
    }
    return resultStateWith(estimatedResponse({ documents: singleCauseDocuments() }), {}, {}, screen);
  }

  it('화면 상태 열다섯 가지를 모두 자기 화면으로 그린다 (임시 화면이 없다)', () => {
    expect(SCREEN_STATES).toHaveLength(15);
    for (const screen of SCREEN_STATES) {
      const response = RESPONSE_OF[screen];
      const state =
        screen === 'K04_Basis_Calculation' || screen === 'K07_Documents' || screen === 'K07_Documents_Unknown' ? sheetState(screen) : response === undefined ? stateAt(screen) : resultStateWith(response());
      const html = renderWithState(state, <ScreenRouter />).html;
      expect(html, screen).toContain(REAL_SCREENS[screen] as string);
      expect(html, screen).not.toMatch(/placeholder|임시 화면/i);
    }
  });

  it('근거·서류 화면의 하단 동작은 "처음으로 / 결과로 돌아가기 / 이용 완료"이고, 이용 완료 화면은 "처음 화면으로" 하나다', () => {
    for (const screen of ['K04_Basis_Calculation', 'K07_Documents', 'K07_Documents_Unknown'] as const) {
      expect(buttonLabels(renderWithState(sheetState(screen), <ScreenRouter />).html), screen).toEqual(['처음으로', '결과로 돌아가기', '이용 완료']);
    }
    expect(buttonLabels(renderWithState(stateAt('K06_Complete'), <ScreenRouter />).html)).toEqual(['처음 화면으로']);
  });

  it('입력 단계 화면은 모두 대표 제목(초점 복귀 표지)을 하나 가진다', () => {
    for (const screen of ['K01_Generation', 'K01_Generation_Unknown', 'K02_Type', 'K02b_Cause', 'K03_Treatments'] as const) {
      expect(renderWithState(stateAt(screen), <ScreenRouter />).html.match(/data-kiosk-primary/g), screen).toHaveLength(1);
    }
  });
});
