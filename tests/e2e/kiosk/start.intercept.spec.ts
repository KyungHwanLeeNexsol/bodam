import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import { mockClinicApi } from '../helpers/api';
import { KIOSK_PATH, expectK01, expectStartScreen, isLandscape, root, startButton } from '../helpers/kiosk';
import { platformFonts } from '../helpers/fonts';

// 가로채기 층 (BRIEF D12): 시작 화면 K00_Start 와 공통 상단·큰 글자 보기·글꼴. AC-012a(시작 화면), AC-016a/d 의 일부(기록 항목이 쌓이지 않음), DD-12(큰 글자 반응형).

test.beforeEach(async ({ page }) => {
  await mockClinicApi(page);
});

async function fitsWithoutScrolling(page: Page): Promise<{ overflowX: boolean; overflowY: boolean; bodyOverflowY: number }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.querySelector('.kiosk-k00__body') as HTMLElement;
    return { overflowX: doc.scrollWidth > window.innerWidth, overflowY: doc.scrollHeight > window.innerHeight, bodyOverflowY: body.scrollHeight - body.clientHeight };
  });
}

test.describe('K00_Start 화면', () => {
  test('병원명·서비스명·서비스 설명·안내·흐름·시작 안내가 보이고 이전 금액·선택은 없다', async ({ page }, testInfo) => {
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    await expect(page.locator('h1')).toHaveText('보담');
    await expect(page.locator('.kiosk-wordmark__name')).toHaveText('보담');
    await expect(page.locator('.kiosk-wordmark__desc')).toHaveText('실손보험 예상 부담액 안내');
    await expect(page.locator('.kiosk-hospital__name')).toHaveText('TEST_FIXTURE 시험 의원');
    await expect(page.locator('.kiosk-k00__hospital')).toHaveText('TEST_FIXTURE 시험 의원');
    await expect(page.getByText('선택한 보험 조건으로 치료비와 예상 부담액을 확인해 보세요.')).toBeVisible();
    await expect(page.getByText('화면을 손가락으로 터치해서 이용하세요. 로그인이나 개인정보 입력은 필요하지 않습니다.')).toBeVisible();
    const chips = page.locator('.kiosk-k00__chip');
    await expect(chips).toHaveCount(4);
    // 가로형은 세로 목록이고 이름이 L_K00_Start 프레임 그대로다.
    const expected = isLandscape(testInfo) ? ['1 실손보험 선택', '2 보험사 형태 선택', '3 치료 원인 선택', '4 치료 선택'] : ['1 실손보험', '2 보험사 형태', '3 치료 원인', '4 치료 선택'];
    expect((await chips.allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim())).toEqual(expected);
    expect(await page.locator('body').innerText()).not.toMatch(/\d[\d,]*원/);
  });

  test('누를 수 있는 것은 "큰 글자 보기"와 "시작하기"뿐이고, "처음으로"·링크·전화가 없다', async ({ page }) => {
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    expect(await page.getByRole('button').allInnerTexts()).toEqual(['큰 글자 보기', '시작하기']);
    await expect(page.locator('body a, body [href], body [role="link"]')).toHaveCount(0);
    await expect(page.getByText('처음으로')).toHaveCount(0);
    expect(await page.locator('body').innerHTML()).not.toMatch(/tel:|mailto:|https?:\/\/|1544|1588/);
  });

  test('한 화면에 모두 들어간다: 가로·세로 스크롤이 없고 시작 버튼은 터치 영역 72px 이상이다', async ({ page }) => {
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    const fit = await fitsWithoutScrolling(page);
    expect(fit).toEqual({ overflowX: false, overflowY: false, bodyOverflowY: 0 });
    const box = await startButton(page).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(72);
    expect(box?.width).toBeGreaterThanOrEqual(72);
    const viewport = page.viewportSize();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0);
  });

  test('"시작하기": 새 빈 세션의 다음 화면이 열리고 기록 항목이 늘지 않고 주소가 그대로다', async ({ page }) => {
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    const before = await page.evaluate(() => ({ length: history.length, href: location.href, state: history.state as unknown }));
    let navigations = 0;
    page.on('framenavigated', () => {
      navigations += 1;
    });
    await startButton(page).click();
    await expectK01(page);
    await expect(startButton(page)).toHaveCount(0);
    const after = await page.evaluate(() => ({ length: history.length, href: location.href, state: history.state as unknown }));
    expect(after.length).toBe(before.length);
    expect(after.href).toBe(before.href);
    expect(after.href).not.toMatch(/#|\?/);
    expect(navigations).toBe(0);
  });
});

test.describe('큰 글자 보기 (DD-12)', () => {
  test('켜면 같은 화면이 큰 글자 배치가 되고(data-large-text) 시작 화면의 기능은 그대로다. 다시 누르면 꺼진다', async ({ page }) => {
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    const toggle = page.getByRole('button', { name: '큰 글자 보기' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const normalSize = await page.locator('.kiosk-k00__guide').evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(root(page)).toHaveAttribute('data-large-text', 'true');
    const largeSize = await page.locator('.kiosk-k00__guide').evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(largeSize).toBeGreaterThan(normalSize);
    // 기능을 빼지 않는다: 흐름 네 칸, 시작 버튼, 병원명, 안내, 시작 안내가 그대로 있다.
    await expect(page.locator('.kiosk-k00__chip')).toHaveCount(4);
    await expect(startButton(page)).toBeVisible();
    await expect(page.locator('.kiosk-k00__hospital')).toHaveText('TEST_FIXTURE 시험 의원');
    await expect(page.getByText('화면을 손가락으로 터치해서 이용하세요.')).toBeVisible();
    // 한 화면 안에 들어가고 버튼은 더 커진다.
    expect(await fitsWithoutScrolling(page)).toEqual({ overflowX: false, overflowY: false, bodyOverflowY: 0 });
    const box = await startButton(page).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(88);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(root(page)).toHaveAttribute('data-large-text', 'false');
  });

  test('큰 글자 켠 채로 시작하면 표시 설정이 유지되고(START 는 초기화 경로가 아니다), 토글 터치 영역은 72px 이상이다', async ({ page }) => {
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    const toggle = page.getByRole('button', { name: '큰 글자 보기' });
    const box = await toggle.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(72);
    await toggle.click();
    await startButton(page).click();
    await expectK01(page);
    await expect(root(page)).toHaveAttribute('data-large-text', 'true');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('글꼴 (BRIEF D7)', () => {
  test('font-family 는 Pretendard → Noto Sans KR → 맑은 고딕 → 시스템 산세리프 이고 실제로 Pretendard(웹 글꼴)로 그려진다', async ({ page }) => {
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toBe('Pretendard, "Noto Sans KR", "Malgun Gothic", sans-serif');
    const fonts = await platformFonts(page, '.kiosk-k00__wordmark');
    expect(fonts.map((font) => font.familyName)).toContain('Pretendard');
    expect(fonts.find((font) => font.familyName === 'Pretendard')?.isCustomFont).toBe(true);
    const guide = await platformFonts(page, '.kiosk-k00__guide');
    expect(guide.some((font) => font.familyName === 'Pretendard' && font.isCustomFont)).toBe(true);
    // 일반(400)과 굵게(700) 두 파일이 모두 내려와 쓰였다.
    const loaded = await page.evaluate(() => [...document.fonts].filter((face) => face.status === 'loaded').map((face) => `${face.family}:${face.weight}`));
    expect(loaded.sort()).toEqual(['Pretendard:400', 'Pretendard:700']);
  });

  test('글꼴 파일은 같은 출처에서 내려온다: 외부 요청이 없다 (키오스크는 오프라인일 수 있다)', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.hostname !== '127.0.0.1') external.push(request.url());
    });
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    await page.evaluate(() => document.fonts.ready);
    expect(external).toEqual([]);
  });

  test('woff2 를 막으면 웹 글꼴 없이 기기에 설치된 글꼴로 그려진다 (이 기기에 Pretendard 가 설치돼 있으면 그것, 아니면 목록의 다음 글꼴)', async ({ page }) => {
    await page.route('**/*.woff2', (route) => route.abort());
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    await page.evaluate(() => document.fonts.ready);
    const statuses = await page.evaluate(() => [...document.fonts].map((face) => `${face.family}:${face.weight}:${face.status}`).sort());
    expect(statuses).toEqual(['Pretendard:400:error', 'Pretendard:700:error']);
    const fonts = await platformFonts(page, '.kiosk-k00__wordmark');
    // 웹 글꼴(isCustomFont)이 아니라 기기 글꼴이고, 쓰인 글꼴은 정해 둔 목록 안의 것뿐이다.
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((font) => !font.isCustomFont)).toBe(true);
    expect(fonts.every((font) => ['Pretendard', 'Noto Sans KR', 'Malgun Gothic'].includes(font.familyName)), `쓰인 글꼴: ${fonts.map((font) => font.familyName).join(', ')}`).toBe(true);
    // 대체 글꼴로도 화면 기능이 그대로다.
    await expect(startButton(page)).toBeVisible();
  });

  test('대체 순서: 첫 글꼴(Pretendard)이 없을 때 다음이 Noto Sans KR → 맑은 고딕 순으로 쓰인다 (첫 글꼴 이름만 없는 이름으로 바꿔 목록의 나머지를 시험한다)', async ({ page }) => {
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    await page.addStyleTag({ content: ":root { --kiosk-font: NoSuchFontForTest, 'Noto Sans KR', 'Malgun Gothic', sans-serif; }" });
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toBe('NoSuchFontForTest, "Noto Sans KR", "Malgun Gothic", sans-serif');
    const fonts = await platformFonts(page, '.kiosk-k00__guide');
    const names = fonts.map((font) => font.familyName);
    // 한글 글자는 목록의 둘째(Noto Sans KR)나 셋째(맑은 고딕)로 그려지고, 둘 다 설치돼 있으면 둘째가 이긴다. 이 검사 기기에 어느 쪽이 설치돼 있는지는 쓰인 글꼴 이름으로 남는다.
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => ['Noto Sans KR', 'Malgun Gothic'].includes(name)), `쓰인 글꼴: ${names.join(', ')}`).toBe(true);
    test.info().annotations.push({ type: '대체 글꼴', description: names.join(', ') });
  });
});
