import { COPY } from '../view/copy';

// 단계 표시 (디자인 StepIndicator, 구현 명세: "step 속성 하나를 받는 컴포넌트"). 4단계 + "n / 4".
// 지난 단계(done)·지금 단계(current)·남은 단계(upcoming)는 색뿐 아니라 번호 원의 채움·굵기와 aria-current 로도 구분된다.
// 대기(K00)와 결과(K04)는 단계 숫자에 포함하지 않는다.

export type StepNumber = 1 | 2 | 3 | 4;
const TOTAL = COPY.steps.length;

export function StepIndicator({ step }: { readonly step: StepNumber }) {
  return (
    <nav className="kiosk-steps" aria-label={COPY.stepsLabel}>
      <ol className="kiosk-steps__list">
        {COPY.steps.map((label, index) => {
          const number = index + 1;
          const status = number < step ? 'done' : number === step ? 'current' : 'upcoming';
          return (
            <li key={label} className="kiosk-steps__entry">
              {index === 0 ? null : <span className="kiosk-steps__connector" aria-hidden="true" />}
              <span className={status === 'upcoming' ? 'kiosk-steps__item' : `kiosk-steps__item kiosk-steps__item--${status}`} aria-current={status === 'current' ? 'step' : undefined}>
                <span className="kiosk-steps__num">{number}</span>
                <span className="kiosk-steps__label">{label}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <span className="kiosk-steps__counter">{`${step} / ${TOTAL}`}</span>
    </nav>
  );
}
