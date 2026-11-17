import type { Page } from '@playwright/test';

// 시험 자료(TEST_FIXTURE). 스크롤 영역 감사 (S4 E): 보이는 화면 안에서 실제로 스크롤되는 영역(overflow 가 auto/scroll 이고 내용이 넘치는 요소)을 찾아
// "아래에 더 있음" 표시와 키보드 접근(초점·이름)이 갖춰졌는지 읽는다. 표시는 구현 세부(어떤 요소·어떤 클래스)가 아니라 계약으로 찾는다:
//  - 스크롤 영역: 요소의 data-scroll-more="true|false" (아래에 남은 내용이 있는가). 넘치는 모든 영역이 이 속성을 가진다.
//  - 단서: [data-kiosk-scroll-cue] 요소(눈에 보이는 글 "아래에 더 있어요"). 남은 내용이 있을 때만 보이고 끝까지 내리면 사라진다.

export interface ScrollRegion {
  readonly name: string;
  readonly overflowing: boolean;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly scrollTop: number;
  readonly moreAttr: string | null;
  readonly tabIndex: number;
  readonly role: string | null;
  readonly label: string | null;
  /** 맨 위로 올렸을 때 첫 자식의 위 가장자리가 영역의 위 가장자리보다 위로 나가는 거리(px, 0 이하가 정상). 양수이면 위쪽 내용이 잘려 스크롤로도 닿지 못한다. */
  readonly firstChildCutOff: number;
  /** 이 영역의 아래 가장자리 근처(영역 안쪽)에 눈에 보이는 단서가 있는가. */
  readonly cueVisible: boolean;
  /** 이 영역과 연결된 단서 요소가 문서에 있으나 보이지 않는가(숨김 상태 확인용). */
  readonly cueCount: number;
}

export async function scrollRegions(page: Page): Promise<ScrollRegion[]> {
  return page.evaluate(() => {
    const root = document.querySelector('.kiosk-root');
    if (root === null) return [];
    const nameOf = (element: Element): string => `${element.tagName.toLowerCase()}${typeof element.className === 'string' && element.className !== '' ? `.${element.className.split(' ')[0]}` : ''}`;
    const isVisible = (element: Element): boolean => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const cues = Array.from(root.querySelectorAll<HTMLElement>('[data-kiosk-scroll-cue]')).filter((cue) => cue.closest('[inert]') === null);
    const regions: ScrollRegion[] = [];
    for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      if (element.closest('[inert]') !== null || !isVisible(element)) continue;
      const style = getComputedStyle(element);
      if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue;
      const rect = element.getBoundingClientRect();
      element.setAttribute('data-audit-scroller', String(regions.length));
      const nearCues = cues.filter((cue) => {
        const box = cue.getBoundingClientRect();
        const shown = isVisible(cue) && getComputedStyle(cue).opacity !== '0';
        return shown && box.left >= rect.left - 1 && box.right <= rect.right + 1 && box.bottom <= rect.bottom + 1 && box.top >= rect.top - 1;
      });
      regions.push({
        name: nameOf(element),
        overflowing: element.scrollHeight > element.clientHeight + 1,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        scrollTop: Math.round(element.scrollTop),
        moreAttr: element.getAttribute('data-scroll-more'),
        tabIndex: element.tabIndex,
        role: element.getAttribute('role'),
        label: element.getAttribute('aria-label'),
        firstChildCutOff: element.firstElementChild === null || element.scrollTop !== 0 ? 0 : Math.max(0, Math.round(rect.top - element.firstElementChild.getBoundingClientRect().top)),
        cueVisible: nearCues.length > 0,
        cueCount: cues.length,
      });
    }
    return regions;
  });
}

/** 측정이 가라앉을 때까지(연속 두 번 같은 값) 기다린 뒤 읽는다: 글꼴 적용·크기 관찰·스크롤 이벤트는 그리기 한두 번 뒤에 표시에 닿는다. */
export async function settledScrollRegions(page: Page, timeoutMs = 4_000): Promise<ScrollRegion[]> {
  const deadline = Date.now() + timeoutMs;
  let previous = JSON.stringify(await scrollRegions(page));
  for (;;) {
    await page.waitForTimeout(120);
    const current = await scrollRegions(page);
    const text = JSON.stringify(current);
    if (text === previous || Date.now() > deadline) return current;
    previous = text;
  }
}

/** scrollRegions 가 번호를 매긴 영역을 맨 위·맨 아래로 스크롤한다(사용자가 끝까지 내리는 조작과 같다). */
export async function scrollRegionTo(page: Page, index: number, where: 'start' | 'end'): Promise<void> {
  await page.evaluate(
    ({ index: i, where: target }) => {
      const element = document.querySelector<HTMLElement>(`[data-audit-scroller="${String(i)}"]`);
      if (element === null) throw new Error(`스크롤 영역 ${String(i)} 가 없다`);
      element.scrollTop = target === 'end' ? element.scrollHeight : 0;
    },
    { index, where },
  );
}
