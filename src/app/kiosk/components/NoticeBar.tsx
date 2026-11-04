import type { ReactNode } from 'react';
import { Icon } from './icons';

// 안내 막대 (디자인 NoticeBar: surface-alt 바탕, shield-alert 아이콘, 22px 본문). 의료기관 안내·약관 근거를 작은 글자만으로 제공하지 않는다(기획서 §13.1)는 뜻에서 본문은 fs-label 이상이다.
//  - `paragraphs`: 문단이 둘 이상인 안내(결과 화면의 결과 문구 원칙 + 공통 안내). 없으면 children 한 문단이다.
//  - `result`: 결과 화면의 안내는 디자인에서 26px(가로 24px)로 크게 그렸다(NoticeBar 인스턴스의 글자 크기 덮어쓰기).

export interface NoticeBarProps {
  readonly children?: ReactNode;
  readonly paragraphs?: readonly string[] | undefined;
  readonly result?: boolean | undefined;
}

export function NoticeBar({ children, paragraphs, result = false }: NoticeBarProps) {
  return (
    <div className={result ? 'kiosk-notice kiosk-notice--result' : 'kiosk-notice'} role="note" data-kiosk-block>
      <Icon name="shield-alert" size={32} />
      {paragraphs === undefined ? (
        <p className="kiosk-notice__text">{children}</p>
      ) : (
        <div className="kiosk-notice__text kiosk-notice__text--paragraphs">
          {paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      )}
    </div>
  );
}
