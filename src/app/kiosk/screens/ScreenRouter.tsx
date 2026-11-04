import { useEffect, useRef } from 'react';
import { useKiosk } from '../runtime/kiosk-context';
import { K04BasisCalculation } from './BasisScreen';
import { CalculatingScreen } from './CalculatingScreen';
import { K06Complete } from './CompleteScreen';
import { K07Documents, K07DocumentsUnknown } from './DocumentsScreens';
import { K00Start } from './K00Start';
import { K01Generation } from './K01Generation';
import { K01GenerationHelp } from './K01GenerationHelp';
import { K02Type } from './K02Type';
import { K02bCause } from './K02bCause';
import { K03Treatments } from './K03Treatments';
import { NetworkErrorScreen } from './NetworkErrorScreen';
import { K04Result, K04ResultHold, K04ResultNotCovered } from './ResultScreens';

// 화면 상태 → 화면 (SPEC-REIMBURSEMENT-001 M6, BRIEF D14). state.screen 의 열다섯 값을 모두 적는다: 새 화면 상태가 생기면 컴파일이 막는다.
// 열다섯 화면이 모두 자기 화면이다(S3b 로 임시 화면이 없다): 시작·입력 4단계(+세대 확인 안내)·계산 중·결과 셋·통신 오류·계산 근거·필요 서류 둘·이용 완료.
// 화면이 바뀌면(단계 이동·시작·초기화) 초점을 새 화면의 대표 제목으로 옮긴다: 누른 버튼이 사라져 초점이 문서 처음으로 돌아가면 키보드 사용자가 머리글부터 다시 지나가야 한다.
// 겹침창이 열려 있는 동안 밑 화면이 바뀌어도(요청·갱신 결말) 초점을 빼앗지 않는다: 겹침창이 닫힐 때 OverlayHost 가 초점을 돌려준다.

export function ScreenRouter() {
  const { state } = useKiosk();
  const previous = useRef(state.screen);
  const overlayOpen = state.overlay.kind !== 'NONE';
  useEffect(() => {
    if (previous.current === state.screen) return;
    previous.current = state.screen;
    if (!overlayOpen) document.querySelector<HTMLElement>('[data-kiosk-primary]')?.focus();
  }, [state.screen, overlayOpen]);

  switch (state.screen) {
    case 'K00_Start':
      return <K00Start />;
    case 'K01_Generation':
      return <K01Generation />;
    case 'K01_Generation_Unknown':
      return <K01GenerationHelp />;
    case 'K02_Type':
      return <K02Type />;
    case 'K02b_Cause':
      return <K02bCause />;
    case 'K03_Treatments':
      return <K03Treatments />;
    case 'Calculating':
      return <CalculatingScreen />;
    case 'K04_Result':
      return <K04Result />;
    case 'K04_Result_NotCovered':
      return <K04ResultNotCovered />;
    case 'K04_Result_Hold':
      return <K04ResultHold />;
    case 'KXX_Error_Network':
      return <NetworkErrorScreen />;
    case 'K04_Basis_Calculation':
      return <K04BasisCalculation />;
    case 'K07_Documents':
      return <K07Documents />;
    case 'K07_Documents_Unknown':
      return <K07DocumentsUnknown />;
    case 'K06_Complete':
      return <K06Complete />;
  }
}
