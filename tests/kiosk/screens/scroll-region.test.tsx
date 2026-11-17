import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InputScreen } from '../../../src/app/kiosk/components/InputScreen';
import { ScrollRegion } from '../../../src/app/kiosk/components/ScrollRegion';
import { K03Treatments } from '../../../src/app/kiosk/screens/K03Treatments';
import { COPY } from '../../../src/app/kiosk/view/copy';
import { stateAt } from '../../fixtures/kiosk/state.fixture';
import { render, renderWithState } from './render';

// 측정 훅을 시험 대신 값으로 바꾼다: 서버 렌더링에는 측정이 없으므로 "넘치는 영역"의 이름·초점은 이렇게 만들어 본다.
const scrollable = vi.hoisted(() => ({ value: false }));
vi.mock('../../../src/app/kiosk/runtime/use-scroll-region', () => ({
  useScrollRegion: () => ({ ref: { current: null }, view: { scrollable: scrollable.value, more: false, centerX: 0, bottom: 0 }, onScroll: () => undefined }),
}));

beforeEach(() => {
  scrollable.value = false;
});

// 스크롤 본문 (S4 E)의 서버 렌더링 모양. 측정은 브라우저에서만 일어나므로(효과) 서버 렌더링에서는 아무것도 더해지지 않는다:
// 쓸모없는 Tab 정지점·단서·역할이 모든 화면에 생기지 않는다. 실제로 넘칠 때의 표시·초점·이름은 tests/e2e/kiosk/scroll.intercept.spec.ts 가 브라우저에서 잰다.

describe('ScrollRegion (서버 렌더링: 측정 전)', () => {
  it('div 로 자식을 그대로 감싸고 초점 정지점·단서·표지·역할이 없다', () => {
    const html = render(<ScrollRegion className="kiosk-result__body">내용</ScrollRegion>);
    expect(html).toBe('<div class="kiosk-result__body">내용</div>');
  });

  it('as="section" 은 section 으로 그리고 넘겨준 속성을 그대로 둔다', () => {
    const html = render(
      <ScrollRegion as="section" className="kiosk-status" data-has-notice="true">
        안내
      </ScrollRegion>,
    );
    expect(html).toBe('<section class="kiosk-status" data-has-notice="true">안내</section>');
  });

  it('넘겨준 역할과 이름(라디오 묶음 등)은 측정 전에도 그대로다', () => {
    const html = render(
      <ScrollRegion role="group" aria-label="확인할 치료를 선택해 주세요" className="kiosk-input__list">
        카드
      </ScrollRegion>,
    );
    // 속성 순서는 의미가 없다: 역할·이름·클래스가 있고 초점 정지점·표지가 없음을 본다.
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="확인할 치료를 선택해 주세요"');
    expect(html).toContain('class="kiosk-input__list"');
    expect(html).not.toMatch(/tabindex|data-scroll-more|data-kiosk-scroll-cue/);
  });

  it('단서 문구와 영역 이름은 한 곳(COPY.scroll)에 있다', () => {
    expect(COPY.scroll.cue).toBe('아래에 더 있어요');
    expect(COPY.scroll.regionLabel).toBe('화면 내용');
  });
});

// 측정은 브라우저에서만 일어나므로(효과) 서버 렌더링 시험에서는 측정 훅을 대신 넣어 "넘치는 영역"을 만든다. 넘치는 영역의 이름 규칙(label 속성, 한 화면의 이름 겹침 없음)을 본다.
describe('ScrollRegion 이름 (N6: 넘치는 영역)', () => {
  const labelsOf = (html: string): string[] => [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1] ?? '');

  it('label 을 주지 않으면 기본 이름("화면 내용")이다', () => {
    scrollable.value = true;
    const html = render(<ScrollRegion className="x">내용</ScrollRegion>);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="region"');
    expect(labelsOf(html)).toEqual([COPY.scroll.regionLabel]);
  });

  it('label 을 주면 그 이름이 붙고, aria-label 을 직접 주면 그것이 먼저다', () => {
    scrollable.value = true;
    expect(labelsOf(render(<ScrollRegion label="특별한 이름">내용</ScrollRegion>))).toEqual(['특별한 이름']);
    expect(labelsOf(render(<ScrollRegion label="특별한 이름" aria-label="직접 준 이름">내용</ScrollRegion>))).toEqual(['직접 준 이름']);
  });

  it('label 은 화면 요소의 속성으로 새지 않는다', () => {
    scrollable.value = true;
    expect(render(<ScrollRegion label="특별한 이름">내용</ScrollRegion>)).not.toMatch(/\slabel=/);
  });

  it('넘치지 않으면 label 을 줘도 이름·초점·역할을 더하지 않는다', () => {
    scrollable.value = false;
    expect(render(<ScrollRegion label="특별한 이름">내용</ScrollRegion>)).toBe('<div>내용</div>');
  });

  it('입력 화면 뼈대: 본문·선택 목록·부속 세 영역이 모두 넘쳐도 이름이 서로 다르고 COPY 에서 온다', () => {
    scrollable.value = true;
    const html = render(
      <InputScreen step={2} title="제목" kind="type" aside={<p>부속</p>} footer={null}>
        <p>목록</p>
      </InputScreen>,
    );
    // 단계 표시(nav)의 이름은 스크롤 영역이 아니다.
    const labels = labelsOf(html).filter((label) => label !== COPY.stepsLabel);
    expect(labels).toEqual([COPY.scroll.inputBodyLabel, COPY.scroll.inputChoicesLabel, COPY.scroll.inputAsideLabel]);
    expect(new Set(labels).size).toBe(3);
    expect(labels).not.toContain(COPY.scroll.regionLabel);
  });

  it('치료 선택 화면: 본문·선택 목록·치료 묶음·부속이 모두 넘쳐도 이름이 서로 다르다', () => {
    scrollable.value = true;
    const html = renderWithState(stateAt('K03_Treatments'), <K03Treatments />).html;
    const known: readonly string[] = [COPY.scroll.inputBodyLabel, COPY.scroll.inputChoicesLabel, COPY.scroll.inputAsideLabel, COPY.input.treatments.title];
    const labels = labelsOf(html).filter((label) => known.includes(label));
    expect(labels).toEqual([COPY.scroll.inputBodyLabel, COPY.scroll.inputChoicesLabel, COPY.input.treatments.title, COPY.scroll.inputAsideLabel]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('이름 문구는 모두 COPY.scroll 에 있고 서로 다르다', () => {
    const names = [COPY.scroll.regionLabel, COPY.scroll.inputBodyLabel, COPY.scroll.inputChoicesLabel, COPY.scroll.inputAsideLabel];
    expect(names.every((name) => typeof name === 'string' && name.trim() !== '')).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});
