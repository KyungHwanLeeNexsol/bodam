import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveDeps } from '../state/deps';
import type { CatalogDto, OptionsDto } from '../state/api-types';
import { loadClinicData } from './load-clinic-data';
import type { ClinicLoadOutcome } from './load-clinic-data';

// 병원 자료 받기의 화면 쪽 껍질 (SPEC-REIMBURSEMENT-001 M6, BRIEF D2). 받는 일 자체는 load-clinic-data.ts 가 한다.
// 병원이 바뀌거나 화면이 사라지면 진행 중인 시도를 취소하고 그 결과는 쓰지 않는다(React Strict Mode 가 효과를 두 번 돌려도 마지막 시도만 반영된다).
// "다시 시도"는 이 받기를 처음부터 다시 한다. M5 의 갱신 생명주기가 아니다.

export type BootstrapState =
  | { readonly status: 'LOADING' }
  | { readonly status: 'READY'; readonly catalog: CatalogDto; readonly options: OptionsDto }
  | { readonly status: 'NO_TREATMENTS'; readonly catalog: CatalogDto }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'LOAD_FAILED' };

const LOADING: BootstrapState = { status: 'LOADING' };

/** 받기의 결말을 화면 상태로 바꾼다. 결말 다섯 가지가 화면 상태 다섯 가지에 하나씩 대응한다(FAILED → LOAD_FAILED). */
export function bootstrapStateOf(outcome: ClinicLoadOutcome): BootstrapState {
  switch (outcome.kind) {
    case 'READY':
      return { status: 'READY', catalog: outcome.catalog, options: outcome.options };
    case 'NO_TREATMENTS':
      return { status: 'NO_TREATMENTS', catalog: outcome.catalog };
    case 'NOT_FOUND':
      return { status: 'NOT_FOUND' };
    case 'FAILED':
      return { status: 'LOAD_FAILED' };
  }
}

export function useBootstrap(slug: string): { readonly state: BootstrapState; readonly retry: () => void } {
  const [state, setState] = useState<BootstrapState>(LOADING);
  const [attempt, setAttempt] = useState(0);
  // 의존성을 주입하지 않는 기본 전송·타이머. 부를 때마다 전역을 찾으므로 한 번만 만든다.
  const deps = useRef(resolveDeps({}));

  useEffect(() => {
    const abort = new AbortController();
    void loadClinicData(deps.current, slug, abort.signal).then((outcome) => {
      if (!abort.signal.aborted) setState(bootstrapStateOf(outcome));
    });
    return () => abort.abort();
  }, [slug, attempt]);

  const retry = useCallback(() => {
    setState(LOADING);
    setAttempt((value) => value + 1);
  }, []);

  return { state, retry };
}
