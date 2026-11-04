import { AdminHome } from './AdminHome';

// /admin — 로그인한 신원의 병원 목록으로 가는 입구. 서버 컴포넌트는 아무 자료도 읽지 않는다(인증·권한 판정과 자료는 /api/admin/** 가 한다).

export const dynamic = 'force-dynamic';

export default function AdminIndexPage() {
  return <AdminHome />;
}
