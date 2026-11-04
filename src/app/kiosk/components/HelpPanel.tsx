import type { ReactNode } from 'react';
import { Icon } from './icons';

// 안내 패널 (디자인 HelpPanel `PxiwY`: accent-soft 바탕, info 아이콘, 제목 + 본문 + 선택 동작). 안내 문장은 문자로만 있고 링크·전화 연결이 없다(AC-012h).

export function HelpPanel({ title, lines, children }: { readonly title: string; readonly lines: readonly string[]; readonly children?: ReactNode }) {
  return (
    <section className="kiosk-help" aria-label={title}>
      <div className="kiosk-help__title">
        <Icon name="info" size={34} />
        <h2 className="kiosk-help__heading">{title}</h2>
      </div>
      <div className="kiosk-help__body">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      {children}
    </section>
  );
}
