import { Button } from '../components/Button';
import { Icon } from '../components/icons';
import { ScrollRegion } from '../components/ScrollRegion';
import { StepIndicator } from '../components/StepIndicator';
import { useKiosk } from '../runtime/kiosk-context';
import { COPY } from '../view/copy';

// 세대 확인 안내 K01_Generation_Unknown (디자인 K01_Generation_Unknown `p1nNbK`, 기획서 §4 화면 1, AC-012d).
// 계산 요청이 없고 결과 상태가 아니다. 1544-8069 는 문장으로만 있고 링크·전화 연결이 없으며 "키오스크에서 전화가 걸리지는 않습니다"가 그 사실을 알린다.
// 돌아가기 버튼 하나만 있다: 세대를 임의로 고르거나 치료비 합계만 보는 길이 없다. 이 화면의 무조작 정책은 안내·오류와 같다(100초 경고, 120초 초기화).

export function K01GenerationHelp() {
  const { send } = useKiosk();
  const copy = COPY.input.generationHelp;
  return (
    <div className="kiosk-input kiosk-help-screen">
      <StepIndicator step={1} />
      <ScrollRegion as="section" className="kiosk-status kiosk-help-screen__body">
        <span className="kiosk-status__icon">
          <Icon name="circle-question-mark" size={88} />
        </span>
        <h1 className="kiosk-status__title" tabIndex={-1} data-kiosk-primary>
          {copy.title}
        </h1>
        <p className="kiosk-status__body">{copy.body}</p>
        <ol className="kiosk-help-steps">
          {copy.steps.map((step, index) => (
            <li key={step.title} className="kiosk-help-steps__item">
              <span className="kiosk-help-steps__number" aria-hidden="true">
                {index + 1}
              </span>
              <span className="kiosk-help-steps__text">
                <span className="kiosk-help-steps__title">{step.title}</span>
                <span className="kiosk-help-steps__desc">{step.desc}</span>
              </span>
            </li>
          ))}
        </ol>
      </ScrollRegion>
      <div className="kiosk-status__actions">
        <Button
          variant="primary"
          block
          icon="chevron-left"
          onClick={() => {
            send({ type: 'CLOSE_GENERATION_HELP' });
          }}
        >
          {copy.back}
        </Button>
      </div>
    </div>
  );
}
