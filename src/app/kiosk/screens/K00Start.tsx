import { Button } from '../components/Button';
import { Icon } from '../components/icons';
import { BrandMark } from '../components/KioskHeader';
import { ScrollRegion } from '../components/ScrollRegion';
import { useKiosk } from '../runtime/kiosk-context';
import { COPY } from '../view/copy';

// 시작 화면 K00_Start (디자인 K00_Start u5CZTt · L_K00_Start rOtWw, 큰 글자 보기는 반응형: DD-12).
// 지워야 할 환자 데이터가 없는 화면이다: 무조작 타이머가 없고 이전 금액·선택이 보이지 않는다(AC-012a). "시작하기"는 언제나 빈 세션으로 K01 을 연다(START).
// 세로형은 흐름 칩이 한 줄이고 시작 동작이 하단 막대다. 가로형과 큰 글자 보기는 칩이 세로 목록이고 이름 뒤에 "선택"이 붙는다(L_K00_Start).
// 이 화면에는 "처음으로"가 없다(DD-13: 지울 것이 없다). "큰 글자 보기"는 상단 공통 영역에 있다.

export function K00Start() {
  const { state, send } = useKiosk();
  const { catalog } = state.clinic;
  const stack = state.display.orientation === 'LANDSCAPE' || state.display.largeText;
  return (
    <div className={stack ? 'kiosk-k00 kiosk-k00--stack' : 'kiosk-k00'}>
      <ScrollRegion className="kiosk-k00__body">
        <section className="kiosk-k00__hero">
          <BrandMark hero />
          <h1 className="kiosk-k00__wordmark" tabIndex={-1} data-kiosk-primary>
            {catalog.serviceDisplayName}
          </h1>
          <p className="kiosk-k00__service">{COPY.serviceDescription}</p>
          <div className="kiosk-k00__divider" aria-hidden="true" />
          <p className="kiosk-k00__hospital">{catalog.clinic.displayName}</p>
        </section>
        <div className="kiosk-k00__panel">
          <p className="kiosk-k00__guide">{COPY.start.guide}</p>
          <ol className="kiosk-k00__flow" aria-label={COPY.start.flowLabel}>
            {COPY.steps.flatMap((label, index) => [
              ...(index === 0 || stack
                ? []
                : [
                    <li key={`arrow-${label}`} className="kiosk-k00__arrow" aria-hidden="true">
                      <Icon name="chevron-right" size={30} />
                    </li>,
                  ]),
              <li key={label} className="kiosk-k00__chip">
                <span>{index + 1}</span>
                <span>{stack ? (COPY.start.stackedSteps[index] ?? label) : label}</span>
              </li>,
            ])}
          </ol>
          <div className="kiosk-k00__actions">
            <Button
              variant="primary"
              block
              icon="chevron-right"
              iconSize={44}
              className="kiosk-k00__start"
              onClick={() => {
                send({ type: 'START' });
              }}
            >
              {COPY.start.startButton}
            </Button>
            <p className="kiosk-k00__hint">{COPY.start.hint}</p>
          </div>
        </div>
      </ScrollRegion>
    </div>
  );
}
