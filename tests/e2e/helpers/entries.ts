import type { Page } from '@playwright/test';
import type { ApiMock } from './api';
import { INPUT_SCREENS, reachScreen } from './screens';
import { RESULT_SCREENS, reachResultScreen } from './results';
import { SHEET_SCREENS, reachSheetScreen } from './sheets';

// 시험 자료(TEST_FIXTURE). 모든 화면 상태(시작 화면 + 입력 단계 + 결과 쪽 + 근거·서류·이용 완료)를 한 목록으로 돈다. 화면 전수 검사(S4)가 쓴다.

export interface ScreenEntry {
  readonly name: string;
  readonly reach: (page: Page, api: ApiMock) => Promise<void>;
  /** 이용 완료 화면은 전체 삭제로 큰 글자가 꺼지므로 이 화면에서 다시 켠다. */
  readonly relargeAfterReach?: boolean;
}

export const ALL_SCREENS: readonly ScreenEntry[] = [
  { name: 'K00_Start', reach: async () => undefined },
  ...INPUT_SCREENS.map((name): ScreenEntry => ({ name, reach: (page, api) => reachScreen(page, api, name) })),
  ...RESULT_SCREENS.map((name): ScreenEntry => ({ name, reach: (page, api) => reachResultScreen(page, api, name) })),
  ...SHEET_SCREENS.map((name): ScreenEntry => ({ name, reach: (page, api) => reachSheetScreen(page, api, name), relargeAfterReach: name === 'K06_Complete' })),
];
