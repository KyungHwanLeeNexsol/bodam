import { useId } from 'react';
import { splitGenerationLabel, formatPeriod, benefitLabel } from '../view/input-view';
import { COPY } from '../view/copy';
import { formatWon } from '../view/format';
import type { CatalogTreatmentDto, GenerationCardDto } from '../state/api-types';
import { Badge } from './Badge';
import { ChoiceCard, RadioMark } from './ChoiceCard';
import { Icon } from './icons';

// 단계별 선택 카드 셋 (디자인 GenerationCard `gRhLQ`·InsuranceTypeCard `u6jYfi`·TreatmentCard `PS9Py`). 카드는 응답의 값을 그릴 뿐이고 선택은 호출하는 화면이 사건으로 보낸다.

export function GenerationCard({ card, selected, onSelect }: { readonly card: GenerationCardDto; readonly selected: boolean; readonly onSelect: () => void }) {
  const id = useId();
  const { name, badge } = splitGenerationLabel(card.label);
  return (
    <ChoiceCard type="radio" name="kiosk-generation" variant="generation" selected={selected} onChange={onSelect} ariaLabel={card.label} describedBy={`${id}-period`}>
      {badge === null ? null : (
        <span className="kiosk-choice__chip" aria-hidden="true">
          {badge}
        </span>
      )}
      <span className="kiosk-choice__body">
        <span className="kiosk-choice__name" aria-hidden="true">
          {name}
        </span>
        <span className="kiosk-choice__desc" id={`${id}-period`}>
          {formatPeriod(card.period)}
        </span>
      </span>
      <RadioMark selected={selected} label={COPY.input.selected} />
    </ChoiceCard>
  );
}

/** 보험사 형태·치료 원인 카드(제목 + 한 줄 설명). `group` 이 라디오 묶음 이름이다. */
export function TypeCard({ group, label, help, selected, onSelect }: { readonly group: string; readonly label: string; readonly help: string; readonly selected: boolean; readonly onSelect: () => void }) {
  const id = useId();
  return (
    <ChoiceCard type="radio" name={group} variant="type" selected={selected} onChange={onSelect} labelledBy={`${id}-name`} describedBy={`${id}-desc`}>
      <span className="kiosk-choice__body">
        <span className="kiosk-choice__name" id={`${id}-name`}>
          {label}
        </span>
        <span className="kiosk-choice__desc" id={`${id}-desc`}>
          {help}
        </span>
      </span>
      <RadioMark selected={selected} label={COPY.input.selected} />
    </ChoiceCard>
  );
}

export function TreatmentCard({ treatment, selected, locked, onToggle }: { readonly treatment: CatalogTreatmentDto; readonly selected: boolean; readonly locked: boolean; readonly onToggle: () => void }) {
  const id = useId();
  return (
    <ChoiceCard type="checkbox" variant="treatment" selected={selected} locked={locked} onChange={onToggle} labelledBy={`${id}-name`} describedBy={`${id}-desc ${id}-price`}>
      <span className="kiosk-choice__box" aria-hidden="true">
        {selected ? <Icon name="check" size={40} /> : null}
      </span>
      <span className="kiosk-choice__body">
        <span className="kiosk-choice__top">
          <Badge tone={treatment.benefitType === 'BENEFIT' ? 'default' : 'warn'}>{benefitLabel(treatment.benefitType)}</Badge>
          <span className="kiosk-choice__name" id={`${id}-name`}>
            {treatment.displayName}
          </span>
        </span>
        <span className="kiosk-choice__desc kiosk-choice__desc--small" id={`${id}-desc`}>
          {[treatment.description, treatment.priceCondition].filter((text) => text.trim() !== '').join(' · ')}
        </span>
      </span>
      <span className="kiosk-choice__amount" id={`${id}-price`}>
        <span className="kiosk-choice__price">{formatWon(treatment.patientAmount)}</span>
        <span className="kiosk-choice__caption">{COPY.input.treatments.priceCaption}</span>
      </span>
    </ChoiceCard>
  );
}
