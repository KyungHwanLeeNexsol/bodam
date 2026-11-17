import { COPY } from '../view/copy';
import { Icon } from './icons';

// 키오스크 상단 (디자인 KioskHeader·Wordmark·BrandMark, 구현 명세: 서비스명은 이 컴포넌트에서만 관리).
// 서비스명은 catalog.serviceDisplayName, 병원명은 catalog.clinic.displayName 이다. 서비스 설명 "실손보험 예상 부담액 안내"는 고정 문구다.
// "큰 글자 보기"는 상태가 있을 때만 있다(자료를 받기 전 화면에는 컨트롤러가 없어 켤 상태가 없다).
// 디자인의 토글은 높이가 약 58px 라서 터치 영역 하한 72 CSS px(D15, plan.md §E #29)에 맞춰 키웠다.

export interface LargeTextToggle {
  readonly pressed: boolean;
  readonly onToggle: () => void;
}

export function BrandMark({ hero = false }: { readonly hero?: boolean }) {
  return (
    <span className={hero ? 'kiosk-brand-mark kiosk-brand-mark--hero' : 'kiosk-brand-mark'} aria-hidden="true">
      <Icon name="heart-pulse" size={hero ? 88 : 38} />
    </span>
  );
}

export function KioskHeader({ serviceName, hospitalName, largeText }: { readonly serviceName: string; readonly hospitalName?: string | undefined; readonly largeText?: LargeTextToggle | undefined }) {
  return (
    <header className="kiosk-header">
      <div className="kiosk-wordmark">
        <BrandMark />
        <div className="kiosk-wordmark__text">
          <span className="kiosk-wordmark__name">{serviceName}</span>
          <span className="kiosk-wordmark__desc">{COPY.serviceDescription}</span>
        </div>
      </div>
      <div className="kiosk-header__right">
        {hospitalName === undefined ? null : (
          <div className="kiosk-hospital">
            <Icon name="building-2" size={28} />
            <span className="kiosk-hospital__name">{hospitalName}</span>
          </div>
        )}
        {largeText === undefined ? null : (
          <button type="button" className="kiosk-toggle" aria-pressed={largeText.pressed} onClick={largeText.onToggle}>
            {largeText.pressed ? <Icon name="check" size={30} /> : <Icon name="a-large-small" size={30} />}
            <span>{COPY.largeTextToggle}</span>
          </button>
        )}
      </div>
    </header>
  );
}
