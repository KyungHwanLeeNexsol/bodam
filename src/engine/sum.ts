import type { PublishedLine } from './types';

// 그룹의 보장 대상 비용 합계 (design.md DD-02, DD-24).
// G = 그룹 안의 급여 줄 합, N = 비급여 줄 합, E = G + N. 보류 줄과 확인된 제외 줄은 호출하는 쪽이 미리 뺀다.

export interface GroupShares {
  G: number;
  N: number;
  E: number;
}

/**
 * 줄 금액은 입력 검증을 통과한 0 이상 MAX_AMOUNT_WON 이하의 정수이고, 부분합은 병원 결제액 T 이하다.
 * T 는 이미 검사 합산으로 안전 정수임이 확인되었으므로 여기서는 일반 덧셈이 넘칠 수 없다(DD-24 "한도·지급 단계").
 */
export function sumGroupShares(lines: readonly PublishedLine[]): GroupShares {
  let G = 0;
  let N = 0;
  for (const line of lines) {
    if (line.benefitType === 'BENEFIT') {
      G += line.patientAmount;
    } else {
      N += line.patientAmount;
    }
  }
  return { G, N, E: G + N };
}
