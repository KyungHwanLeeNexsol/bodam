import { BottomActions } from '../components/BottomActions';
import { Button } from '../components/Button';
import { GenerationCard } from '../components/ChoiceCards';
import { HelpPanel } from '../components/HelpPanel';
import { InputScreen } from '../components/InputScreen';
import { useKiosk } from '../runtime/kiosk-context';
import { canGoNext } from '../state/selectors';
import { COPY } from '../view/copy';
import { guidanceLines } from '../view/input-view';

// 1/4 실손보험 선택 K01_Generation (디자인 K01_Generation_Empty/_Selected, L_K01_Generation, 큰 글자 보기는 반응형: DD-12).
//  - 카드는 options 응답의 세대 카드 그대로다(5장). 가입일 입력도, 세대 자동 추정도, 미리 선택된 카드도 없다(AC-012i). 고르기 전에는 "다음"이 비활성이다(AC-012b).
//  - "세대를 모르겠어요"와 "가입 시기를 모르실 때" 패널은 계산 요청 없이 세대 확인 안내 화면(K01_Generation_Unknown)으로 간다(AC-012d). 안내 문장은 응답의 guidance 문장 그대로다.
//  - 이 화면의 왼쪽 아래 동작은 "이전"이 아니라 "처음으로"다(디자인 프레임).

export function K01Generation() {
  const { state, send } = useKiosk();
  const { generations, guidance } = state.clinic.options;
  const openHelp = (): void => {
    send({ type: 'OPEN_GENERATION_HELP' });
  };
  return (
    <InputScreen
      step={1}
      kind="generation"
      title={COPY.input.generation.title}
      subtitle={COPY.input.generation.subtitle}
      aside={
        <>
          <Button variant="secondary" block icon="circle-question-mark" iconSize={34} className="kiosk-input__unknown" onClick={openHelp}>
            {COPY.input.generation.unknownButton}
          </Button>
          <HelpPanel title={COPY.input.generation.helpTitle} lines={guidanceLines(guidance.generationUnknown)}>
            <Button variant="secondary" block className="kiosk-help__action" onClick={openHelp}>
              {COPY.input.generation.helpAction}
            </Button>
          </HelpPanel>
          {/* 경계 계약 도움말은 문구 확정 전이다(§E #35). 버튼이 아닌 한 줄 안내이며 세대를 정하거나 제안하지 않는다. */}
          <p className="kiosk-input__pending-note" data-kiosk-boundary-pending>
            {COPY.input.generation.boundaryPending}
          </p>
        </>
      }
      footer={
        <BottomActions>
          <Button
            variant="secondary"
            icon="chevron-left"
            onClick={() => {
              send({ type: 'REQUEST_HOME' });
            }}
          >
            {COPY.buttons.home}
          </Button>
          <Button
            variant="primary"
            icon="chevron-right"
            disabled={!canGoNext(state)}
            onClick={() => {
              send({ type: 'NEXT' });
            }}
          >
            {COPY.buttons.next}
          </Button>
        </BottomActions>
      }
    >
      <div role="radiogroup" aria-label={COPY.input.generation.title} className="kiosk-input__list">
        {generations.map((card) => (
          <GenerationCard
            key={card.code}
            card={card}
            selected={state.inputs.generation === card.code}
            onSelect={() => {
              send({ type: 'SELECT_GENERATION', code: card.code });
            }}
          />
        ))}
      </div>
    </InputScreen>
  );
}
