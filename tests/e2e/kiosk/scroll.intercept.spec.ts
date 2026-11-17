import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import type { ApiMock } from '../helpers/api';
import { INPUT_SCREENS, reachScreen } from '../helpers/screens';
import { focusRingProblems, openKiosk, setLargeText, tabTo } from '../helpers/input';
import { RESULT_SCREENS, reachResultScreen } from '../helpers/results';
import { SHEET_SCREENS, reachSheetScreen } from '../helpers/sheets';
import { appendEvidence } from '../helpers/evidence';
import { scrollRegionTo, scrollRegions, settledScrollRegions } from '../helpers/scroll';
import { SCROLL_CUE_MIN_PX } from '../../../src/app/kiosk/view/scroll-cue';

// 가로채기 층 (S4 E): 스크롤되는 본문이 "아래에 더 있음"을 알리는지 모든 화면 상태 × 두 방향 × 일반/큰 글자에서 브라우저로 잰다.
// 기능 표지만 읽는다: 스크롤 영역의 data-scroll-more, 눈에 보이는 단서 [data-kiosk-scroll-cue], 키보드 초점(tabIndex 0)과 이름(role=region + aria-label).
// 규칙: 넘치는 영역마다 (1) 맨 위에서 남은 내용이 있다고 표시하고 단서가 눈에 보이며 (2) 키보드로 초점이 갈 수 있고 이름이 있으며 (3) 끝까지 내리면 단서가 사라지고 (4) 다시 올리면 돌아온다.
// 넘치지 않는 영역에는 단서도 초점 정지점도 없다(모든 화면에 쓸모없는 Tab 정지점이 생기지 않는다).

type Reach = (page: Page, api: ApiMock) => Promise<void>;
interface Entry {
  readonly name: string;
  readonly reach: Reach;
  /** 이용 완료 화면은 큰 글자를 끄므로 이 화면에서 다시 켠다. */
  readonly relargeAfterReach?: boolean;
}

const ENTRIES: readonly Entry[] = [
  { name: 'K00_Start', reach: async () => undefined },
  ...INPUT_SCREENS.map((name): Entry => ({ name, reach: (page, api) => reachScreen(page, api, name) })),
  ...RESULT_SCREENS.map((name): Entry => ({ name, reach: (page, api) => reachResultScreen(page, api, name) })),
  ...SHEET_SCREENS.map((name): Entry => ({ name, reach: (page, api) => reachSheetScreen(page, api, name), relargeAfterReach: name === 'K06_Complete' })),
];

test.describe('키보드로 넘치는 본문을 스크롤한다 (AC-017d 의 접근성 보완)', () => {
  for (const screen of ['K04_Result_Hold', 'K04_Result_NotCovered'] as const) {
    test(`${screen} 큰 글자: Tab 으로 본문에 초점이 오고(윤곽선이 화면 안에 보인다) PageDown 으로 끝까지 내리면 단서가 사라진다`, async ({ page }) => {
      const api = await openKiosk(page);
      await setLargeText(page, true);
      await reachResultScreen(page, api, screen);
      const regions = await settledScrollRegions(page);
      const index = regions.findIndex((region) => region.scrollHeight - region.clientHeight > SCROLL_CUE_MIN_PX);
      expect(index, '넘치는 본문이 있어야 이 시험이 뜻을 가진다').toBeGreaterThanOrEqual(0);

      const body = page.locator('[data-audit-scroller]').nth(index);
      await tabTo(page, body);
      expect(await focusRingProblems(page)).toEqual([]);
      await page.keyboard.press('PageDown');
      await expect.poll(async () => (await scrollRegions(page))[index]?.scrollTop ?? 0).toBeGreaterThan(0);
      for (let guard = 0; guard < 12; guard += 1) await page.keyboard.press('End');
      await expect.poll(async () => (await scrollRegions(page))[index]?.moreAttr).toBe('false');
      expect((await scrollRegions(page))[index]?.cueVisible).toBe(false);
    });
  }
});

for (const large of [false, true]) {
  test.describe(`스크롤 영역의 "더 있음" 표시 - ${large ? '큰 글자 보기' : '일반'}`, () => {
    for (const entry of ENTRIES) {
      test(`${entry.name}: 넘치는 영역은 표시·초점·이름을 갖고 끝에서 사라지며, 넘치지 않는 영역에는 없다`, async ({ page }, testInfo) => {
        const api = await openKiosk(page);
        if (large) await setLargeText(page, true);
        await entry.reach(page, api);
        if (large && entry.relargeAfterReach === true) await setLargeText(page, true);

        const regions = await settledScrollRegions(page);
        if (process.env.SCROLL_LOG === '1') {
          appendEvidence('scroll-regions.jsonl', { project: testInfo.project.name, large, screen: entry.name, regions });
        }

        for (const [index, region] of regions.entries()) {
          const label = `${entry.name} ${testInfo.project.name} ${large ? 'large' : 'normal'} 영역 ${String(index)} ${region.name} (${String(region.scrollHeight)}/${String(region.clientHeight)})`;
          // 위쪽 내용이 잘려 스크롤로도 닿지 못하는 일이 없다(가운데 정렬한 영역이 넘칠 때의 고전적 결함).
          expect(region.firstChildCutOff, `${label}: 맨 위로 올려도 첫 내용이 영역 위로 잘려 있다`).toBeLessThanOrEqual(1);
          // 기준 이하의 넘침은 스크롤 영역으로 보지 않는다(SCROLL_CUE_MIN_PX 와 같은 값).
          if (region.scrollHeight - region.clientHeight <= SCROLL_CUE_MIN_PX) {
            expect(region.cueVisible, `${label}: 넘치지 않는데 단서가 보인다`).toBe(false);
            expect(region.tabIndex, `${label}: 넘치지 않는데 Tab 정지점이다`).not.toBe(0);
            continue;
          }
          expect(region.moreAttr, `${label}: 맨 위에서 남은 내용이 있다고 표시해야 한다`).toBe('true');
          expect(region.cueVisible, `${label}: 맨 위에서 눈에 보이는 단서가 있어야 한다`).toBe(true);
          expect(region.tabIndex, `${label}: 키보드로 스크롤할 수 있게 Tab 정지점이어야 한다`).toBe(0);
          expect(['region', 'group', 'radiogroup'], `${label}: 이름 있는 영역(또는 묶음)이어야 한다`).toContain(region.role);
          expect((region.label ?? '').trim(), `${label}: 이름이 비어 있다`).not.toBe('');

          await scrollRegionTo(page, index, 'end');
          await expect.poll(async () => (await scrollRegions(page))[index]?.moreAttr, { message: `${label}: 끝까지 내리면 남은 내용이 없다고 표시해야 한다` }).toBe('false');
          expect((await scrollRegions(page))[index]?.cueVisible, `${label}: 끝에서는 단서가 사라져야 한다`).toBe(false);

          await scrollRegionTo(page, index, 'start');
          await expect.poll(async () => (await scrollRegions(page))[index]?.moreAttr, { message: `${label}: 다시 올리면 표시가 돌아와야 한다` }).toBe('true');
          expect((await scrollRegions(page))[index]?.cueVisible, `${label}: 다시 올리면 단서가 돌아와야 한다`).toBe(true);
        }
      });
    }
  });
}
