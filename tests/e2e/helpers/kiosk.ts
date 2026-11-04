import { expect } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';

// 시험 자료(TEST_FIXTURE). 키오스크 화면 시험의 공통 도구: 병원 slug, 화면 찾기, 방향.
// 화면 이름(K00_Start 등)은 환자에게 보이지 않으므로 DOM 의 기능 표지(역할·글자·data-kiosk-*)로 찾는다.

/** 가로채기·실제 핸들러 층이 쓰는 시험 병원 slug. catalog 응답의 clinic.slug 와 같아야 키오스크가 받아들인다. */
export const SLUG = 'test-fixture-clinic-1';
export const KIOSK_PATH = `/kiosk/${SLUG}`;

export const root = (page: Page): Locator => page.locator('.kiosk-root');
export const startButton = (page: Page): Locator => page.getByRole('button', { name: '시작하기' });
export const dialog = (page: Page): Locator => page.getByRole('dialog');

export function isLandscape(testInfo: TestInfo): boolean {
  return testInfo.project.name.endsWith('landscape');
}

/** 시작 화면이 떴다: 시작하기 버튼이 있고 근거·서류·이용 완료 화면이 아니다. */
export async function expectStartScreen(page: Page): Promise<void> {
  await expect(startButton(page)).toBeVisible();
  await expect(page.locator('[data-sheet], [data-kiosk-state="COMPLETE"]')).toHaveCount(0);
}

/** 1단계(세대 선택) 화면이 떴다. */
export async function expectK01(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '내 실손보험을 선택해 주세요' })).toBeVisible();
}

/** 세대 카드(라디오). 카드의 접근 가능한 이름은 options 응답의 label 이다. */
export const generationRadio = (page: Page, label = '2세대(C1)'): Locator => page.getByRole('radio', { name: label });

/** 밑 화면(겹침창이 열려 있어도 inert 덮개 안)의 "처음으로" 버튼. */
export const underlayHome = (page: Page): Locator => page.locator('.kiosk-underlay button', { hasText: '처음으로' });
