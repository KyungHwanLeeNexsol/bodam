import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockClinicApi } from './api';
import type { ApiMock, MockOptions } from './api';
import { KIOSK_PATH, expectK01, expectStartScreen, generationRadio, startButton } from './kiosk';

// 시험 자료(TEST_FIXTURE). 입력 단계(K01~K03) 브라우저 시험의 공통 도구: 단계 이동, 위치 찾기, 큰 글자 전환, 레이아웃 감사.
// 화면 이름은 환자에게 보이지 않으므로 제목(역할 heading)·카드 이름·버튼 이름으로 찾는다.

export const TITLES = {
  generation: '내 실손보험을 선택해 주세요',
  generationHelp: '보험 세대가 특정되지 않으면 정확한 안내가 어렵습니다',
  type: '실손보험이 가입된 보험사의 형태를 선택해 주세요',
  cause: '어떤 일로 병원에 오셨나요?',
  treatments: '확인할 치료를 선택해 주세요',
} as const;

export const TREATMENT = {
  xray: 'TEST_FIXTURE X-ray',
  ultrasound: 'TEST_FIXTURE 초음파',
  kidney: 'TEST_FIXTURE 신장분사치료',
  physio: 'TEST_FIXTURE 물리치료',
  fifth: 'TEST_FIXTURE 주사',
  sixth: 'TEST_FIXTURE 붕대',
} as const;

export const heading = (page: Page, title: string): Locator => page.getByRole('heading', { name: title });

/** 화면 맨 아래의 동작 막대 안 버튼(이전·다음·처음으로·예상 부담액 확인). */
export const bottomButton = (page: Page, name: string): Locator => page.locator('.kiosk-bottom-actions').getByRole('button', { name, exact: true });

export const treatmentBox = (page: Page, name: string): Locator => page.getByRole('checkbox', { name });
export const largeTextToggle = (page: Page): Locator => page.getByRole('button', { name: '큰 글자 보기' });
export const pagerNext = (page: Page): Locator => page.getByRole('button', { name: /다음 목록/ });
export const pagerPrevious = (page: Page): Locator => page.getByRole('button', { name: /이전 목록/ });
export const pagerStatus = (page: Page): Locator => page.locator('.kiosk-pager__status');
export const refreshNotice = (page: Page, kind: 'running' | 'failed' | 'removed'): Locator => page.locator(`[data-kiosk-refresh="${kind}"]`);

/** 선택 요약(세로 막대 또는 가로 패널·합계 줄)의 글. 방향에 관계없이 화면의 요약 영역 전체를 읽는다. */
export async function summaryText(page: Page): Promise<string> {
  return (await page.locator('.kiosk-summary').allInnerTexts()).join(' ').replace(/\s+/g, ' ').trim();
}

export async function openKiosk(page: Page, mock?: MockOptions): Promise<ApiMock> {
  const api = await mockClinicApi(page, mock);
  await page.goto(KIOSK_PATH);
  await expectStartScreen(page);
  return api;
}

export async function toK01(page: Page): Promise<void> {
  await startButton(page).click();
  await expectK01(page);
}

export async function toK02(page: Page, generation = '2세대(C1)'): Promise<void> {
  await toK01(page);
  await generationRadio(page, generation).check();
  await bottomButton(page, '다음').click();
  await expect(heading(page, TITLES.type)).toBeVisible();
}

export async function toK02b(page: Page, type = '손해보험사'): Promise<void> {
  await toK02(page);
  await page.getByRole('radio', { name: type }).check();
  await bottomButton(page, '다음').click();
  await expect(heading(page, TITLES.cause)).toBeVisible();
}

export async function toK03(page: Page, cause = '다쳐서 왔어요 (상해)'): Promise<void> {
  await toK02b(page);
  await page.getByRole('radio', { name: cause }).check();
  await bottomButton(page, '다음').click();
  await expect(heading(page, TITLES.treatments)).toBeVisible();
}

export async function setLargeText(page: Page, on: boolean): Promise<void> {
  const toggle = largeTextToggle(page);
  const pressed = (await toggle.getAttribute('aria-pressed')) === 'true';
  if (pressed !== on) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', on ? 'true' : 'false');
  await expect(page.locator('.kiosk-root')).toHaveAttribute('data-large-text', on ? 'true' : 'false');
}

export async function swapOrientation(page: Page): Promise<'portrait' | 'landscape'> {
  const size = page.viewportSize();
  if (size === null) throw new Error('뷰포트 크기를 알 수 없다');
  await page.setViewportSize({ width: size.height, height: size.width });
  const next = size.width > size.height ? 'portrait' : 'landscape';
  await expect(page.locator('.kiosk-root')).toHaveAttribute('data-orientation', next);
  return next;
}

/** 선택 카드의 선택 상태(라디오 checked) 목록. */
export async function checkedRadios(page: Page): Promise<boolean[]> {
  return page.getByRole('radio').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).checked));
}

/** 치료 카드의 선택 상태(체크박스 checked) 목록: 화면에 보이는 쪽의 카드 순서대로. */
export async function checkedBoxes(page: Page): Promise<boolean[]> {
  return page.getByRole('checkbox').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).checked));
}

/** 요청 본문(POST estimate)의 치료 id 목록. */
export function estimateTreatmentIds(api: ApiMock): string[][] {
  return api.callsTo('estimate').map((call) => {
    const body = JSON.parse(call.postData ?? '{}') as { treatmentIds?: string[]; treatments?: Array<{ treatmentId: string }> };
    return body.treatmentIds ?? body.treatments?.map((entry) => entry.treatmentId) ?? [];
  });
}

export interface LayoutProblem {
  readonly kind: string;
  readonly detail: string;
}

/**
 * 레이아웃 감사 (AC-017a·b·f): 지금 보이는 화면이 잘리거나 겹치거나 화면 밖으로 나가지 않고 조작할 수 있는지를 브라우저에서 잰다.
 *  - 문서가 가로로 넘치지 않고, 화면 높이 안에 들어간다(스크롤은 본문 안에서만).
 *  - 눈에 보이는 버튼·카드(input) 마다: 가로 폭과 높이 모두 72 CSS px 이상(터치 영역), 스크롤해서 보면 뷰포트 안에 있고 다른 요소에 가려지지 않는다.
 *  - 버튼끼리 겹치지 않는다. 동작 막대는 본문 아래에 있고 본문과 겹치지 않는다.
 *  - 잘림: overflow 가 hidden/clip 인 요소가 내용보다 작지 않다(스크롤 가능한 요소는 제외).
 * 환자가 화면에서 보는 것을 검사하므로 겹침창 밑(inert) 화면은 대상이 아니다.
 */
export async function auditLayout(page: Page): Promise<LayoutProblem[]> {
  return page.evaluate(() => {
    const problems: Array<{ kind: string; detail: string }> = [];
    const add = (kind: string, detail: string): void => {
      problems.push({ kind, detail });
    };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const root = document.querySelector('.kiosk-root');
    if (root === null) return [{ kind: 'root', detail: '.kiosk-root 가 없다' }];

    const name = (element: Element): string => {
      const text = (element.getAttribute('aria-label') ?? element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 28);
      return `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? `.${element.className.split(' ')[0]}` : ''}「${text}」`;
    };
    const visible = (element: Element): boolean => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    if (document.documentElement.scrollWidth > vw + 1) add('page-overflow-x', `scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
    if (document.documentElement.scrollHeight > vh + 1) add('page-overflow-y', `scrollHeight ${document.documentElement.scrollHeight} > ${vh}`);

    // 잘림: 스크롤할 수 없는데 내용이 넘치는 요소.
    for (const element of Array.from(root.querySelectorAll('*'))) {
      if (!visible(element)) continue;
      const style = getComputedStyle(element);
      const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip';
      const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
      if (clipsX && element.scrollWidth > element.clientWidth + 1) add('clipped-x', `${name(element)} ${element.scrollWidth} > ${element.clientWidth}`);
      if (clipsY && element.scrollHeight > element.clientHeight + 1) add('clipped-y', `${name(element)} ${element.scrollHeight} > ${element.clientHeight}`);
    }

    const controls = Array.from(root.querySelectorAll<HTMLElement>('button, input, a, [role="button"]')).filter((element) => visible(element) && element.closest('[inert]') === null);
    const rects = new Map<Element, DOMRect>();
    for (const control of controls) {
      control.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const rect = control.getBoundingClientRect();
      rects.set(control, rect);
      if (rect.width < 72 || rect.height < 72) add('touch-target', `${name(control)} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      if (rect.left < -1 || rect.right > vw + 1 || rect.top < -1 || rect.bottom > vh + 1) add('off-screen', `${name(control)} (${Math.round(rect.left)},${Math.round(rect.top)})-(${Math.round(rect.right)},${Math.round(rect.bottom)}) in ${vw}x${vh}`);
      const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), vw - 1);
      const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), vh - 1);
      const hit = document.elementFromPoint(cx, cy);
      const sameCard = hit !== null && control.closest('label') !== null && hit.closest('label') === control.closest('label');
      if (hit === null || !(hit === control || control.contains(hit) || hit.contains(control) || sameCard)) add('covered', `${name(control)} 가 ${hit === null ? '없는 것' : name(hit)} 에 가려졌다`);
    }

    // 겹침: 스크롤 위치를 처음으로 돌려 놓고, 조상의 잘림 영역으로 자른 눈에 보이는 넓이로 서로 포함하지 않는 두 조작 요소의 겹침을 잰다(스크롤로 가려진 부분은 겹침이 아니다).
    for (const element of Array.from(root.querySelectorAll('*'))) {
      if (element.scrollTop !== 0) element.scrollTop = 0;
    }
    const clippedRect = (element: Element): { left: number; top: number; right: number; bottom: number } => {
      const own = element.getBoundingClientRect();
      let box = { left: own.left, top: own.top, right: own.right, bottom: own.bottom };
      for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const clip = parent.getBoundingClientRect();
        box = { left: Math.max(box.left, clip.left), top: Math.max(box.top, clip.top), right: Math.min(box.right, clip.right), bottom: Math.min(box.bottom, clip.bottom) };
      }
      return box;
    };
    for (let i = 0; i < controls.length; i += 1) {
      for (let j = i + 1; j < controls.length; j += 1) {
        const a = controls[i] as HTMLElement;
        const b = controls[j] as HTMLElement;
        if (a.contains(b) || b.contains(a)) continue;
        if (a.closest('label') !== null && a.closest('label') === b.closest('label')) continue;
        const ra = clippedRect(a);
        const rb = clippedRect(b);
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 2 && h > 2) add('overlap', `${name(a)} 와 ${name(b)} 가 ${Math.round(w)}x${Math.round(h)} 겹친다`);
      }
    }

    // 본문과 동작 막대: 본문의 눈에 보이는 아래 끝이 동작 막대 위에 있다 (입력 단계는 .kiosk-input__body + .kiosk-bottom-actions, 결과 화면은 .kiosk-result__body + .kiosk-result-actions).
    // 근거·서류 화면(S3b)은 본문 → (쪽 넘김 막대) → 하단 동작 순이라 본문은 둘 모두의 위에 있어야 한다.
    for (const [bodySelector, footerSelector] of [['.kiosk-input__body', '.kiosk-bottom-actions'], ['.kiosk-result__body', '.kiosk-result-actions'], ['.kiosk-sheet__body', '.kiosk-sheet__pager'], ['.kiosk-sheet__body', '.kiosk-bottom-actions']] as const) {
      const body = root.querySelector(bodySelector);
      const footer = root.querySelector(footerSelector);
      if (body === null || footer === null || !visible(body) || !visible(footer)) continue;
      const bodyRect = body.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      if (bodyRect.bottom > footerRect.top + 1) add('body-under-footer', `본문 아래 끝 ${Math.round(bodyRect.bottom)} > 동작 막대 위 ${Math.round(footerRect.top)}`);
      if (footerRect.bottom > vh + 1) add('footer-off-screen', `동작 막대 아래 끝 ${Math.round(footerRect.bottom)} > ${vh}`);
    }

    // 금액·안내·패널·버튼의 안쪽 넘침: 글자가 자기 상자 밖으로 삐져나가면(잘림은 아니지만 이웃과 겹치거나 화면 밖으로 나간다) 찾는다.
    // 글자 한 줄(white-space: nowrap)인 금액 값은 scrollWidth 가 상자보다 크면 넘친 것이다. 스크롤 가능한 영역(본문)은 대상이 아니다.
    for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-kiosk-block], .kiosk-amount__value, .kiosk-amount__label, .kiosk-amount__note, .kiosk-button'))) {
      if (!visible(element) || element.closest('[inert]') !== null) continue;
      if (element.scrollWidth > element.clientWidth + 1) add('content-overflow-x', `${name(element)} ${element.scrollWidth} > ${element.clientWidth}`);
      // 금액 값(한 줄 큰 글자)은 대체 글꼴(Noto Sans KR 등)의 글꼴 상자(ascent+descent)가 줄 높이(line-height 1.2)보다 커서 줄 상자 밖으로 글꼴 상자만 조금 삐져나온다(예: 104px 금액에서 12px).
      // 글자 잉크가 아니라 보이지 않는 글꼴 상자의 넘침이라 글자 크기의 15% 까지는 허용하고, 그 위는 넘침으로 센다. 단추는 허용 없이 엄격하다.
      const tolerance = element.matches('.kiosk-amount__value') ? 0.15 * Number.parseFloat(getComputedStyle(element).fontSize) : 1;
      if (element.scrollHeight > element.clientHeight + tolerance && getComputedStyle(element).overflowY === 'visible' && element.matches('.kiosk-button, .kiosk-amount__value')) add('content-overflow-y', `${name(element)} ${element.scrollHeight} > ${element.clientHeight}`);
    }

    // 큰 블록끼리 겹침: 금액 카드·안내·패널·보험 조건 표(data-kiosk-block)는 서로 포개지지 않는다(눈에 보이는 부분의 겹침만 센다).
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-kiosk-block]')).filter((element) => visible(element) && element.closest('[inert]') === null);
    for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        const a = blocks[i] as HTMLElement;
        const b = blocks[j] as HTMLElement;
        if (a.contains(b) || b.contains(a)) continue;
        const ra = clippedRect(a);
        const rb = clippedRect(b);
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 2 && h > 2) add('block-overlap', `${name(a)} 와 ${name(b)} 가 ${Math.round(w)}x${Math.round(h)} 겹친다`);
      }
    }
    return problems;
  });
}

export async function expectLayoutClean(page: Page, label: string): Promise<void> {
  const problems = await auditLayout(page);
  expect(problems, `${label}: 레이아웃 문제`).toEqual([]);
}

const ORDER = [TREATMENT.xray, TREATMENT.ultrasound, TREATMENT.kidney, TREATMENT.physio, TREATMENT.fifth, TREATMENT.sixth] as string[];

/** 쪽 번호("n / m 페이지")의 n. */
export async function currentPage(page: Page): Promise<number> {
  const text = (await pagerStatus(page).innerText()).trim();
  return Number(/^(\d+) \//.exec(text)?.[1] ?? Number.NaN);
}

/** 치료 목록을 그 쪽으로 넘긴다(큰 글자 보기에서는 한 쪽에 두 장, 일반은 네 장이다). 쪽 넘김 버튼만 쓴다. */
export async function goToTreatmentPage(page: Page, target: number): Promise<void> {
  for (let guard = 0; guard < 8; guard += 1) {
    const now = await currentPage(page);
    if (now === target) return;
    await (now < target ? pagerNext(page) : pagerPrevious(page)).click();
    await expect(pagerStatus(page)).not.toContainText(`${now} /`);
  }
  throw new Error(`치료 목록을 ${target}쪽으로 넘기지 못했다`);
}

/** 이름으로 치료 카드를 고른다: 그 카드가 있는 쪽으로 먼저 넘긴다(시험 병원 자료의 순서를 안다). */
export async function selectTreatment(page: Page, name: string, on = true): Promise<void> {
  const large = (await page.locator('.kiosk-root').getAttribute('data-large-text')) === 'true';
  await goToTreatmentPage(page, Math.floor(ORDER.indexOf(name) / (large ? 2 : 4)) + 1);
  if (on) await treatmentBox(page, name).check();
  else await treatmentBox(page, name).uncheck();
}

/** Tab 을 눌러 그 요소에 초점이 올 때까지 간다(최대 `limit` 번). 키보드만으로 도달할 수 있음을 본다. */
export async function tabTo(page: Page, target: Locator, limit = 30): Promise<void> {
  for (let count = 0; count < limit; count += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab ${limit}번 안에 초점이 도달하지 못했다`);
}

/** 초점 표시가 눈에 보이고 잘리지 않는지: 초점이 있는 조작 요소(또는 카드)의 윤곽선이 굵고(≥3px) 실선이며, 윤곽선이 자기를 자르는 조상의 영역 안에 있다. */
export async function focusRingProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const active = document.activeElement;
    if (active === null || active === document.body) return ['초점이 없다'];
    // 카드(라디오·체크박스)는 투명 입력이 초점을 받고 윤곽선은 감싼 label 이 그린다.
    const owner = active instanceof HTMLInputElement ? (active.closest('label') ?? active) : active;
    const style = getComputedStyle(owner);
    const width = Number.parseFloat(style.outlineWidth);
    if (style.outlineStyle === 'none' || !(width >= 3)) problems.push(`윤곽선이 약하다: ${style.outlineStyle} ${style.outlineWidth}`);
    const offset = Number.parseFloat(style.outlineOffset) || 0;
    // 윤곽선이 요소 바깥으로 뻗는 거리: 간격(offset)만큼 떨어진 곳에서 굵기만큼 바깥으로. 간격이 음수(안쪽 윤곽선, 화면 가장자리까지 닿는 스크롤 본문)면 그만큼 줄어든다.
    const reach = Math.max(0, width + offset);
    const rect = owner.getBoundingClientRect();
    const ring = { left: rect.left - reach, top: rect.top - reach, right: rect.right + reach, bottom: rect.bottom + reach };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (ring.left < 0 || ring.top < 0 || ring.right > vw || ring.bottom > vh) problems.push(`윤곽선이 화면 밖으로 나간다 (${Math.round(ring.left)},${Math.round(ring.top)})-(${Math.round(ring.right)},${Math.round(ring.bottom)})`);
    for (let parent = owner.parentElement; parent !== null; parent = parent.parentElement) {
      const parentStyle = getComputedStyle(parent);
      if (parentStyle.overflowX === 'visible' && parentStyle.overflowY === 'visible') continue;
      const clip = parent.getBoundingClientRect();
      if (ring.left < clip.left - 0.5 || ring.right > clip.right + 0.5 || ring.top < clip.top - 0.5 || ring.bottom > clip.bottom + 0.5) {
        problems.push(`윤곽선이 ${String(parent.className || parent.tagName)} 에 잘린다`);
        break;
      }
    }
    return problems;
  });
}
