import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import type { ApiMock } from '../helpers/api';
import { makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { installClock } from '../helpers/clock';
import { dialog, underlayHome } from '../helpers/kiosk';
import { INPUT_SCREENS, reachScreen } from '../helpers/screens';
import { openKiosk, setLargeText } from '../helpers/input';
import { RESULT_SCREENS, idlePolicyWith, reachResultScreen } from '../helpers/results';
import { SHEET_SCREENS, reachSheetScreen } from '../helpers/sheets';
import { measureContrast } from '../helpers/contrast';
import { appendEvidence } from '../helpers/evidence';

// 가로채기 층 (S4 D1, AC-017g): 그려진 모든 화면 상태 × 두 방향 × 일반/큰 글자에서 글자와 바로 뒤 배경의 대비를 실제 DOM 의 계산된 색으로 잰다(토큰 값으로 계산하지 않는다).
// 일반 글자 4.5:1 이상, 큰 글자(24px 이상, 또는 굵게 18.66px 이상) 3:1 이상. 예외는 로고·장식·실제로 비활성인 조작 요소뿐이다(helpers/contrast.ts).
// 환경 변수 KIOSK_E2E_EVIDENCE_DIR 이 있을 때만 측정 값 전부가 그 폴더의 contrast/ 에 JSONL 로 남는다(없으면 아무것도 쓰지 않는다..moai/state/m6/contrast-table.mjs 가 표로 만든다). 이 결과는 디자인 기준의 확인이며 접근성 인증이 아니다.

type Reach = (page: Page, api: ApiMock) => Promise<void>;
interface Entry {
  readonly name: string;
  readonly reach: Reach;
  readonly relargeAfterReach?: boolean;
  readonly catalog?: () => ReturnType<typeof makeCatalog>;
}

const quick = idlePolicyWith({ INPUT: { warnSeconds: 5, resetSeconds: 300 }, RESULT: { warnSeconds: 5, resetSeconds: 300 } });

const ENTRIES: readonly Entry[] = [
  { name: 'K00_Start', reach: async () => undefined },
  ...INPUT_SCREENS.map((name): Entry => ({ name, reach: (page, api) => reachScreen(page, api, name) })),
  ...RESULT_SCREENS.map((name): Entry => ({ name, reach: (page, api) => reachResultScreen(page, api, name) })),
  ...SHEET_SCREENS.map((name): Entry => ({ name, reach: (page, api) => reachSheetScreen(page, api, name), relargeAfterReach: name === 'K06_Complete' })),
  // 겹침창: 창 안의 글자를 잰다(밑 화면은 inert 라 대상이 아니다).
  {
    name: 'K03_Treatments_Dialog_Reset',
    reach: async (page, api) => {
      await reachScreen(page, api, 'K03_Treatments_Selected');
      await underlayHome(page).click();
      await dialog(page).waitFor();
    },
  },
  {
    name: 'K04_Result_Dialog_Timeout',
    catalog: () => makeCatalog({ idlePolicy: quick }),
    reach: async (page, api) => {
      await reachResultScreen(page, api, 'K04_Result');
      await page.clock.runFor(6_000);
      await dialog(page).waitFor();
    },
  },
];

for (const large of [false, true]) {
  test.describe(`글자 대비 - ${large ? '큰 글자 보기' : '일반'}`, () => {
    for (const entry of ENTRIES) {
      test(`${entry.name}: 일반 글자 4.5:1 · 큰 글자 3:1 이상`, async ({ page }, testInfo) => {
        await installClock(page);
        const api = await openKiosk(page, entry.catalog === undefined ? undefined : { catalog: entry.catalog() });
        if (large) await setLargeText(page, true);
        await entry.reach(page, api);
        if (large && entry.relargeAfterReach === true) await setLargeText(page, true);

        const report = await measureContrast(page);
        appendEvidence('contrast/contrast.jsonl', { project: testInfo.project.name, large, screen: entry.name, ...report });

        expect(report.measured.length, `${entry.name}: 측정한 글자 요소가 없다(빈 측정으로 통과하지 않는다)`).toBeGreaterThan(0);
        expect(report.unmeasurable, `${entry.name}: 배경 한 색으로 정할 수 없어 측정하지 못한 글자`).toEqual([]);
        const failing = report.measured.filter((item) => !item.pass).map((item) => `${item.selector}「${item.text}」 ${String(item.ratio)}:1 < ${String(item.required)}:1 (${item.fg} on ${item.bg}, ${String(item.fontSize)}px/${String(item.fontWeight)})`);
        expect(failing, `${entry.name} ${testInfo.project.name} ${large ? 'large' : 'normal'}: 대비 부족`).toEqual([]);
      });
    }
  });
}

test.describe('측정 도구 자체 점검', () => {
  test('일부러 옅은 글자색으로 바꾼 화면에서 대비 부족을 찾아낸다', async ({ page }) => {
    await openKiosk(page);
    expect((await measureContrast(page)).measured.every((item) => item.pass)).toBe(true);
    await page.addStyleTag({ content: '.kiosk-k00__guide, .kiosk-k00__hospital { color: #b8c2cf !important; }' });
    const report = await measureContrast(page);
    expect(report.measured.filter((item) => !item.pass).length).toBeGreaterThan(0);
  });

  test('실제로 비활성인 조작 요소와 로고는 예외로 따로 센다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachScreen(page, api, 'K03_Treatments_Empty');
    const report = await measureContrast(page);
    expect(report.exempt.map((item) => item.reason)).toContain('실제로 비활성인 조작 요소');
    expect(report.exempt.map((item) => item.reason)).toContain('로고(워드마크)');
  });
});
