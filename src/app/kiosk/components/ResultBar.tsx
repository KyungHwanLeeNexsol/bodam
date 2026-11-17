import type { ReactNode } from 'react';

// 상태 막대 (디자인 KXX_Error_Network 의 "Result Bar" 와 K04 의 "예상 결과 안내" 막대: accent-soft 바탕, 왼쪽 제목, 오른쪽 배지).
// 연결 상태·결과 종류를 한 줄로 알린다. 배지는 호출하는 쪽이 Badge 로 넘긴다(결과 화면은 둘까지: "예시 계산" + "일부 항목 보장 제외").

export function ResultBar({ label, badge }: { readonly label: string; readonly badge?: ReactNode }) {
  return (
    <div className="kiosk-result-bar">
      <span className="kiosk-result-bar__label">{label}</span>
      {badge === undefined || badge === null ? null : <span className="kiosk-result-bar__badges">{badge}</span>}
    </div>
  );
}
