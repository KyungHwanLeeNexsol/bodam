import { ClinicSettings } from '../../ClinicSettings';

// /admin/{clinicId}/settings — 병원 관리자(HA)가 자기 병원의 병원명·상담번호를 고친다. 병원 id 는 경로의 위치 정보일 뿐 권한이 아니다: 접근 판정은 서버가 검증한 소속으로만 한다.

export const dynamic = 'force-dynamic';

export default async function AdminClinicSettingsPage({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  return <ClinicSettings key={clinicId} clinicId={clinicId} />;
}
