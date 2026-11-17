import { Icon } from './icons';
import type { IconName } from './icons';
import { ScrollRegion } from './ScrollRegion';

// 상태 안내의 가운데 본문 (디자인 KXX_Loading_Calculating·KXX_Error_Network 의 "Body": 원형 아이콘 + 제목 + 설명 + 작은 안내).
// 병원 자료를 받는 중·못 받음(NonReadyScreens)과 계산 중·통신 오류(S3a)가 같은 모양을 쓴다. 제목은 화면의 대표 제목이라 초점 복귀 표지를 가진다.
// 설명(body)은 줄바꿈(\n)을 그대로 보인다(CSS white-space: pre-line). 오류 코드·HTTP 상태·금액을 이 모양에 싣지 않는다.

export interface StatusBodyProps {
  readonly icon: IconName;
  readonly tone?: 'danger' | 'warn';
  readonly title: string;
  readonly body: string;
  /** 설명 아래의 작은 안내(디자인 "Loading Note"). */
  readonly note?: string;
  readonly spin?: boolean;
  /** 진한 파랑 원에 흰 아이콘(디자인 K06_Complete 의 완료 표시). 기본은 옅은 원이다. */
  readonly solid?: boolean;
}

export function StatusBody({ icon, tone, title, body, note, spin = false, solid = false }: StatusBodyProps) {
  return (
    <ScrollRegion as="section" className="kiosk-status">
      <span className={tone === undefined ? (solid ? 'kiosk-status__icon kiosk-status__icon--solid' : 'kiosk-status__icon') : `kiosk-status__icon kiosk-status__icon--${tone}`}>
        <Icon name={icon} size={88} className={spin ? 'kiosk-spin' : undefined} />
      </span>
      <h1 className="kiosk-status__title" tabIndex={-1} data-kiosk-primary>
        {title}
      </h1>
      <p className="kiosk-status__body">{body}</p>
      {note === undefined ? null : <p className="kiosk-status__note">{note}</p>}
    </ScrollRegion>
  );
}
