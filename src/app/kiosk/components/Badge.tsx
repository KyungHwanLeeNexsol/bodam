import type { ReactNode } from 'react';

// 배지 (디자인 Badge: blue-soft 바탕, 22px 굵게). 급여·비급여·예시 계산·통신 오류 같은 짧은 표시다. 색에만 기대지 않고 글자가 뜻을 담는다.

export type BadgeTone = 'default' | 'warn' | 'danger' | 'success';

export function Badge({ children, tone = 'default' }: { readonly children: ReactNode; readonly tone?: BadgeTone }) {
  return <span className={tone === 'default' ? 'kiosk-badge' : `kiosk-badge kiosk-badge--${tone}`}>{children}</span>;
}
