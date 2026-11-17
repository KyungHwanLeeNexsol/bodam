import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import { holdResponse, notCoveredResponse } from '../../fixtures/kiosk/estimate-response.fixture';
import { ALL_SCREENS } from '../helpers/entries';
import { openKiosk, setLargeText } from '../helpers/input';
import { TREATMENT_ID, actionsOf, amountValue, reachResultScreen, resultRoot, screenText } from '../helpers/results';
import { reachResult } from '../helpers/sheets';

// 가로채기 층 (S4 G): 정책·문구 전수 검사. 모든 화면 상태 × 두 방향 × 일반/큰 글자에서 환자에게 보이는 글자와 이름(aria-label 등)·요소 종류를 실제 DOM 에서 읽어
// 내부 코드·"N" 같은 기호·설계 내부 설명·외부 링크·전화 연결·날짜 입력·직원 문의 단추·"1588"·지어낸 운영 정보가 없고, 값이 없는 금액이 0원으로 보이지 않음을 본다 (AC-012c·i, AC-013f, AC-017f).
// 결과 종류별 고정 문구와 동작 개수(AC-013a·b·c·e)는 두 방향·큰 글자에서 다시 본다. 이 층은 가로채기 응답으로 화면을 시험한 것이다.

interface Surface {
  readonly text: string;
  readonly textWithoutSummary: string;
  readonly names: string[];
  readonly html: string;
  readonly links: number;
  readonly inputTypes: string[];
  readonly otherControls: string[];
  readonly buttonLabels: string[];
  readonly staffButtons: number;
}

async function readSurface(page: Page): Promise<Surface> {
  return page.evaluate(() => {
    const root = document.querySelector('.kiosk-root') as HTMLElement;
    const visibleElements = Array.from(root.querySelectorAll<HTMLElement>('*')).filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    const names = new Set<string>();
    for (const element of visibleElements) {
      for (const attribute of ['aria-label', 'title', 'alt', 'placeholder', 'aria-description']) {
        const value = element.getAttribute(attribute);
        if (value !== null && value.trim() !== '') names.add(value.trim());
      }
    }
    const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]')).filter((element) => visibleElements.includes(element));
    const buttonLabels = buttons.map((button) => (button.innerText ?? '').replace(/\s+/g, ' ').trim());
    // 선택 요약(K03)은 고른 치료 값을 더한 합이라 아무것도 안 골랐을 때(0개)나 급여만 골랐을 때의 0원은 값이 없는 금액이 아니라 실제 합이다(디자인 K03_Treatments_Empty 가 "급여 0원 · 비급여 0원 · 0원"을 그린다).
    // "값이 없는 금액이 0원으로 보이지 않는다"는 결과·근거 화면의 금액에 대한 규칙이라 0원 검사는 선택 요약을 뺀 글로 한다.
    const withoutSummary = (): string => {
      const clone = root.cloneNode(true) as HTMLElement;
      for (const summary of Array.from(clone.querySelectorAll('.kiosk-summary'))) summary.remove();
      return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
    };
    return {
      textWithoutSummary: withoutSummary(),
      text: root.innerText.replace(/\s+/g, ' ').trim(),
      names: [...names],
      html: root.outerHTML,
      links: root.querySelectorAll('a, [href], [role="link"]').length,
      inputTypes: Array.from(root.querySelectorAll('input')).map((input) => input.type),
      otherControls: Array.from(root.querySelectorAll('select, textarea, [contenteditable="true"], [contenteditable=""], summary, [role="textbox"], [role="combobox"], [role="searchbox"]')).map((element) => element.tagName.toLowerCase()),
      buttonLabels,
      staffButtons: buttons.filter((button) => /직원에게 ?문의|상담/.test((button.innerText ?? '') + (button.getAttribute('aria-label') ?? ''))).length,
    };
  });
}

// 에러 화면의 고정 문장은 "0원"이라는 글자를 담지만 금액이 아니다(디자인 그대로). 이 문장만 빼고 센다.
const stripErrorSentence = (text: string): string => text.replace('예상 보험금이 0원이라는 뜻이 아닙니다', '');

/** 내부 코드: 대문자 스네이크(단, 시험 병원의 표시 이름에 쓰인 TEST_FIXTURE 는 제외), HTTP 상태 숫자(금액·쉼표 숫자 제외), 응답 구조 이름. */
const INTERNAL_CODE = /\b(?:PROFILE|MAPPING|LINE|CLASSIFICATION|CALC|RULE|CLINIC|VERSION|INTERNAL|UNSUPPORTED|NO_TREATMENT|TREATMENT|INVALID|ESTIMATED|ON_HOLD|RULES|GEN\d|NON_LIFE|MUTUAL|INJURY|ILLNESS|UNKNOWN|BENEFIT|OPERATING|DEMO)_?[A-Z0-9_]*\b|(?<![\d,.])[45]\d\d(?![\d,.]|원)|referenceGroup|requestId|refreshId/;
const SINGLE_N = /(?<![A-Za-z0-9])N(?![A-Za-z0-9])/;
const DESIGN_INTERNALS = /디자인 예시|구현 단계|Pencil|프레임|토큰|컴포넌트|TODO|TBD|lorem|placeholder|FIXME|@MX/i;
const INVENTED = /운영 ?시간|상담 ?시간|평일|주말|공휴일|\d{1,2}:\d{2}|고객센터|콜센터|상담원|협회|금융감독원|주식회사|㈜|경계 계약|별도 도움말/;

for (const large of [false, true]) {
  test.describe(`화면 전수 검사 - ${large ? '큰 글자 보기' : '일반'}`, () => {
    for (const entry of ALL_SCREENS) {
      test(`${entry.name}: 내부 코드·기호·설계 설명·링크·전화·날짜 입력·직원 문의 단추·1588·지어낸 운영 정보가 없고 0원으로 보이는 빈 금액이 없다`, async ({ page }) => {
        const api = await openKiosk(page);
        if (large) await setLargeText(page, true);
        await entry.reach(page, api);
        if (large && entry.relargeAfterReach === true) await setLargeText(page, true);
        const surface = await readSurface(page);
        const visible = `${surface.text}\n${surface.names.join('\n')}`.replace(/TEST_FIXTURE/g, '');

        expect(surface.text.length, `${entry.name}: 화면 글을 읽지 못했다`).toBeGreaterThan(10);
        expect(visible, `${entry.name}: 내부 코드`).not.toMatch(INTERNAL_CODE);
        expect(visible, `${entry.name}: "N" 같은 기호`).not.toMatch(SINGLE_N);
        expect(visible, `${entry.name}: 설계 내부 설명`).not.toMatch(DESIGN_INTERNALS);
        expect(visible, `${entry.name}: 지어낸 운영 정보`).not.toMatch(INVENTED);
        expect(visible, `${entry.name}: 1588`).not.toContain('1588');
        expect(stripErrorSentence(surface.textWithoutSummary), `${entry.name}: 0원`).not.toMatch(/(?<![\d,])0원/);

        // 링크·전화: 요소가 없고 문자열도 없다. 1544-8069 가 있으면 문장 속 글자일 뿐이다(단추·링크 안에 있지 않다).
        expect(surface.links, `${entry.name}: 링크 요소`).toBe(0);
        expect(surface.html, `${entry.name}: tel:/mailto:/http`).not.toMatch(/tel:|mailto:|sms:|https?:\/\//i);
        // AC-016f 의 M6 증거(M7 이 관리자 로그인 뒤 접속까지 포함해 닫는다): 관리자 경로 링크·표지가 화면 어디에도 없다.
        expect(surface.html, `${entry.name}: 관리자 경로·표지`).not.toMatch(/\/admin|admin|관리자 로그인/i);
        if (surface.text.includes('1544-8069')) expect(surface.buttonLabels.join('\n'), `${entry.name}: 번호가 단추 안에 있다`).not.toContain('1544-8069');
        // 입력 요소: 선택 카드(radio·checkbox)뿐이다. 날짜·글자·전화·숫자 입력, 선택 상자, 글 상자가 없다.
        expect(surface.inputTypes.filter((type) => type !== 'radio' && type !== 'checkbox'), `${entry.name}: 허용 밖의 입력 종류`).toEqual([]);
        expect(surface.otherControls, `${entry.name}: select·textarea 등`).toEqual([]);
        expect(surface.staffButtons, `${entry.name}: "직원에게 문의"·상담 단추`).toBe(0);
      });
    }
  });

  test.describe(`결과 종류별 고정 문구와 동작 - ${large ? '큰 글자 보기' : '일반'}`, () => {
    test('정상: "예시 계산"·표준 가정 문장·개인 계약 문장이 있고 동작은 정확히 여섯이다', async ({ page }) => {
      const api = await openKiosk(page);
      if (large) await setLargeText(page, true);
      await reachResultScreen(page, api, 'K04_Result');
      const text = await screenText(page);
      expect(text).toContain('예시 계산');
      expect(text).toContain('표준 공제·한도 가정으로 계산한 예상 금액입니다.');
      expect(text).toContain('개인별 부담보, 면책·보장기간, 잔여 한도·횟수, 치료 목적 및 심사 결과에 따라 실제 지급액이 달라질 수 있습니다.');
      expect(await actionsOf(page).allInnerTexts()).toEqual(['보험 청구에 필요한 서류 확인', '계산 근거 보기', '치료 다시 선택', '보험 조건 수정', '처음으로', '이용 완료']);
    });

    test('보장 제외: 같은 고정 문구가 있고 동작은 정확히 여섯이며 "선택한 치료가 모두 보장 대상" 문장이 없다', async ({ page }) => {
      const api = await openKiosk(page);
      if (large) await setLargeText(page, true);
      await reachResult(page, api, notCoveredResponse());
      const text = await screenText(page);
      expect(text).toContain('예시 계산');
      expect(text).toContain('표준 공제·한도 가정으로 계산한 예상 금액입니다.');
      expect(text).toContain('개인별 부담보, 면책·보장기간, 잔여 한도·횟수, 치료 목적 및 심사 결과에 따라 실제 지급액이 달라질 수 있습니다.');
      expect(text).not.toContain('선택한 치료가 모두 보장 대상');
      expect(await actionsOf(page).allInnerTexts()).toEqual(['보험 청구에 필요한 서류 확인', '계산 근거 보기', '치료 다시 선택', '보험 조건 수정', '처음으로', '이용 완료']);
    });

    test('보류: 병원 결제액만 숫자이고 나머지 둘은 "확인 필요", 동작은 정확히 넷이며 결과 문구 원칙·예시 계산이 없다', async ({ page }) => {
      const api = await openKiosk(page);
      if (large) await setLargeText(page, true);
      await reachResult(
        page,
        api,
        holdResponse([
          [TREATMENT_ID.xray, 'MAPPING_ABSENT'],
          [TREATMENT_ID.ultrasound, 'PROFILE_VALUE_MISSING'],
        ]),
      );
      await expect(resultRoot(page)).toHaveAttribute('data-result', 'hold');
      await expect(amountValue(page, 'hospital')).toHaveText(/^[\d,]+원$/);
      await expect(amountValue(page, 'payout')).toHaveText('확인 필요');
      await expect(amountValue(page, 'after')).toHaveText('확인 필요');
      const text = await screenText(page);
      expect(text).not.toContain('표준 공제·한도 가정으로 계산한 예상 금액입니다');
      expect(text).not.toContain('예시 계산');
      expect(text).toContain('개인별 부담보, 면책·보장기간, 잔여 한도·횟수, 치료 목적 및 심사 결과에 따라 실제 지급액이 달라질 수 있습니다.');
      expect(await actionsOf(page).allInnerTexts()).toEqual(['치료 다시 선택', '보험 조건 수정', '처음으로', '이용 완료']);
    });
  });
}

test.describe('숨은 터치로 관리자 기능이 열리지 않는다 (AC-016f 의 M6 증거, M7 이 닫는다)', () => {
  test('시작 화면의 로고·병원 이름·서비스 이름·네 모서리를 빠르게 연속으로 눌러도 화면·주소·요청·쿠키가 그대로다', async ({ page }) => {
    const api = await openKiosk(page);
    const before = { url: page.url(), calls: api.calls.length, cookies: (await page.context().cookies()).length };
    const size = page.viewportSize() ?? { width: 1080, height: 1920 };
    const spots = [
      page.locator('.kiosk-brand-mark').first(),
      page.locator('.kiosk-wordmark').first(),
      page.locator('.kiosk-hospital').first(),
      page.locator('.kiosk-k00__wordmark'),
    ];
    for (let round = 0; round < 6; round += 1) {
      for (const spot of spots) await spot.click({ force: true, delay: 0 });
      for (const [x, y] of [[4, 4], [size.width - 4, 4], [4, size.height - 4], [size.width - 4, size.height - 4]] as const) await page.mouse.click(x, y);
    }
    await page.keyboard.press('Control+Alt+A');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '시작하기' })).toBeVisible();
    expect(page.url()).toBe(before.url);
    expect(api.calls.length).toBe(before.calls);
    expect((await page.context().cookies()).length).toBe(before.cookies);
    expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toMatch(/admin/i);
  });
});

test.describe('K01: 세대 카드는 정확히 다섯 장이고 미리 선택된 것이 없다 (AC-012i)', () => {
  test('입력 화면 1 에 세대 카드 다섯, 선택됨 0, 6번째 카드 없음, 날짜 입력 없음', async ({ page }) => {
    const api = await openKiosk(page);
    const entry = ALL_SCREENS.find((candidate) => candidate.name === 'K01_Generation_Empty');
    await entry?.reach(page, api);
    await expect(page.getByRole('radio')).toHaveCount(5);
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(page.locator('input[type="date"], input[type="text"], input[type="tel"], input[type="number"]')).toHaveCount(0);
  });
});
