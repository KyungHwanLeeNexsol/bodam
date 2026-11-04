import { KioskApp } from '../KioskApp';

// 키오스크 화면의 유일한 경로: /kiosk/{clinicSlug} (SPEC-REIMBURSEMENT-001 M6, BRIEF D1, AC-016a·AC-016d·AC-021g).
// 단계마다 주소가 바뀌지 않는다(history 항목이 쌓이지 않는다). 이 서버 컴포넌트는 병원 자료를 읽지 않는다: 자료는 키오스크가 /api/clinics/{slug}/… 로 받는다.
// 요청마다 새로 렌더링하고(force-dynamic) 문서 응답은 Cache-Control: no-store 이다(next.config.mjs 의 headers).
// key={clinicSlug}: 병원이 바뀌면 클라이언트 트리 전체(컨트롤러 포함)를 새로 만든다.

export const dynamic = 'force-dynamic';

export default async function KioskPage({ params }: { params: Promise<{ clinicSlug: string }> }) {
  const { clinicSlug } = await params;
  return <KioskApp key={clinicSlug} clinicSlug={clinicSlug} />;
}
