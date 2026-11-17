import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { MISMATCH_409, reply } from './api';
import type { ApiMock, Held } from './api';
import { TITLES, TREATMENT, bottomButton, goToTreatmentPage, heading, refreshNotice, selectTreatment, toK01, toK02, toK02b, toK03 } from './input';
import { generationRadio } from './kiosk';
import { makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';
import type { CatalogDto } from '../../../src/app/kiosk/state/api-types';

// 시험 자료(TEST_FIXTURE). 입력 단계 화면 상태 목록(S2)과 거기까지 가는 길. 레이아웃 감사와 화면 목록 사진이 같은 목록을 쓴다.
// 결과 쪽 화면(계산 중·결과 셋·긴 금액·통신 오류, S3a)의 목록과 가는 길은 helpers/results.ts(RESULT_SCREENS·reachResultScreen)에 있고, layout·inventory 시험이 두 목록을 함께 돈다.
// 이름은 디자인 프레임 이름을 따랐고, 디자인에 없는 화면 상태(갱신 안내 셋, 쪽 넘김)는 이 단계가 만들었다.

export const INPUT_SCREENS = [
  'K01_Generation_Empty',
  'K01_Generation_Selected',
  'K01_Generation_Unknown',
  'K02_Type_Empty',
  'K02_Type_Selected',
  'K02b_Cause_Empty',
  'K02b_Cause_Selected',
  'K03_Treatments_Empty',
  'K03_Treatments_Selected',
  'K03_Treatments_Page2',
  'K03_Treatments_RefreshRunning',
  'K03_Treatments_RefreshFailed',
  'K03_Treatments_RefreshRemoved',
] as const;

export type InputScreenName = (typeof INPUT_SCREENS)[number];

/** 새 병원 자료(갱신 성공 응답): 물리치료가 내려가고 X-ray 가격이 바뀌었다. */
export function refreshedCatalog(): CatalogDto {
  const base = makeCatalog();
  return {
    ...base,
    catalogVersion: 'TEST_FIXTURE_CATALOG_V2',
    treatments: base.treatments.filter((entry) => entry.displayName !== TREATMENT.physio).map((entry) => (entry.displayName === TREATMENT.xray ? { ...entry, patientAmount: 12_000 } : entry)),
  };
}

export const refreshedOptions = () => makeOptions({ ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V2' });

/** 갱신을 일으킨다: 치료를 고른 K03 에서 "예상 부담액 확인"을 누르면 계산이 409 로 거절되고 갱신이 시작된다. 두 GET 은 붙잡아 둔다. */
export async function startRefresh(page: Page, api: ApiMock): Promise<{ catalog: Held; options: Held }> {
  api.queue('estimate', reply(409, MISMATCH_409));
  const catalog = api.hold('catalog');
  const options = api.hold('options');
  await bottomButton(page, '예상 부담액 확인').click();
  await expect(refreshNotice(page, 'running')).toBeVisible();
  await catalog.arrived();
  await options.arrived();
  return { catalog, options };
}

/** 이름이 가리키는 화면까지 간다. 화면 방향·큰 글자 보기는 호출하는 시험이 정한다. */
export async function reachScreen(page: Page, api: ApiMock, screen: InputScreenName): Promise<void> {
  switch (screen) {
    case 'K01_Generation_Empty':
      await toK01(page);
      return;
    case 'K01_Generation_Selected':
      await toK01(page);
      await generationRadio(page, '2세대(C1)').check();
      return;
    case 'K01_Generation_Unknown':
      await toK01(page);
      await page.getByRole('button', { name: '세대를 모르겠어요' }).click();
      await expect(heading(page, TITLES.generationHelp)).toBeVisible();
      return;
    case 'K02_Type_Empty':
      await toK02(page);
      return;
    case 'K02_Type_Selected':
      await toK02(page);
      await page.getByRole('radio', { name: '손해보험사' }).check();
      return;
    case 'K02b_Cause_Empty':
      await toK02b(page);
      return;
    case 'K02b_Cause_Selected':
      await toK02b(page);
      await page.getByRole('radio', { name: '다쳐서 왔어요 (상해)' }).check();
      return;
    case 'K03_Treatments_Empty':
      await toK03(page);
      return;
    case 'K03_Treatments_Selected':
      await toK03(page);
      await selectTreatment(page, TREATMENT.xray);
      await selectTreatment(page, TREATMENT.kidney);
      return;
    case 'K03_Treatments_Page2':
      await toK03(page);
      await selectTreatment(page, TREATMENT.xray);
      await goToTreatmentPage(page, 2);
      await expect(page.getByRole('checkbox')).not.toHaveCount(0);
      return;
    case 'K03_Treatments_RefreshRunning': {
      await toK03(page);
      await selectTreatment(page, TREATMENT.xray);
      await selectTreatment(page, TREATMENT.physio);
      await startRefresh(page, api);
      return;
    }
    case 'K03_Treatments_RefreshFailed': {
      await toK03(page);
      await selectTreatment(page, TREATMENT.xray);
      await selectTreatment(page, TREATMENT.physio);
      const held = await startRefresh(page, api);
      held.catalog.release(reply(500, { error: 'INTERNAL_ERROR' }));
      held.options.release(reply(200, refreshedOptions()));
      await expect(refreshNotice(page, 'failed')).toBeVisible();
      return;
    }
    case 'K03_Treatments_RefreshRemoved': {
      await toK03(page);
      await selectTreatment(page, TREATMENT.xray);
      await selectTreatment(page, TREATMENT.physio);
      const held = await startRefresh(page, api);
      held.catalog.release(reply(200, refreshedCatalog()));
      held.options.release(reply(200, refreshedOptions()));
      await expect(refreshNotice(page, 'removed')).toBeVisible();
      return;
    }
  }
}
