import { expect, test } from '../helpers/test';
import type { Locator, Page } from '@playwright/test';
import { estimatedResponse, singleCauseDocuments, unknownCauseDocuments } from '../../fixtures/kiosk/estimate-response.fixture';
import { KIOSK_PATH, expectK01, expectStartScreen, generationRadio, startButton } from '../helpers/kiosk';
import { TITLES, TREATMENT, bottomButton, focusRingProblems, heading, openKiosk, setLargeText, tabTo, treatmentBox } from '../helpers/input';
import { FOUR_TREATMENTS, actionsOf, amountValue, confirmButton, resultRoot, screenText } from '../helpers/results';
import { COMPLETE_TITLE, completeScreen, docsPagerNext, normalWith, openBasis, openDocuments, reachResult, sheetBack, sheetComplete, visibleDocs } from '../helpers/sheets';
import type { Cause } from '../helpers/sheets';
import { reply } from '../helpers/api';

// 가로채기 층 (S4, AC-017b·c·d): 시작부터 이용 완료·다시 시작까지의 전체 흐름을 세 방식으로 끝까지 진행한다.
//  - 키보드만(AC-017d): Tab·Shift+Tab·방향키·Space·Enter 만 쓴다. 마우스·직접 초점 이동이 없고, 화면이 바뀔 때마다 초점이 새 화면의 대표 제목으로 가며 초점 표시가 굵고 잘리지 않는다.
//  - 터치만(AC-017c): 실제 터치 이벤트(탭)만 쓴다. 마우스 포인터·키 입력이 한 번도 없었음을 이벤트 기록으로 확인한다.
//  - 큰 글자 보기(AC-017b): 일반 모드와 같은 흐름을 큰 글자로 진행해 금액·선택·동작·서류 줄(체크·사유)·복귀 규칙이 같고, 초기화 뒤 큰 글자가 꺼진다. 두 방향은 프로젝트(세로·가로)가 정한다.
// 응답은 가로챈 시험 자료다(운영 자료·실제 핸들러가 아니다).

const NINE = ['RECEIPT_AND_ITEMIZED', 'OUTPATIENT_CONFIRMATION', 'TREATMENT_CONFIRMATION', 'INITIAL_EXAM_RECORD', 'DIAGNOSIS_CERT', 'ADMISSION_DISCHARGE_CONFIRMATION', 'MEDICAL_OPINION', 'IMAGING_READING', 'BIOPSY_RESULT'];

test.describe('키보드만으로 시작부터 이용 완료·다시 시작까지 (AC-017d)', () => {
  test('Tab·방향키·Space·Enter 만으로 입력 네 단계 → 결과 → 근거 → 결과 → 서류 → 이용 완료 → 시작. 화면마다 초점은 대표 제목으로 가고 초점 표시는 굵고 잘리지 않는다', async ({ page }) => {
    const api = await openKiosk(page);
    api.queue('estimate', reply(200, normalWith(singleCauseDocuments())));
    const problems: string[] = [];
    const ring = async (label: string): Promise<void> => {
      for (const problem of await focusRingProblems(page)) problems.push(`${label}: ${problem}`);
    };
    /** 키보드로만 그 요소까지 가서 Enter 로 누른다(초점 표시도 본다). */
    const press = async (target: Locator, label: string, key = 'Enter'): Promise<void> => {
      await tabTo(page, target);
      await ring(label);
      await page.keyboard.press(key);
    };

    // 시작: 문서 처음에서 Tab 만으로 "시작하기" 까지 간다.
    await tabTo(page, startButton(page));
    await ring('시작하기');
    await page.keyboard.press('Enter');
    await expect(heading(page, TITLES.generation)).toBeFocused();

    // 1단계: Tab → 첫 카드, 방향키로 4세대(C4) 까지.
    await page.keyboard.press('Tab');
    await expect(generationRadio(page, '1세대(A·S)')).toBeFocused();
    for (let index = 0; index < 4; index += 1) await page.keyboard.press('ArrowDown');
    await expect(generationRadio(page, '4세대(C4)')).toBeChecked();
    await ring('세대 카드');
    await press(bottomButton(page, '다음'), '다음(1단계)');
    await expect(heading(page, TITLES.type)).toBeFocused();

    // 2단계: Tab → 첫 카드, Space.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(page.getByRole('radio', { name: '손해보험사' })).toBeChecked();
    await press(bottomButton(page, '다음'), '다음(2단계)');
    await expect(heading(page, TITLES.cause)).toBeFocused();

    // 3단계.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(page.getByRole('radio', { name: '다쳐서 왔어요 (상해)' })).toBeChecked();
    await press(bottomButton(page, '다음'), '다음(3단계)');
    await expect(heading(page, TITLES.treatments)).toBeFocused();

    // 4단계: 네 카드를 Tab·Space 로 고른다(한 쪽에 넷).
    for (const name of FOUR_TREATMENTS) {
      await page.keyboard.press('Tab');
      await expect(treatmentBox(page, name)).toBeFocused();
      await page.keyboard.press('Space');
      await expect(treatmentBox(page, name)).toBeChecked();
    }
    await press(confirmButton(page), '예상 부담액 확인');

    // 결과 → 계산 근거 → 결과.
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
    await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
    await press(actionsOf(page).filter({ hasText: '계산 근거 보기' }), '계산 근거 보기');
    await expect(page.locator('[data-sheet="basis"]')).toBeVisible();
    await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
    await press(sheetBack(page), '결과로 돌아가기');
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');

    // 서류 → 이용 완료 → 처음 화면으로.
    await press(actionsOf(page).filter({ hasText: '보험 청구에 필요한 서류 확인' }), '서류 확인');
    await expect(page.locator('[data-sheet="documents"]')).toBeVisible();
    await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
    await press(sheetComplete(page), '이용 완료');
    await expect(completeScreen(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: COMPLETE_TITLE })).toBeFocused();
    await press(page.getByRole('button', { name: '처음 화면으로' }), '처음 화면으로');
    await expectStartScreen(page);
    await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
    expect(problems).toEqual([]);
  });
});

test.describe('터치만으로 시작부터 이용 완료·다시 시작까지 (AC-017c)', () => {
  test.use({ hasTouch: true });

  test('탭 이벤트만 쓴다: 마우스 포인터·키 입력이 한 번도 없었고 흐름이 끝까지 완료된다', async ({ page }) => {
    await page.addInitScript(() => {
      const seen = { pointers: [] as string[], keys: 0, hover: [] as string[] };
      (window as unknown as { __input: typeof seen }).__input = seen;
      window.addEventListener('pointerdown', (event) => seen.pointers.push(event.pointerType), true);
      window.addEventListener('keydown', () => (seen.keys += 1), true);
      window.addEventListener('pointerover', (event) => event.pointerType !== 'touch' && seen.hover.push(event.pointerType), true);
    });
    const api = await openKiosk(page);
    api.queue('estimate', reply(200, normalWith(singleCauseDocuments())));
    await startButton(page).tap();
    await expectK01(page);
    await generationRadio(page, '2세대(C1)').tap();
    await bottomButton(page, '다음').tap();
    await expect(heading(page, TITLES.type)).toBeVisible();
    await page.getByRole('radio', { name: '손해보험사' }).tap();
    await bottomButton(page, '다음').tap();
    await expect(heading(page, TITLES.cause)).toBeVisible();
    await page.getByRole('radio', { name: '다쳐서 왔어요 (상해)' }).tap();
    await bottomButton(page, '다음').tap();
    await expect(heading(page, TITLES.treatments)).toBeVisible();
    for (const name of FOUR_TREATMENTS) await treatmentBox(page, name).tap();
    await confirmButton(page).tap();
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
    await actionsOf(page).filter({ hasText: '계산 근거 보기' }).tap();
    await expect(page.locator('[data-sheet="basis"]')).toBeVisible();
    await sheetBack(page).tap();
    await actionsOf(page).filter({ hasText: '보험 청구에 필요한 서류 확인' }).tap();
    await expect(page.locator('[data-sheet="documents"]')).toBeVisible();
    await sheetComplete(page).tap();
    await expect(completeScreen(page)).toBeVisible();
    await page.getByRole('button', { name: '처음 화면으로' }).tap();
    await expectStartScreen(page);

    const input = await page.evaluate(() => (window as unknown as { __input: { pointers: string[]; keys: number; hover: string[] } }).__input);
    expect(input.pointers.length, '탭이 실제로 포인터 이벤트를 만들었다').toBeGreaterThan(15);
    expect([...new Set(input.pointers)]).toEqual(['touch']);
    expect(input.keys).toBe(0);
    expect(input.hover).toEqual([]);
  });

  test('호버가 없어도 정보가 가려지지 않는다: 키오스크 스타일에 :hover 로만 보이는 규칙이 없다', async ({ page }) => {
    await openKiosk(page);
    const hoverRules = await page.evaluate(() => {
      const found: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        for (const rule of Array.from(sheet.cssRules)) if (rule.cssText.includes(':hover')) found.push(rule.cssText.slice(0, 80));
      }
      return found;
    });
    expect(hoverRules).toEqual([]);
  });
});

interface Fingerprint {
  readonly amounts: string[];
  readonly resultActions: string[];
  readonly basisText: string;
  readonly docs: Array<{ key: string; required: boolean; reasons: string[] }>;
  readonly kindAfterBasis: string | null;
  readonly kindAfterDocs: string | null;
  readonly largeAfterReset: string | null;
}

async function collectDocs(page: Page): Promise<Fingerprint['docs']> {
  const all: Fingerprint['docs'] = [];
  for (let guard = 0; guard < 12; guard += 1) {
    all.push(...(await visibleDocs(page)));
    if ((await docsPagerNext(page).count()) === 0 || (await docsPagerNext(page).getAttribute('aria-disabled')) === 'true') break;
    await docsPagerNext(page).click();
  }
  return all.sort((a, b) => a.key.localeCompare(b.key));
}

/** 시작 화면에서 출발해 이용 완료·다시 시작까지 마우스 흐름으로 진행하고, 기능의 지문(금액·동작·근거 글·서류 줄·복귀 종류)을 돌려준다. */
async function runFlow(page: Page, api: Parameters<typeof reachResult>[1], large: boolean, cause: Cause): Promise<Fingerprint> {
  if (large) await setLargeText(page, true);
  const documents = cause === 'UNKNOWN' ? unknownCauseDocuments() : singleCauseDocuments();
  await reachResult(page, api, estimatedResponse({ documents }), cause);
  await expect(page.locator('.kiosk-root')).toHaveAttribute('data-large-text', large ? 'true' : 'false');
  const amounts = [await amountValue(page, 'hospital').innerText(), await amountValue(page, 'payout').innerText(), await amountValue(page, 'after').innerText()];
  const resultActions = await actionsOf(page).allInnerTexts();

  await openBasis(page);
  // "아래에 더 있어요" 단서는 화면 크기에 따라 나타나는 표시이지 내용이 아니다(scroll.intercept.spec.ts 가 본다). 내용만 비교한다.
  const basisText = (await screenText(page)).replace('아래에 더 있어요', '').replace(/\s+/g, ' ').trim();
  await sheetBack(page).click();
  const kindAfterBasis = await resultRoot(page).getAttribute('data-result');
  await openDocuments(page, cause === 'UNKNOWN' ? 'documents-unknown' : 'documents');
  const docs = await collectDocs(page);
  await sheetBack(page).click();
  const kindAfterDocs = await resultRoot(page).getAttribute('data-result');

  await actionsOf(page).filter({ hasText: '이용 완료' }).click();
  await expect(completeScreen(page)).toBeVisible();
  await page.getByRole('button', { name: '처음 화면으로' }).click();
  await expectStartScreen(page);
  return { amounts, resultActions, basisText, docs, kindAfterBasis, kindAfterDocs, largeAfterReset: await page.locator('.kiosk-root').getAttribute('data-large-text') };
}

test.describe('큰 글자 보기로 시작부터 이용 완료·다시 시작까지: 일반 모드와 기능이 같다 (AC-017b)', () => {
  for (const cause of ['INJURY', 'UNKNOWN'] as const) {
    test(`원인 ${cause}: 금액·결과 동작 여섯·근거 글·서류 아홉 줄(체크·사유)·복귀 종류가 일반 모드와 같고, 이용 완료 뒤 큰 글자는 꺼진다`, async ({ page }) => {
      const api = await openKiosk(page);
      const normal = await runFlow(page, api, false, cause);
      const large = await runFlow(page, api, true, cause);

      expect(large.amounts).toEqual(normal.amounts);
      expect(normal.amounts.every((text) => /^[\d,]+원$/.test(text))).toBe(true);
      expect(large.resultActions).toEqual(['보험 청구에 필요한 서류 확인', '계산 근거 보기', '치료 다시 선택', '보험 조건 수정', '처음으로', '이용 완료']);
      expect(large.resultActions).toEqual(normal.resultActions);
      expect(large.basisText).toBe(normal.basisText);
      expect(large.docs.map((doc) => doc.key)).toEqual([...NINE].sort());
      expect(large.docs).toEqual(normal.docs);
      expect(large.kindAfterBasis).toBe('normal');
      expect(large.kindAfterDocs).toBe('normal');
      expect(normal.largeAfterReset).toBe('false');
      expect(large.largeAfterReset, '초기화 뒤에는 큰 글자 보기가 꺼져 있다').toBe('false');
      expect(page.url().endsWith(KIOSK_PATH)).toBe(true);
    });
  }

  test('큰 글자 4단계에서 선택은 쪽을 넘겨도 유지된다: 네 치료를 두 쪽에 걸쳐 고르면 합계가 그대로다', async ({ page }) => {
    await openKiosk(page);
    await setLargeText(page, true);
    await startButton(page).click();
    await generationRadio(page, '2세대(C1)').check();
    await bottomButton(page, '다음').click();
    await page.getByRole('radio', { name: '손해보험사' }).check();
    await bottomButton(page, '다음').click();
    await page.getByRole('radio', { name: '다쳐서 왔어요 (상해)' }).check();
    await bottomButton(page, '다음').click();
    await expect(heading(page, TITLES.treatments)).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(2);
    await treatmentBox(page, TREATMENT.xray).check();
    await page.getByRole('button', { name: /다음 목록/ }).click();
    await treatmentBox(page, TREATMENT.kidney).check();
    await page.getByRole('button', { name: /이전 목록/ }).click();
    await expect(treatmentBox(page, TREATMENT.xray)).toBeChecked();
  });
});
