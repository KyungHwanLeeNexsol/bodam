import { TypeCard } from '../components/ChoiceCards';
import { InputScreen } from '../components/InputScreen';
import { useKiosk } from '../runtime/kiosk-context';
import { canGoNext } from '../state/selectors';
import { COPY } from '../view/copy';
import { StepFooter } from './StepFooter';

// 3/4 치료 원인 K02b_Cause (디자인 K02b_Cause_Empty/_Selected, L_K02b_Cause). 카드 셋: 상해·질병·"잘 모르겠어요"는 모두 options 응답 그대로다.
// "잘 모르겠어요"도 하나의 선택값(UNKNOWN)이다: 계산 금액은 달라지지 않고 서류 안내가 상해·질병 두 갈래로 나뉜다(안내 문장, M5 상태 기계가 서류 화면을 K07_Documents_Unknown 으로 보낸다).

export function K02bCause() {
  const { state, send } = useKiosk();
  return (
    <InputScreen
      step={3}
      kind="type"
      title={COPY.input.cause.title}
      subtitle={COPY.input.cause.subtitle}
      aside={<p className="kiosk-input__hint">{COPY.input.cause.hint}</p>}
      footer={
        <StepFooter
          primaryLabel={COPY.buttons.next}
          primaryDisabled={!canGoNext(state)}
          onPrimary={() => {
            send({ type: 'NEXT' });
          }}
        />
      }
    >
      <div role="radiogroup" aria-label={COPY.input.cause.title} className="kiosk-input__list">
        {state.clinic.options.causes.map((card) => (
          <TypeCard
            key={card.code}
            group="kiosk-cause"
            label={card.label}
            help={card.help}
            selected={state.inputs.cause === card.code}
            onSelect={() => {
              send({ type: 'SELECT_CAUSE', code: card.code });
            }}
          />
        ))}
      </div>
    </InputScreen>
  );
}
