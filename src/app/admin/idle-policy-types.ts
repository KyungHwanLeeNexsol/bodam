// 병원 무조작 정책 화면이 읽고 보내는 관리자 API 의 모양 (src/server/admin/router.ts 의 GET·PUT /api/admin/clinics/{clinicId}/idle-policy).
// 화면 코드는 서버 모듈을 가져오지 않고 이 형식만 쓴다. 화면 종류 다섯 개의 이름은 서버(src/server/idle-policy.ts)와 키오스크(catalog 응답 idlePolicy)가 쓰는 키와 같다.

export const IDLE_SCREEN_KINDS = ['INPUT', 'RESULT', 'BASIS_AND_DOCUMENTS', 'HOLD_RESULT', 'NOTICE_PROGRESS_ERROR'] as const;
export type IdleScreenKind = (typeof IDLE_SCREEN_KINDS)[number];

export interface IdleThreshold {
  warnSeconds: number;
  resetSeconds: number;
}

export interface IdlePolicyView {
  clinic: { id: string; slug: string; displayName: string };
  /** 공개 catalog 응답의 idlePolicy 와 같은 값: 다섯 화면 종류가 모두 있고, 저장하지 않은 종류는 기본값이다. completionHoldSeconds null = 자동 복귀 없음. */
  idlePolicy: { screens: Record<IdleScreenKind, IdleThreshold>; completionHoldSeconds: number | null };
  /** 병원이 직접 저장한 화면 종류. 나머지는 기본값을 따른다. */
  customizedScreens: IdleScreenKind[];
  defaults: Record<IdleScreenKind, IdleThreshold>;
  /** 경고와 초기화 사이의 최소 간격(초). 서버가 정한다. */
  minLeadSeconds: number;
  /** 읽은 순간의 저장 상태 지문. 저장(PUT)에 expectedDigest 로 그대로 되돌려 보낸다. 변경 감지용이며 화면이 해석하거나 만들지 않는다. */
  policyDigest: string;
}

/**
 * PUT 본문. 화면에서 숫자로 읽을 수 없는 입력은 글자 그대로 보낸다(서버가 VALUE_INVALID 로 거절한다): 화면이 값을 몰래 고치지 않는다.
 * screens 는 직접 저장할 화면 종류만 담는다 — 빠진 종류는 서버가 기본값으로 되돌린다(PUT 전체 교체).
 */
export interface IdlePolicyBody {
  screens: Partial<Record<IdleScreenKind, { warnSeconds: number | string; resetSeconds: number | string }>>;
  completionHoldSeconds: number | string | null;
}

/** 실제로 보내는 PUT 본문: IdlePolicyBody + 화면이 근거로 삼은 읽기 응답의 policyDigest. 서버가 현재 저장 상태와 다르면 409 IDLE_POLICY_CHANGED 로 거절한다. */
export interface IdlePolicyPutBody extends IdlePolicyBody {
  expectedDigest: string;
}
