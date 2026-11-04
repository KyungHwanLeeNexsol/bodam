import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import type { ApiMock } from '../helpers/api';
import { makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { installClock } from '../helpers/clock';
import { appendEvidence } from '../helpers/evidence';
import { platformFonts } from '../helpers/fonts';
import { dialog, underlayHome } from '../helpers/kiosk';
import { INPUT_SCREENS, reachScreen } from '../helpers/screens';
import { expectLayoutClean, openKiosk, setLargeText } from '../helpers/input';
import { RESULT_SCREENS, idlePolicyWith, reachResultScreen } from '../helpers/results';
import { SHEET_SCREENS, reachSheetScreen } from '../helpers/sheets';

// 가로채기 층 (S4 D2·D3, AC-017a·e·f): 모든 화면 상태에서 Pretendard 가 실제로 적용되고(CDP 의 플랫폼 글꼴), 웹 글꼴을 막으면 목록의 다음 글꼴로 대체되며,
// 잘림·겹침·터치 영역 72px 은 "적용된 그 글꼴"로 잰다. 또 레이아웃 감사가 빠뜨렸던 시작 화면과 겹침창(ResetConfirm·TimeoutDialog) 위에서도 같은 감사를 한다.
// Pencil 화면의 결과는 근거가 아니다(디자인 도구는 Pretendard 를 그리지 못한다). 쓰인 글꼴 이름은 환경 변수 KIOSK_E2E_EVIDENCE_DIR 이 있을 때만 그 폴더의 fonts/ 에 남긴다(없으면 아무것도 쓰지 않는다).

type Reach = (page: Page, api: ApiMock) => Promise<void>;
interface Entry {
  readonly name: string;
  readonly reach: Reach;
  readonly relargeAfterReach?: boolean;
  readonly overlay?: boolean;
}

const quick = idlePolicyWith({ RESULT: { warnSeconds: 5, resetSeconds: 300 }, BASIS_AND_DOCUMENTS: { warnSeconds: 5, resetSeconds: 300 } });

const SCREENS: readonly Entry[] = [
  { name: 'K00_Start', reach: async () => undefined },
  ...INPUT_SCREENS.map((name): Entry => ({ name, reach: (page, api) => reachScreen(page, api, name) })),
  ...RESULT_SCREENS.map((name): Entry => ({ name, reach: (page, api) => reachResultScreen(page, api, name) })),
  ...SHEET_SCREENS.map((name): Entry => ({ name, reach: (page, api) => reachSheetScreen(page, api, name), relargeAfterReach: name === 'K06_Complete' })),
];

const OVERLAYS: readonly Entry[] = [
  {
    name: 'K03_Treatments_Dialog_Reset',
    overlay: true,
    reach: async (page, api) => {
      await reachScreen(page, api, 'K03_Treatments_Selected');
      await underlayHome(page).click();
      await dialog(page).waitFor();
    },
  },
  {
    name: 'KXX_Loading_Calculating_Dialog_Reset',
    overlay: true,
    reach: async (page, api) => {
      await reachResultScreen(page, api, 'KXX_Loading_Calculating');
      await underlayHome(page).click();
      await dialog(page).waitFor();
    },
  },
  {
    name: 'K04_Result_Dialog_Timeout',
    overlay: true,
    reach: async (page, api) => {
      await reachResultScreen(page, api, 'K04_Result');
      await page.clock.runFor(6_000);
      await dialog(page).waitFor();
    },
  },
  {
    name: 'K07_Documents_Dialog_Timeout',
    overlay: true,
    reach: async (page, api) => {
      await reachSheetScreen(page, api, 'K07_Documents');
      await page.clock.runFor(6_000);
      await dialog(page).waitFor();
    },
  },
];

const FALLBACK_NAMES = ['Pretendard', 'Noto Sans KR', 'Malgun Gothic'];

async function readyFonts(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
}

for (const large of [false, true]) {
  test.describe(`Pretendard 적용과 대체 글꼴 - ${large ? '큰 글자 보기' : '일반'}`, () => {
    for (const entry of [...SCREENS, ...OVERLAYS]) {
      test(`${entry.name}: 제목·본문·버튼 글자가 Pretendard(웹 글꼴)로 그려진다`, async ({ page }, testInfo) => {
        await installClock(page);
        const api = await openKiosk(page, entry.overlay === true ? { catalog: makeCatalog({ idlePolicy: quick }) } : undefined);
        if (large) await setLargeText(page, true);
        await entry.reach(page, api);
        if (large && entry.relargeAfterReach === true) await setLargeText(page, true);
        await readyFonts(page);

        // 겹침창이 열려 있으면 창 안의 글자를, 아니면 화면의 대표 제목·첫 본문 글·첫 버튼을 읽는다.
        const targets = entry.overlay === true ? ['[role="dialog"] h2', '[role="dialog"] p', '[role="dialog"] button'] : ['[data-kiosk-primary]', '.kiosk-screen p', '.kiosk-screen button, .kiosk-header button'];
        const seen: Record<string, Array<{ familyName: string; isCustomFont: boolean; glyphCount: number }>> = {};
        for (const selector of targets) {
          const count = await page.locator(selector).count();
          if (count === 0) continue;
          const fonts = await platformFonts(page, selector);
          seen[selector] = fonts;
          expect(
            fonts.some((font) => font.familyName === 'Pretendard' && font.isCustomFont && font.glyphCount > 0),
            `${entry.name} ${selector}: Pretendard 웹 글꼴로 그려지지 않았다 (${fonts.map((font) => `${font.familyName}${font.isCustomFont ? '(web)' : ''}:${String(font.glyphCount)}`).join(', ')})`,
          ).toBe(true);
        }
        expect(Object.keys(seen).length, `${entry.name}: 글꼴을 읽은 요소가 없다`).toBeGreaterThan(0);
        appendEvidence('fonts/pretendard-applied.jsonl', { project: testInfo.project.name, large, screen: entry.name, seen });
      });
    }
  });

  test.describe(`웹 글꼴을 막은 대체 글꼴로도 잘림·겹침·터치 영역이 깨끗하다 - ${large ? '큰 글자 보기' : '일반'}`, () => {
    for (const entry of [...SCREENS, ...OVERLAYS]) {
      test(`${entry.name}: woff2 차단 + 첫 글꼴 이름 제거 → 대체 글꼴(Noto Sans KR → 맑은 고딕 → 시스템)로 레이아웃 감사 통과`, async ({ page }, testInfo) => {
        await installClock(page);
        await page.route('**/*.woff2', (route) => route.abort());
        const api = await openKiosk(page, entry.overlay === true ? { catalog: makeCatalog({ idlePolicy: quick }) } : undefined);
        // 이 검사 기기에는 Pretendard 가 설치돼 있어 woff2 만 막으면 기기 글꼴 Pretendard 로 그려진다. 첫 글꼴 이름만 없는 이름으로 바꿔 목록의 나머지(둘째 이후)로 그려지게 한다(start.intercept.spec.ts 와 같은 방법).
        await page.addStyleTag({ content: ":root { --kiosk-font: NoSuchFontForTest, 'Noto Sans KR', 'Malgun Gothic', sans-serif; }" });
        if (large) await setLargeText(page, true);
        await entry.reach(page, api);
        if (large && entry.relargeAfterReach === true) await setLargeText(page, true);
        await readyFonts(page);

        const statuses = await page.evaluate(() => [...document.fonts].map((face) => face.status));
        expect(statuses.every((status) => status !== 'loaded'), '웹 글꼴이 막히지 않았다').toBe(true);
        const selector = entry.overlay === true ? '[role="dialog"] h2' : '[data-kiosk-primary]';
        const fonts = await platformFonts(page, selector);
        expect(fonts.length).toBeGreaterThan(0);
        expect(fonts.every((font) => !font.isCustomFont)).toBe(true);
        expect(fonts.every((font) => FALLBACK_NAMES.includes(font.familyName) && font.familyName !== 'Pretendard'), `쓰인 글꼴: ${fonts.map((font) => font.familyName).join(', ')}`).toBe(true);
        appendEvidence('fonts/fallback-fonts.jsonl', { project: testInfo.project.name, large, screen: entry.name, fonts: fonts.map((font) => font.familyName) });

        await expectLayoutClean(page, `${entry.name} 대체 글꼴 ${testInfo.project.name} ${large ? 'large' : 'normal'}`);
      });
    }
  });

  test.describe(`레이아웃 감사의 빈칸: 시작 화면과 겹침창 - ${large ? '큰 글자 보기' : '일반'}`, () => {
    for (const entry of [SCREENS[0] as Entry, ...OVERLAYS]) {
      test(`${entry.name}: 잘림·겹침·화면 밖·가려짐 없음, 조작 요소 72px 이상`, async ({ page }, testInfo) => {
        await installClock(page);
        const api = await openKiosk(page, entry.overlay === true ? { catalog: makeCatalog({ idlePolicy: quick }) } : undefined);
        if (large) await setLargeText(page, true);
        await entry.reach(page, api);
        await readyFonts(page);
        await expectLayoutClean(page, `${entry.name} ${testInfo.project.name} ${large ? 'large' : 'normal'}`);
      });
    }
  });
}
