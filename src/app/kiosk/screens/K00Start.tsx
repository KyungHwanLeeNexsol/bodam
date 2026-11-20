import { useKiosk } from '../runtime/kiosk-context';
import { renderK00StartLayout } from './K00StartLayout';

// 시작 화면 K00_Start (디자인 K00_Start u5CZTt · L_K00_Start rOtWw, 큰 글자 보기는 반응형: DD-12).
// 지워야 할 환자 데이터가 없는 화면이다: 무조작 타이머가 없고 이전 금액·선택이 보이지 않는다(AC-012a). "시작하기"는 언제나 빈 세션으로 K01 을 연다(START).
// 세로형은 흐름 칩이 한 줄이고 시작 동작이 하단 막대다. 가로형과 큰 글자 보기는 칩이 세로 목록이고 이름 뒤에 "선택"이 붙는다(L_K00_Start).
// 이 화면에는 "처음으로"가 없다(DD-13: 지울 것이 없다). "큰 글자 보기"는 상단 공통 영역에 있다.

export function K00Start() {
  const { state, send } = useKiosk();
  const { catalog } = state.clinic;
  return renderK00StartLayout({
    serviceName: catalog.serviceDisplayName,
    hospitalName: catalog.clinic.displayName,
    stack: state.display.orientation === 'LANDSCAPE' || state.display.largeText,
    onStart: () => send({ type: 'START' }),
  });
}
