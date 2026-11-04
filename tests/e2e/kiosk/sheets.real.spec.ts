import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import { expectStartScreen, startButton } from '../helpers/kiosk';
import { TITLES, bottomButton, expectLayoutClean, heading, setLargeText } from '../helpers/input';
import { actionsOf, resultRoot, screenText } from '../helpers/results';
import { basisSheet, completeScreen, docsPagerNext, docsPagerStatus, openBasis, openDocuments, sheetBack, sheetComplete, visibleDocs } from '../helpers/sheets';

// 실제 핸들러 층 (SPEC-REIMBURSEMENT-001 M6 S3b, BRIEF D12): 시험용 앞단 서버가 /api/clinics/* 를 실제 핸들러(handleCatalog·handleOptions·handleEstimate)에 시험 자료(TEST_FIXTURE) 서비스로 맡긴다.
// 실제 핸들러 논리를 시험 자료의 세계로 돌린 것이며 운영 자료 검증이 아니다. 근거·서류 화면이 실제 계산 응답의 값(근거 단계·약관 출처·서류 줄)을 그대로 그리는지 본다.
// 오라클은 실제 응답 본문이다: 화면의 값은 응답에서 읽은 값과 같아야 한다(화면이 값을 계산하거나 지어내면 어긋난다).
//  - 병원 1: 규칙 묶음이 있어 정상(ESTIMATED) 응답, 서류 규칙 묶음(TEST_FIXTURE)이 있어 서류는 AVAILABLE. 이 세계에는 서류 규칙이 없는 병원이 없어 RULES_UNAVAILABLE 은 가로채기 층(sheets.intercept)이 본다.
// AC 대응: AC-014f(근거 내용) · AC-014c/g(서류 줄) · AC-007h/i(원인 모름·쪽 나눔) · AC-015f(이용 완료) · AC-010e(테스트 데이터 표시) · AC-013f.

const OK_SLUG = 'test-fixture-clinic-1';

interface RealBody {
  origin: string;
  result: {
    state: string;
    amounts: { hospitalPayment: number; expectedInsurancePayout: number; expectedOutOfPocketAfterPayout: number };
    basis: {
      profile: { policySources: Array<{ insurerDocumentId: string; revisionDate: string; clauseOrPage: string }> } | null;
      steps: Array<{ E: number; D: number; D_applied: number; L: number | 'UNLIMITED'; P: number; P_pooled: number }>;
    };
  };
  documents: { state: string; mode: string; lines: Array<{ line: string; required: boolean; scope?: string; reasons?: string[] }> };
}

const won = (value: number): string => `${value.toLocaleString('ko-KR')}원`;
const NAME: Readonly<Record<string, string>> = {
  DIAGNOSIS_CERT: '진단서',
  OUTPATIENT_CONFIRMATION: '통원확인서',
  TREATMENT_CONFIRMATION: '진료확인서',
  RECEIPT_AND_ITEMIZED: '영수증 · 세부내역서',
  INITIAL_EXAM_RECORD: '초진기록지',
  ADMISSION_DISCHARGE_CONFIRMATION: '입퇴원확인서',
  MEDICAL_OPINION: '소견서',
  IMAGING_READING: '판독지',
  BIOPSY_RESULT: '조직검사결과지',
};
const FIXED_ORDER = Object.keys(NAME);

/** 입력 4단계를 채우고 확인 직전까지 간다: 세대는 4세대(C4), 보험사 형태는 손해보험사, 원인은 causeIndex 번째 카드(0 상해 · 1 질병 · 2 모름), 치료는 앞에서 둘. */
async function fillToConfirm(page: Page, causeIndex: number, large: boolean): Promise<void> {
  await page.goto(`/kiosk/${OK_SLUG}`);
  await expectStartScreen(page);
  if (large) await setLargeText(page, true);
  await startButton(page).click();
  await expect(heading(page, TITLES.generation)).toBeVisible();
  await page.getByRole('radio').nth(4).check();
  await bottomButton(page, '다음').click();
  await expect(heading(page, TITLES.type)).toBeVisible();
  await page.getByRole('radio').first().check();
  await bottomButton(page, '다음').click();
  await expect(heading(page, TITLES.cause)).toBeVisible();
  await page.getByRole('radio').nth(causeIndex).check();
  await bottomButton(page, '다음').click();
  await expect(heading(page, TITLES.treatments)).toBeVisible();
  for (let index = 0; index < 2; index += 1) await page.getByRole('checkbox').nth(index).check();
}

async function confirm(page: Page): Promise<RealBody> {
  const response = page.waitForResponse((entry) => entry.url().endsWith('/estimate') && entry.request().method() === 'POST');
  await bottomButton(page, '예상 부담액 확인').click();
  const reply = await response;
  expect(reply.status()).toBe(200);
  const body = (await reply.json()) as RealBody;
  await expect(resultRoot(page)).toBeVisible();
  return body;
}

for (const large of [false, true]) {
  test.describe(large ? '큰 글자 보기' : '일반', () => {
    test('계산 근거: 화면의 표·단계·출처가 실제 응답의 값 그대로이고 테스트 데이터 표시가 있다 (AC-014f, AC-010e)', async ({ page }) => {
      await fillToConfirm(page, 0, large);
      const body = await confirm(page);
      expect(body.result.state).toBe('ESTIMATED');
      await openBasis(page);
      await expect(basisSheet(page)).toBeVisible();
      await expect(page.locator('[data-kiosk-test-data]')).toBeVisible();
      const [step] = body.result.basis.steps;
      expect(step).toBeDefined();
      if (step === undefined) return;
      const steps = page.locator('[data-basis-table="steps"]');
      await expect(steps).toContainText(won(step.E));
      await expect(steps).toContainText(`- ${won(step.D_applied)}`);
      await expect(steps).toContainText(step.L === 'UNLIMITED' ? '한도 없음' : won(step.L));
      await expect(steps.locator('tfoot')).toContainText(won(body.result.amounts.expectedInsurancePayout));
      await expect(page.locator('[data-basis-table="treatments"] tfoot')).toContainText(won(body.result.amounts.hospitalPayment));
      const source = body.result.basis.profile?.policySources[0];
      expect(source).toBeDefined();
      if (source === undefined) return;
      await expect(page.locator('[data-kiosk-panel="sources"]')).toContainText(source.insurerDocumentId);
      await expect(page.locator('[data-kiosk-panel="sources"]')).toContainText(source.clauseOrPage);
      await expect(page.locator('[data-kiosk-panel="sources"]')).toContainText('2026.01.01 개정');
      const text = await screenText(page);
      // 환자에게 보이지 않아야 하는 값: 확인자·확인일·규칙 id·내부 그룹 이름
      expect(text).not.toMatch(/TEST_FIXTURE_VERIFIER|TEST_FIXTURE_PROFILE|TEST_GROUP|TEST_FIXTURE_BUNDLE|환자분의 실손은|디자인 예시/);
      await expectLayoutClean(page, `실제 근거 ${large ? 'large' : 'normal'}`);
      await sheetBack(page).click();
      await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
    });

    for (const [cause, causeIndex, expected] of [
      ['상해', 0, 'documents'],
      ['질병', 1, 'documents'],
    ] as const) {
      test(`필요 서류(원인 ${cause}): 화면의 아홉 줄과 체크·사유가 실제 응답의 값 그대로다 (AC-014g, AC-007g)`, async ({ page }) => {
        await fillToConfirm(page, causeIndex, large);
        const body = await confirm(page);
        expect(body.documents.state).toBe('AVAILABLE');
        expect(body.documents.mode).toBe('SINGLE_CAUSE');
        await openDocuments(page, expected);
        const oracle = FIXED_ORDER.map((key) => {
          const line = body.documents.lines.find((entry) => entry.line === key);
          return { key, required: line?.required ?? false, reasons: line?.reasons ?? [] };
        });
        // 큰 글자 보기에서는 쪽으로 나뉜다: 쪽을 모두 이어서 본다.
        const seen: Array<{ key: string; required: boolean; reasons: string[] }> = [];
        for (let guard = 0; guard < 12; guard += 1) {
          seen.push(...(await visibleDocs(page)));
          if ((await docsPagerNext(page).count()) === 0 || (await docsPagerNext(page).getAttribute('aria-disabled')) === 'true') break;
          await docsPagerNext(page).click();
        }
        expect(seen).toEqual(oracle);
        if (large) await expect(docsPagerStatus(page)).toContainText('/');
        const text = await screenText(page);
        expect(text).not.toMatch(/환자분의 실손은|디자인 예시|1544|tel:/);
        for (const doc of seen) expect(NAME[doc.key]).toBeDefined();
        await expectLayoutClean(page, `실제 서류(${cause}) ${large ? 'large' : 'normal'}`);
      });
    }

    test('필요 서류(원인 모름): 범위별 묶음과 줄이 실제 응답의 값 그대로이고 아홉 줄이 한 번씩이다 (AC-007h·i)', async ({ page }) => {
      await fillToConfirm(page, 2, large);
      const body = await confirm(page);
      expect(body.documents.mode).toBe('UNKNOWN_CAUSE');
      await openDocuments(page, 'documents-unknown');
      const seen: string[] = [];
      const groups: Record<string, string[]> = { COMMON: [], INJURY_ONLY: [], ILLNESS_ONLY: [] };
      for (let guard = 0; guard < 12; guard += 1) {
        for (const scope of Object.keys(groups)) {
          const keys = await page.locator(`[data-doc-group="${scope}"] [data-doc-line]`).evaluateAll((items) => items.map((item) => item.getAttribute('data-doc-line') ?? ''));
          groups[scope]?.push(...keys);
          seen.push(...keys);
        }
        if ((await docsPagerNext(page).count()) === 0 || (await docsPagerNext(page).getAttribute('aria-disabled')) === 'true') break;
        await docsPagerNext(page).click();
      }
      expect([...seen].sort()).toEqual([...FIXED_ORDER].sort());
      for (const scope of ['COMMON', 'INJURY_ONLY', 'ILLNESS_ONLY']) {
        const fromBody = body.documents.lines.filter((line) => line.scope === scope).map((line) => line.line);
        expect([...(groups[scope] ?? [])].sort(), scope).toEqual([...fromBody].sort());
      }
      await expectLayoutClean(page, `실제 서류(모름) ${large ? 'large' : 'normal'}`);
    });

    test('이용 완료: 실제 흐름 끝에서 이용 완료 화면이고 "처음 화면으로" 뒤에는 빈 시작 화면이다 (AC-015f)', async ({ page }) => {
      await fillToConfirm(page, 0, large);
      await confirm(page);
      await actionsOf(page).filter({ hasText: '이용 완료' }).click();
      await expect(completeScreen(page)).toBeVisible();
      expect(await page.locator('.kiosk-root').innerText()).not.toMatch(/\d[\d,]*원/);
      await expect(page.locator('.kiosk-root')).toHaveAttribute('data-large-text', 'false');
      await expectLayoutClean(page, '실제 이용 완료');
      await page.getByRole('button', { name: '처음 화면으로' }).click();
      await expectStartScreen(page);
      await startButton(page).click();
      await expect(heading(page, TITLES.generation)).toBeVisible();
      expect(await page.getByRole('radio').evaluateAll((inputs) => inputs.some((input) => (input as HTMLInputElement).checked))).toBe(false);
    });

    test('근거 화면에서 이용 완료: 근거 화면에서도 같은 순서로 비우고 이용 완료 화면이 된다', async ({ page }) => {
      await fillToConfirm(page, 0, large);
      await confirm(page);
      await openBasis(page);
      await sheetComplete(page).click();
      await expect(completeScreen(page)).toBeVisible();
      await expect(basisSheet(page)).toHaveCount(0);
    });
  });
}
