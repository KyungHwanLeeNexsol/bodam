import { ReviewQueue } from '../ReviewQueue';

// /admin/review-queue — 검토 담당자(RV)가 보는 모든 병원의 처리 전 검토 요청. 읽기 전용이다. 접근 판정과 자료는 /api/admin/review-queue 가 한다.

export const dynamic = 'force-dynamic';

export default function AdminReviewQueuePage() {
  return <ReviewQueue />;
}
