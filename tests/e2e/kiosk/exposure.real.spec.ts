import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import { installMarkerIds } from '../helpers/ids';
import { expectStartScreen, startButton } from '../helpers/kiosk';
import { TITLES, bottomButton, heading } from '../helpers/input';
import { actionsOf, resultRoot } from '../helpers/results';
import { completeScreen, openBasis, openDocuments, sheetBack, sheetComplete } from '../helpers/sheets';
import { dumpStorage } from '../helpers/storage';
import { expectDomClean, expectEmptyDump, verifyExposure, watchExposure, writeEvidence } from '../helpers/exposure';

// 실제 핸들러 층 (S4 C, AC-016m): 시험용 앞단 서버가 실제 핸들러(handleCatalog·handleOptions·handleEstimate)에 시험 자료(TEST_FIXTURE) 서비스로 응답하는 세계에서 같은 흐름을 돌려
// 저장소 덤프(전·중·후)와 노출 감사(요청·콘솔·주소·DOM)를 본다. 병원 1: 정상(ESTIMATED), 병원 2: 보류(ON_HOLD). 운영 자료 검증이 아니다.
// 실제 발급기가 아니라 표지 식별자 발급기를 쓰므로, 별도로 "실제 crypto.randomUUID 구성"의 덤프에 UUID 형식 문자열이 새로 생기지 않는 시험도 둔다.

const OK_SLUG = 'test-fixture-clinic-1';
const HOLD_SLUG = 'test-fixture-clinic-2';

async function fillToConfirm(page: Page, slug: string, picks: number): Promise<void> {
  await page.goto(`/kiosk/${slug}`);
  await expectStartScreen(page);
  await startButton(page).click();
  await expect(heading(page, TITLES.generation)).toBeVisible();
  await page.getByRole('radio').nth(4).check();
  await bottomButton(page, '다음').click();
  await expect(heading(page, TITLES.type)).toBeVisible();
  await page.getByRole('radio').first().check();
  await bottomButton(page, '다음').click();
  await expect(heading(page, TITLES.cause)).toBeVisible();
  await page.getByRole('radio').first().check();
  await bottomButton(page, '다음').click();
  await expect(heading(page, TITLES.treatments)).toBeVisible();
  for (let index = 0; index < picks; index += 1) await page.getByRole('checkbox').nth(index).check();
}

async function finishToStart(page: Page): Promise<void> {
  await expect(completeScreen(page)).toBeVisible();
  await page.getByRole('button', { name: '처음 화면으로' }).click();
  await expectStartScreen(page);
}

for (const markers of [true, false]) {
  test.describe(markers ? '표지 식별자 발급기' : '실제 발급기(crypto.randomUUID)', () => {
    test('병원 1 정상: 시작 → 결과 → 근거 → 서류 → 이용 완료 → 시작, 저장소 덤프 전·중·후가 같고 비어 있다', async ({ page }, testInfo) => {
      if (markers) await installMarkerIds(page);
      const exposure = await watchExposure(page);
      const tag = `real-${testInfo.project.name.replace('real-', '')}-normal-${markers ? 'marker' : 'uuid'}`;
      await fillToConfirm(page, OK_SLUG, 2);
      const before = await dumpStorage(page);
      await bottomButton(page, '예상 부담액 확인').click();
      await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
      const during = await dumpStorage(page);
      await expectDomClean(page, `${tag} 결과`);
      await openBasis(page);
      await sheetBack(page).click();
      await openDocuments(page, 'documents');
      await sheetComplete(page).click();
      await finishToStart(page);
      const after = await dumpStorage(page);
      await expectDomClean(page, `${tag} 끝`);
      expectEmptyDump(before, `${tag} 전`);
      expectEmptyDump(during, `${tag} 중간`);
      expectEmptyDump(after, `${tag} 후`);
      expect(after).toEqual(before);
      const verdict = await verifyExposure(page, exposure, new URL(page.url()).origin, tag, { markers });
      writeEvidence(`${tag}.json`, { storage: { before, during, after }, verdict, requests: exposure.requests.map(({ method, url, resourceType }) => ({ method, url, resourceType })), console: exposure.console });
    });

    test('병원 2 보류: 시작 → 보류 결과 → 이용 완료 → 시작, 저장소 덤프 전·중·후가 같고 비어 있다', async ({ page }, testInfo) => {
      if (markers) await installMarkerIds(page);
      const exposure = await watchExposure(page);
      const tag = `real-${testInfo.project.name.replace('real-', '')}-hold-${markers ? 'marker' : 'uuid'}`;
      await fillToConfirm(page, HOLD_SLUG, 1);
      const before = await dumpStorage(page);
      await bottomButton(page, '예상 부담액 확인').click();
      await expect(resultRoot(page)).toHaveAttribute('data-result', 'hold');
      const during = await dumpStorage(page);
      await actionsOf(page).filter({ hasText: '이용 완료' }).click();
      await finishToStart(page);
      const after = await dumpStorage(page);
      await expectDomClean(page, `${tag} 끝`);
      expectEmptyDump(before, `${tag} 전`);
      expectEmptyDump(during, `${tag} 중간`);
      expectEmptyDump(after, `${tag} 후`);
      expect(after).toEqual(before);
      const verdict = await verifyExposure(page, exposure, new URL(page.url()).origin, tag, { markers });
      writeEvidence(`${tag}.json`, { storage: { before, during, after }, verdict, requests: exposure.requests.map(({ method, url, resourceType }) => ({ method, url, resourceType })), console: exposure.console });
    });
  });
}
