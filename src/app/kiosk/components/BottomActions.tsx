import type { ReactNode } from 'react';

// 하단 고정 동작 막대 (디자인 BottomActions `o0pE7Y`: 이전(300 폭) + 주 버튼(나머지), 간격 24 이상). 버튼은 호출하는 화면이 Button 으로 넘긴다.
//  - lead: 가로형 막대 왼쪽의 남는 자리(디자인 "Bottom Spacer"). K03 가로형은 여기에 합계 두 줄이 온다.
//  - three: 버튼이 셋(처음으로·이전·주 버튼)일 때 보조 버튼 폭을 줄인다. 디자인 프레임에는 K02 이후 "처음으로"가 없어 이 단계가 더한 자리다(파생) — 보고 참고.
//  - sheet: 근거·서류 화면의 셋(처음으로·결과로 돌아가기·이용 완료). 라벨 길이가 서로 달라 보조 둘이 같은 폭을 나눠 쓴다(S3b, 파생: 디자인 프레임은 결과로 돌아가기·이용 완료 둘이다).
//  - stack: 세로로 쌓는 변형(통신 오류 화면). 큰 글자 보기에서 한 줄에 들어가지 않는 경우는 CSS 가 줄바꿈으로 처리한다(동작을 빼지 않고 배치만 바꾼다, DD-12).

export function BottomActions({ children, stack = false, three = false, sheet = false, lead }: { readonly children: ReactNode; readonly stack?: boolean; readonly three?: boolean; readonly sheet?: boolean; readonly lead?: ReactNode }) {
  const classes = ['kiosk-bottom-actions', ...(stack ? ['kiosk-bottom-actions--stack'] : []), ...(three ? ['kiosk-bottom-actions--three'] : []), ...(sheet ? ['kiosk-bottom-actions--sheet'] : [])].join(' ');
  return (
    <div className={classes}>
      {lead === undefined ? null : <div className="kiosk-bottom-actions__lead">{lead}</div>}
      {children}
    </div>
  );
}
