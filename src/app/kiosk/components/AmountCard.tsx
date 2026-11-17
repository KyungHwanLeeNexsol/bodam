import type { CSSProperties } from 'react';
import type { AmountView } from '../view/result-view';

// 금액 카드 (디자인 AmountCard `w7KgfH`: 이름 + 큰 금액 + 보조 설명). 결과 화면의 세 금액이 이 컴포넌트 하나다.
//  - tone: 병원 결제액(navy 테두리, 오늘 창구에서 내는 돈) / 예상 보험금(success) / 수령 후 부담(accent). 색에만 기대지 않고 카드마다 이름·보조 설명이 뜻을 말한다.
//  - 값이 없는 금액("확인 필요")은 색을 입히지 않은 중립 모양이다: 계산된 금액처럼 보이지 않게 한다(보류 결과).
//  - 금액 글자는 카드 폭에 맞춰 줄어든다: CSS 가 글자 수(--kiosk-chars)와 카드의 내부 폭(컨테이너 단위)으로 크기의 상한을 정한다. 아주 큰 금액도 잘리거나 넘치지 않는다.
//  - `note` 뒤에 붙는 `extra` 는 병원 결제액의 급여·비급여 내역이다(세로형만, 디자인 K04_Result).
// 시도 식별자 같은 값은 속성에 싣지 않는다. data-kiosk-amount 는 화면 종류를 가리킬 뿐이다.

export type AmountTone = 'hospital' | 'payout' | 'after';

export function AmountCard({ tone, amount, extra }: { readonly tone: AmountTone; readonly amount: AmountView; readonly extra?: string | null | undefined }) {
  const style = { '--kiosk-chars': amount.text.length } as CSSProperties;
  return (
    <div className={`kiosk-amount kiosk-amount--${tone}${amount.known ? '' : ' kiosk-amount--unknown'}`} role="group" aria-label={amount.label} data-kiosk-block data-kiosk-amount={tone} data-known={amount.known ? 'true' : 'false'}>
      <p className="kiosk-amount__label">{amount.label}</p>
      <p className="kiosk-amount__value" style={style}>
        {amount.text}
      </p>
      <p className="kiosk-amount__note">{extra === undefined || extra === null ? amount.note : `${amount.note} ${extra}`}</p>
    </div>
  );
}
