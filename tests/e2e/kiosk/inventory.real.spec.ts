import { test } from '../helpers/test';
import type { Page } from '@playwright/test';
import { expectStartScreen, startButton } from '../helpers/kiosk';
import { TITLES, bottomButton, heading, setLargeText } from '../helpers/input';
import { resultRoot } from '../helpers/results';
import { openBasis, openDocuments } from '../helpers/sheets';
import { SHOTS_ENABLED, shot } from '../helpers/shot';

// 실제 핸들러 층의 화면 사진 (S4 F): SHOTS=1 일 때만 .moai/state/shots/real-<화면>-<방향>-<일반|큰글자>.png 를 쓴다. 실제 핸들러(시험 자료)가 낸 응답으로 그린 화면이다
// (가로채기 층의 사진은 응답을 시험이 짧게 줄여 두었다: 예) K01 "가입 시기를 모르실 때" 안내가 실제로는 두 문장이다). 사진은 육안 검토용이며 증거가 아니다.

test.skip(!SHOTS_ENABLED, 'SHOTS=1 일 때만 사진을 만든다');

const OK_SLUG = 'test-fixture-clinic-1';
const HOLD_SLUG = 'test-fixture-clinic-2';

async function fill(page: Page, slug: string, causeIndex: number, picks: number, stopAt: 'k01' | 'confirm'): Promise<void> {
  await page.goto(`/kiosk/${slug}`);
  await expectStartScreen(page);
  await startButton(page).click();
  await heading(page, TITLES.generation).waitFor();
  await page.getByRole('radio').nth(4).check();
  if (stopAt === 'k01') return;
  await bottomButton(page, '다음').click();
  await heading(page, TITLES.type).waitFor();
  await page.getByRole('radio').first().check();
  await bottomButton(page, '다음').click();
  await heading(page, TITLES.cause).waitFor();
  await page.getByRole('radio').nth(causeIndex).check();
  await bottomButton(page, '다음').click();
  await heading(page, TITLES.treatments).waitFor();
  for (let index = 0; index < picks; index += 1) await page.getByRole('checkbox').nth(index).check();
}

for (const large of [false, true]) {
  const mode = large ? '큰 글자' : '일반';
  test(`real K01_Generation_Selected ${mode}`, async ({ page }, testInfo) => {
    await fill(page, OK_SLUG, 0, 0, 'k01');
    if (large) await setLargeText(page, true);
    await shot(page, testInfo, 'real-K01_Generation_Selected', large);
  });

  for (const [name, slug, causeIndex, picks, step] of [
    ['real-K04_Result', OK_SLUG, 0, 2, 'result'],
    ['real-K04_Result_Hold', HOLD_SLUG, 0, 1, 'result'],
    ['real-K04_Basis_Calculation', OK_SLUG, 0, 2, 'basis'],
    ['real-K07_Documents', OK_SLUG, 0, 2, 'documents'],
    ['real-K07_Documents_Unknown', OK_SLUG, 2, 2, 'documents-unknown'],
  ] as const) {
    test(`${name} ${mode}`, async ({ page }, testInfo) => {
      // fill() 이 페이지를 다시 연다(새로고침하면 큰 글자 보기도 풀린다: 환자 상태는 메모리에만 있다). 그래서 큰 글자는 입력을 채운 뒤에 켠다.
      await fill(page, slug, causeIndex, picks, 'confirm');
      if (large) await setLargeText(page, true);
      await bottomButton(page, '예상 부담액 확인').click();
      await resultRoot(page).waitFor();
      if (step === 'basis') await openBasis(page);
      if (step === 'documents') await openDocuments(page, 'documents');
      if (step === 'documents-unknown') await openDocuments(page, 'documents-unknown');
      await shot(page, testInfo, name, large);
    });
  }
}
