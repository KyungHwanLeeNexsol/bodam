import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KioskContext } from '../../../src/app/kiosk/runtime/kiosk-context';
import type { KioskContextValue } from '../../../src/app/kiosk/runtime/kiosk-context';
import type { KioskEvent } from '../../../src/app/kiosk/state/events';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';

// 시험 자료(TEST_FIXTURE). 화면 시험의 서버 렌더링 도구: 화면 하나를 주어진 상태로 그려 마크업 문자열을 돌려준다(react-dom/server, 효과는 돌지 않는다).
// 사건은 보낸 것을 기록만 한다. 상태 전이 자체는 tests/kiosk/state 가 시험한다.

export interface Rendered {
  readonly html: string;
  readonly sent: KioskEvent[];
}

export function renderWithState(state: KioskState, element: ReactElement, now = 0): Rendered {
  const sent: KioskEvent[] = [];
  const value: KioskContextValue = {
    state,
    send: (event) => {
      sent.push(event);
      return 'APPLIED';
    },
    read: (selector) => selector(state, now),
  };
  const html = renderToStaticMarkup(<KioskContext.Provider value={value}>{element}</KioskContext.Provider>);
  return { html, sent };
}

export const render = (element: ReactElement): string => renderToStaticMarkup(element);

/** 마크업 안 단추(<button>)들의 보이는 글자. 아이콘(svg)은 글자가 없다. */
export function buttonLabels(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/gs)].map((match) => (match[1] ?? '').replace(/<[^>]+>/g, '').trim());
}

/** 마크업에서 태그를 걷어낸 글. */
export function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
