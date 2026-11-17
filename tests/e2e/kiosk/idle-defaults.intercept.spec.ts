import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import type { ApiMock } from '../helpers/api';
import type { CatalogDto } from '../../../src/app/kiosk/state/api-types';
import { makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { installClock } from '../helpers/clock';
import { dialog, expectStartScreen } from '../helpers/kiosk';
import { openKiosk } from '../helpers/input';
import { reachScreen } from '../helpers/screens';
import type { InputScreenName } from '../helpers/screens';
import { reachResultScreen } from '../helpers/results';
import type { ResultScreenName } from '../helpers/results';
import { reachSheetScreen } from '../helpers/sheets';
import type { SheetScreenName } from '../helpers/sheets';

// 가로채기 층 (S4 G, AC-015a·b·c·i 의 브라우저 쪽): 화면 종류별 무조작 시간의 기본값과 "catalog.idlePolicy 가 이긴다"를 실제 Chrome 과 가짜 시계로 본다.
// 기본값(DD-10 표): 입력 100/120초, 결과·보류·근거·서류 160/180초, 세대 확인 안내·계산 중·통신 오류 100/120초. 정책이 응답에 없으면 기본값이고, 있으면 정책이 이긴다.
// 화면 종류마다 다른 값을 넣어(겹치지 않게) 어느 화면이 엉뚱한 종류의 값을 쓰면 알아챈다. 시간은 모두 주입한 가짜 시계다: 실제로 기다리지 않는다.

type Reach = (page: Page, api: ApiMock) => Promise<void>;
type Klass = 'INPUT' | 'RESULT' | 'BASIS_AND_DOCUMENTS' | 'HOLD_RESULT' | 'NOTICE_PROGRESS_ERROR';

interface Entry {
  readonly name: string;
  readonly klass: Klass;
  readonly reach: Reach;
}

const input = (name: InputScreenName, klass: Klass = 'INPUT'): Entry => ({ name, klass, reach: (page, api) => reachScreen(page, api, name) });
const result = (name: ResultScreenName, klass: Klass): Entry => ({ name, klass, reach: (page, api) => reachResultScreen(page, api, name) });
const sheet = (name: SheetScreenName): Entry => ({ name, klass: 'BASIS_AND_DOCUMENTS', reach: (page, api) => reachSheetScreen(page, api, name) });

const ENTRIES: readonly Entry[] = [
  input('K01_Generation_Selected'),
  input('K02_Type_Selected'),
  input('K02b_Cause_Selected'),
  input('K03_Treatments_Selected'),
  input('K01_Generation_Unknown', 'NOTICE_PROGRESS_ERROR'),
  result('KXX_Loading_Calculating', 'NOTICE_PROGRESS_ERROR'),
  result('KXX_Error_Network', 'NOTICE_PROGRESS_ERROR'),
  result('K04_Result', 'RESULT'),
  result('K04_Result_NotCovered', 'RESULT'),
  result('K04_Result_Hold', 'HOLD_RESULT'),
  sheet('K04_Basis_Calculation'),
  sheet('K07_Documents'),
  sheet('K07_Documents_Unknown'),
];

type Seconds = readonly [warn: number, reset: number];

const DEFAULTS: Readonly<Record<Klass, Seconds>> = {
  INPUT: [100, 120],
  RESULT: [160, 180],
  BASIS_AND_DOCUMENTS: [160, 180],
  HOLD_RESULT: [160, 180],
  NOTICE_PROGRESS_ERROR: [100, 120],
};

/** 종류마다 다르고 기본값과도 다른 값. 종류를 잘못 읽으면 경고 시각이 어긋난다. */
const OVERRIDE: Readonly<Record<Klass, Seconds>> = {
  INPUT: [20, 40],
  RESULT: [50, 80],
  BASIS_AND_DOCUMENTS: [110, 140],
  HOLD_RESULT: [200, 230],
  NOTICE_PROGRESS_ERROR: [30, 60],
};

function catalogWith(mode: 'default' | 'override'): CatalogDto {
  const catalog = makeCatalog();
  if (mode === 'default') {
    // 정책이 응답에 아예 없는 병원.
    delete (catalog as { idlePolicy?: unknown }).idlePolicy;
    return catalog;
  }
  const screens = Object.fromEntries(Object.entries(OVERRIDE).map(([klass, [warnSeconds, resetSeconds]]) => [klass, { warnSeconds, resetSeconds }]));
  return { ...catalog, idlePolicy: { screens: screens as NonNullable<NonNullable<CatalogDto['idlePolicy']>['screens']>, completionHoldSeconds: null } };
}

// 마지막 조작에서 경고·초기화까지 센다. 시계는 실제 시간도 함께 흐르므로 3초 여유를 둔다(경고 3초 전에는 없고, 경고 직후에는 있다).
async function expectSchedule(page: Page, [warn, reset]: Seconds): Promise<void> {
  await page.clock.runFor((warn - 3) * 1000);
  await expect(dialog(page), `경고 3초 전(${String(warn - 3)}초)에는 경고창이 없다`).toHaveCount(0);
  await page.clock.runFor(3_500);
  await expect(dialog(page), `경고 시각(${String(warn)}초) 직후에는 경고창이 있다`).toHaveCount(1);
  await expect(dialog(page)).toContainText('계속 사용하시겠어요?');
  await page.clock.runFor((reset - warn - 6.5) * 1000);
  await expect(dialog(page), `초기화 3초 전(${String(reset - 3)}초)에는 경고창이 아직 열려 있다`).toHaveCount(1);
  await page.clock.runFor(3_500);
  await expectStartScreen(page);
  await expect(dialog(page)).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await installClock(page);
});

for (const mode of ['default', 'override'] as const) {
  test.describe(mode === 'default' ? '무조작 시간: 정책이 없으면 DD-10 기본값' : '무조작 시간: catalog.idlePolicy 가 기본값을 이긴다', () => {
    for (const entry of ENTRIES) {
      const seconds = (mode === 'default' ? DEFAULTS : OVERRIDE)[entry.klass];
      test(`${entry.name} (${entry.klass}): 경고 ${String(seconds[0])}초 · 초기화 ${String(seconds[1])}초`, async ({ page }) => {
        const api = await openKiosk(page, { catalog: catalogWith(mode) });
        await entry.reach(page, api);
        await expectSchedule(page, seconds);
      });
    }
  });
}
