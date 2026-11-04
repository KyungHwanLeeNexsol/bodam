import { TreatmentPrices } from '../../TreatmentPrices';

// /admin/{clinicId}/treatments — 치료 가격 수정·초안·미리보기·게시 화면. 병원 id 는 경로의 위치 정보일 뿐 권한이 아니다: 접근 판정은 서버가 검증한 소속으로만 한다.

export const dynamic = 'force-dynamic';

export default async function AdminTreatmentsPage({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  return <TreatmentPrices key={clinicId} clinicId={clinicId} />;
}
