import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

// 시험 자료(TEST_FIXTURE). 화면 목록 사진 도구 (BRIEF D12): 환경 변수 SHOTS=1 일 때만 .moai/state/shots/<화면>-<방향>-<일반|큰글자>.png 를 쓴다.
// SHOTS 가 없으면 아무것도 하지 않는다(사진이 시험 결과나 증거가 아니다 - 육안 검토용 자료일 뿐이다).

export const SHOTS_ENABLED = process.env.SHOTS === '1';
export const SHOTS_DIR = path.resolve('.moai/state/shots');

export function shotName(screen: string, testInfo: TestInfo, large: boolean): string {
  const orientation = testInfo.project.name.endsWith('landscape') ? 'landscape' : 'portrait';
  return `${screen}-${orientation}-${large ? 'large' : 'normal'}.png`;
}

/** SHOTS=1 일 때만 현재 화면(뷰포트 전체)을 저장한다. 저장한 경로를 돌려주고, 꺼져 있으면 null. */
export async function shot(page: Page, testInfo: TestInfo, screen: string, large: boolean): Promise<string | null> {
  if (!SHOTS_ENABLED) return null;
  mkdirSync(SHOTS_DIR, { recursive: true });
  const file = path.join(SHOTS_DIR, shotName(screen, testInfo, large));
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  return file;
}
