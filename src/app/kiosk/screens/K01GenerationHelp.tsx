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
        {/* 경계 계약 도움말은 문구 확정 전이다(§E #35). 버튼이 아닌 한 줄 안내이며 세대를 정하거나 제안하지 않는다. 2026-11-04 소유자 지시로 세대 선택 화면이 아니라 이 도움말에 둔다.
            가로 방향에서도 스크롤 없이 보이도록 단계 목록 위, 본문 바로 아래에 둔다. */}
        <p className="kiosk-help-screen__pending" data-kiosk-boundary-pending>
          {COPY.input.generation.boundaryPending}
        </p>
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
