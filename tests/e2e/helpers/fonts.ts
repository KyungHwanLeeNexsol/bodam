import type { Page } from '@playwright/test';

// 시험 자료(TEST_FIXTURE). 실제로 쓰인 글꼴을 CDP(CSS.getPlatformFontsForNode)로 읽는다 (BRIEF D7). CSS 의 font-family 문자열이 아니라 브라우저가 글자를 그리는 데 쓴 글꼴이다.
// isCustomFont 가 true 이면 웹 글꼴(@font-face)이고, false 이면 기기에 설치된 글꼴이다.

export interface PlatformFont {
  readonly familyName: string;
  readonly isCustomFont: boolean;
  readonly glyphCount: number;
}

export async function platformFonts(page: Page, selector: string): Promise<PlatformFont[]> {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root } = await client.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts.map((font) => ({ familyName: font.familyName, isCustomFont: font.isCustomFont, glyphCount: font.glyphCount }));
  } finally {
    await client.detach();
  }
}
