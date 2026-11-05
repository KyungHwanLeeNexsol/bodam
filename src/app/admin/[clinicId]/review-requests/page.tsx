import { ReviewRequests } from '../../ReviewRequests';

// /admin/{clinicId}/review-requests — 병원 관리자의 보장 검토 요청 화면. 병원 id 는 경로의 위치 정보일 뿐 권한이 아니다: 접근 판정은 서버가 검증한 소속으로만 한다.

export const dynamic = 'force-dynamic';

export default async function AdminReviewRequestsPage({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  return <ReviewRequests key={clinicId} clinicId={clinicId} />;
}
