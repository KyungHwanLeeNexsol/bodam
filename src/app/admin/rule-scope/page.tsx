import { RuleScope } from '../RuleScope';

// /admin/rule-scope — 플랫폼 운영자(PO)가 병원마다 어떤 규칙 묶음으로 계산할지 한 곳씩 지정한다. 묶음을 게시하는 조작은 없다.
// 접근 판정과 자료는 /api/admin/rule-scope 가 한다.

export const dynamic = 'force-dynamic';

export default function AdminRuleScopePage() {
  return <RuleScope />;
}
