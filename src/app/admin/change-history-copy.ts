// 변경 이력 화면 문구 (SPEC-REIMBURSEMENT-001 M7 변경 이력). **시험용 문구이며 최종 문구가 아니다** — 최종 문구 승인이 아니다(plan.md §E 의 관리자 문구는 소유자 확인 전).
// 이 화면은 읽기 전용이다. 어느 문구도 "모든 변경 이력"을 보여 준다고 말하지 않고, 기록에 없는 과거 금액이나 상세 내용을 아는 것처럼 말하지 않는다.

import { ADMIN_COPY } from './copy';

export const CHANGE_COPY = {
  navChangeHistory: '변경 이력',
  title: '변경 이력',
  subtitle: '우리 병원에서 카탈로그 초안을 저장·폐기·게시하거나 무조작 시간을 저장한 기록을 최신순으로 읽습니다.',
  loading: ADMIN_COPY.loading,
  retry: ADMIN_COPY.retry,
  clinicLabel: ADMIN_COPY.clinicLabel,
  readOnlyNote: '읽기 전용 화면입니다. 기록은 이 화면에서 고치거나 지우거나 되돌릴 수 없습니다.',
  noDetailNote: '기록에는 바뀐 금액 같은 상세 내용이 들어 있지 않습니다. 이전·이후 칸에는 기록된 버전 또는 내용 지문만 보이며, 지금의 데이터로 과거 값을 짐작해 채우지 않습니다.',
  scopeNotice: (labels: readonly string[]): string =>
    `이 화면은 다음 동작의 기록만 보여 줍니다: ${labels.join(' · ')}. 모든 변경 이력이 아닙니다. 치료 분류·검토 요청·규칙 묶음 등 다른 동작의 기록, 검토 담당자와 플랫폼 운영자의 기록, 소유를 확인할 수 없는 기록은 보이지 않습니다.`,
  listTitle: '기록',
  empty: '표시할 변경 기록이 아직 없습니다.',
  truncated: (returned: number, total: number): string => `가장 최근 ${returned}건만 보여 줍니다 (전체 ${total}건). 더 오래된 기록은 이 화면에서 볼 수 없습니다.`,
  colSequence: '번호',
  colAt: '기록 시각',
  colActor: '수행자',
  colAction: '동작',
  colTarget: '대상',
  colBefore: '이전',
  colAfter: '이후',
  colReason: '기록된 사유',
  noReason: '기록된 사유 없음',
  noVersion: '없음',
  versionCatalog: '카탈로그 버전',
  versionDigest: '내용 지문',
  actions: {
    CATALOG_DRAFT_SAVE: '카탈로그 초안 저장',
    CATALOG_DRAFT_DISCARD: '카탈로그 초안 폐기',
    CATALOG_DRAFT_PUBLISH: '카탈로그 초안 게시',
    IDLE_POLICY_SAVE: '무조작 시간 저장',
  } as Readonly<Record<string, string>>,
  targets: {
    CATALOG_DRAFT_SAVE: '카탈로그 초안',
    CATALOG_DRAFT_DISCARD: '카탈로그 초안',
    CATALOG_DRAFT_PUBLISH: '게시된 카탈로그',
    IDLE_POLICY_SAVE: '무조작 시간 설정',
  } as Readonly<Record<string, string>>,
  targetUnknown: '기록된 대상',
  roles: { HA: '병원 관리자', RV: '검토 담당자', PO: '플랫폼 운영자' } as Readonly<Record<string, string>>,
  failure: {
    unauthenticated: ADMIN_COPY.unauthenticated,
    forbidden: '변경 이력을 볼 권한이 없습니다. 이 병원의 병원 관리자 권한이 있는 계정으로 로그인해 주세요.',
    ambiguous: '이 계정은 병원 관리자로 소속된 병원이 둘 이상이라 변경 이력을 보여 줄 병원을 하나로 정할 수 없습니다. 한 병원에만 소속된 계정으로 로그인해 주세요.',
    notFound: '소속된 병원을 찾을 수 없습니다.',
    mismatch: '이 주소의 병원과 로그인한 계정의 병원 관리자 소속이 다릅니다. 이 주소의 변경 이력은 보여 주지 않습니다.',
    error: ADMIN_COPY.loadFailed,
  },
} as const;
