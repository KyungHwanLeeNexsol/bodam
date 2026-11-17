import { IdlePolicy } from '../../IdlePolicy';

// /admin/{clinicId}/idle-policy — 병원 관리자(HA)가 자기 병원의 무조작 시간(화면 종류별 경고·초기화, 이용 완료 자동 복귀)을 고친다. 병원 id 는 경로의 위치 정보일 뿐 권한이 아니다: 접근 판정은 서버가 검증한 소속으로만 한다.

export const dynamic = 'force-dynamic';

export default async function AdminIdlePolicyPage({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  return <IdlePolicy key={clinicId} clinicId={clinicId} />;
}
