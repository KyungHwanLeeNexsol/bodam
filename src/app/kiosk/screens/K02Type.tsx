import { TypeCard } from '../components/ChoiceCards';
import { InputScreen } from '../components/InputScreen';
import { useKiosk } from '../runtime/kiosk-context';
import { canGoNext } from '../state/selectors';
import { COPY } from '../view/copy';
import { StepFooter } from './StepFooter';

// 2/4 보험사 형태 K02_Type (디자인 K02_Type_Empty/_Selected, L_K02_Type). 카드는 options 응답의 형태 카드 그대로(3장)이고 보험사 이름 목록·검색·추가 질문이 없다.
// 고르기 전에는 "다음"이 비활성(AC-012b), "이전"은 앞 화면으로 돌아가며 선택을 유지한다(AC-012g). "접수 직원에게 문의해 주세요"는 문장일 뿐 버튼이 아니다(AC-012c).

export function K02Type() {
  const { state, send } = useKiosk();
  return (
    <InputScreen
      step={2}
      kind="type"
      title={COPY.input.type.title}
      aside={<p className="kiosk-input__hint">{COPY.input.type.hint}</p>}
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
      <div role="radiogroup" aria-label={COPY.input.type.title} className="kiosk-input__list">
        {state.clinic.options.insurerTypes.map((card) => (
          <TypeCard
            key={card.code}
            group="kiosk-insurer-type"
            label={card.label}
            help={card.help}
            selected={state.inputs.insurerType === card.code}
            onSelect={() => {
              send({ type: 'SELECT_INSURER_TYPE', code: card.code });
            }}
          />
        ))}
      </div>
    </InputScreen>
  );
}
