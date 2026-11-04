import type { Page } from '@playwright/test';

// 시험 자료(TEST_FIXTURE). 그려진 화면의 글자 대비 측정 (S4 D1, AC-017g): 토큰 값으로 계산하지 않고 실제 DOM 의 계산된 색을 읽는다.
//  - 글자색(알파·opacity 반영)과 "바로 뒤 배경"(조상으로 올라가며 투명하지 않은 배경색을 겹쳐 얻은 색)의 WCAG 대비를 잰다.
//  - 큰 글자 기준 3:1: 글자 크기 24px 이상, 또는 굵게(700 이상) 18.66px 이상. 그 밖은 4.5:1.
//  - 예외(AC-017g): 로고(브랜드 마크·워드마크), 정보가 없는 장식(글자가 없다), 실제로 비활성인 조작 요소(aria-disabled="true"). 그 밖의 모든 글자 요소를 잰다.
//  - 배경에 그림·그라데이션이 있어 한 색으로 정할 수 없는 글자는 "측정 불가"로 따로 보고하고 통과로 세지 않는다.
// 겹침창이 열려 있으면 inert 밑 화면은 환자 눈에 가려져 있으므로 대상이 아니다.

export interface ContrastItem {
  readonly text: string;
  readonly selector: string;
  readonly fg: string;
  readonly bg: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly large: boolean;
  readonly required: number;
  readonly ratio: number;
  readonly pass: boolean;
}

export interface ContrastReport {
  readonly measured: ContrastItem[];
  readonly unmeasurable: Array<{ text: string; selector: string; reason: string }>;
  readonly exempt: Array<{ text: string; selector: string; reason: string }>;
}

export async function measureContrast(page: Page): Promise<ContrastReport> {
  return page.evaluate(() => {
    type Rgba = [number, number, number, number];
    const root = document.querySelector('.kiosk-root');
    const report: { measured: unknown[]; unmeasurable: Array<{ text: string; selector: string; reason: string }>; exempt: Array<{ text: string; selector: string; reason: string }> } = { measured: [], unmeasurable: [], exempt: [] };
    if (root === null) return report as never;

    const parse = (value: string): Rgba => {
      const match = /rgba?\(([^)]+)\)/.exec(value);
      if (match === null) return [0, 0, 0, 0];
      const parts = (match[1] ?? '').split(/[ ,/]+/).filter((part) => part !== '');
      const [r, g, b] = parts.slice(0, 3).map(Number) as [number, number, number];
      const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number(parts[3]);
      return [r, g, b, alpha];
    };
    const over = (top: Rgba, bottom: Rgba): Rgba => {
      const alpha = top[3] + bottom[3] * (1 - top[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      const mix = (a: number, b: number): number => (a * top[3] + b * bottom[3] * (1 - top[3])) / alpha;
      return [mix(top[0], bottom[0]), mix(top[1], bottom[1]), mix(top[2], bottom[2]), alpha];
    };
    const luminance = ([r, g, b]: Rgba): number => {
      const channel = (value: number): number => {
        const s = value / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ratioOf = (a: Rgba, b: Rgba): number => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    const selectorOf = (element: Element): string => {
      const first = typeof element.className === 'string' ? element.className.split(' ')[0] : '';
      return `${element.tagName.toLowerCase()}${first ? `.${first}` : ''}`;
    };
    const visible = (element: Element): boolean => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const hex = (c: Rgba): string => `#${[c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

    for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      if (element.closest('[inert]') !== null || !visible(element)) continue;
      const own = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      if (own === '') continue;
      const text = own.slice(0, 40);
      const selector = selectorOf(element);

      // 로고는 서비스 이름 글자(그라데이션 글자)와 브랜드 마크뿐이다. 서비스 설명("실손보험 예상 부담액 안내")은 로고가 아니라 안내 글이라 잰다.
      if (element.closest('.kiosk-wordmark__name, .kiosk-k00__wordmark, .kiosk-brand-mark') !== null) {
        report.exempt.push({ text, selector, reason: '로고(워드마크)' });
        continue;
      }
      // 잠긴 카드(갱신이 진행 중인 동안 치료 카드, AC-020i)는 label 안의 입력이 aria-disabled 이고 카드 전체가 흐려진다.
      if (element.closest('[aria-disabled="true"], :disabled') !== null || element.closest('label')?.querySelector(':scope > input[aria-disabled="true"]') != null) {
        report.exempt.push({ text, selector, reason: '실제로 비활성인 조작 요소' });
        continue;
      }
      // 화면 낭독기 전용 글(clip 으로 감춘 것)은 눈에 보이지 않는다.
      if (element.closest('.kiosk-sr-only') !== null) continue;

      const style = getComputedStyle(element);
      // 글자색: 요소와 조상의 opacity 를 알파에 곱한다.
      let opacity = 1;
      for (let node: Element | null = element; node !== null; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      const fgRaw = parse(style.color);
      const fg: Rgba = [fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * opacity];

      // 바로 뒤 배경: 위에서 아래(조상 방향)로 투명하지 않은 색이 나올 때까지 모아 겹친다.
      const layers: Rgba[] = [];
      let unresolved: string | null = null;
      for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const nodeStyle = getComputedStyle(node);
        if (nodeStyle.backgroundImage !== 'none') {
          unresolved = `배경 이미지·그라데이션(${selectorOf(node)})`;
          break;
        }
        const bg = parse(nodeStyle.backgroundColor);
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] >= 1) break;
      }
      if (unresolved !== null) {
        report.unmeasurable.push({ text, selector, reason: unresolved });
        continue;
      }
      let bg: Rgba = [255, 255, 255, 1];
      for (const layer of layers.reverse()) bg = over(layer, bg);
      bg = [bg[0], bg[1], bg[2], 1];
      const flat = over(fg, bg);
      const fontSize = Number.parseFloat(style.fontSize);
      const fontWeight = Number(style.fontWeight);
      const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const required = large ? 3 : 4.5;
      const ratio = ratioOf(flat, bg);
      report.measured.push({ text, selector, fg: hex(flat), bg: hex(bg), fontSize, fontWeight, large, required, ratio: Math.round(ratio * 100) / 100, pass: ratio >= required });
    }
    return report as never;
  }) as Promise<ContrastReport>;
}
