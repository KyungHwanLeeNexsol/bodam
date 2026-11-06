import { ChangeHistory } from '../../ChangeHistory';

// /admin/{clinicId}/change-history — 병원 관리자(HA)가 자기 병원의 변경 이력(카탈로그 초안 저장·폐기·게시, 무조작 시간 저장)을 읽는다. 읽기 전용이다.
// 병원 id 는 경로의 위치 정보일 뿐 권한이 아니다: 접근 판정과 병원 결정은 서버가 검증한 소속으로만 한다(화면은 이 id 를 서버 요청에 싣지 않는다).

export const dynamic = 'force-dynamic';

export default async function AdminChangeHistoryPage({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  return <ChangeHistory key={clinicId} clinicId={clinicId} />;
}
