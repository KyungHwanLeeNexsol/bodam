import { BundlePublish } from '../BundlePublish';

// /admin/bundles — 검토 담당자(RV)가 기준 묶음에 승인된 매핑을 더해 새 규칙 묶음을 미리보고 게시한다. 게시는 어느 병원에도 적용되지 않는다.
// 접근 판정과 자료는 /api/admin/bundle-publish 가 한다.

export const dynamic = 'force-dynamic';

export default function AdminBundlesPage() {
  return <BundlePublish />;
}
