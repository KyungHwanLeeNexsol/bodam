'use client';

import { createContext, useContext } from 'react';
import type { DispatchResult } from '../state/controller';
import type { KioskEvent } from '../state/events';
import type { KioskState } from '../state/session-store';

// 화면이 상태를 읽고 사건을 보내는 길 (SPEC-REIMBURSEMENT-001 M6, BRIEF D3·D14).
// 화면은 컨트롤러를 직접 만지지 않고 이 값만 받는다: state(바꾸지 않는 값), send(사건 보내기), read(지금 시각이 필요한 표시 값, 예: 남은 시간).
// 상태 해석은 state/selectors·display 의 함수로만 한다. 화면이 보험 계산이나 상태 전이를 따로 갖지 않는다.

export interface KioskContextValue {
  readonly state: KioskState;
  send(event: KioskEvent): DispatchResult;
  /** 현재 상태와 deps.now() 기준의 지금 시각으로 값을 읽는다(컨트롤러의 select). 표시 전용이라 사건을 보내지 않는다. */
  read<T>(selector: (state: KioskState, now: number) => T): T;
}

export const KioskContext = createContext<KioskContextValue | null>(null);

export function useKiosk(): KioskContextValue {
  const value = useContext(KioskContext);
  if (value === null) throw new Error('KioskContext 밖에서 상태를 읽었다');
  return value;
}
