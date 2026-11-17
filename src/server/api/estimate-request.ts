import type { Cause, Generation, InsurerType } from '../../engine/types';
import { isGeneration } from '../../engine/validate';
import { INSURER_TYPES } from '../validate/shape';

// 계산 요청 본문 읽기와 요청 검증의 층 1·2 (SPEC-REIMBURSEMENT-001 M4.B, design.md DD-19 "요청 검증의 층", AC-006f·AC-019a).
//  - 층 1 구조(400 INVALID_REQUEST): 본문이 객체, 필수 여섯 필드가 있고 형식이 맞음, insurerType·cause 가 열거값 안.
//  - 층 2 내용(422): generation 이 문자열이지만 다섯 값 밖이면 UNSUPPORTED_GENERATION, treatmentIds 가 빈 배열이면 NO_TREATMENT_SELECTED
//    (두 코드가 겹치면 UNSUPPORTED_GENERATION 이 먼저, 엔진의 입력 검증 순서와 같다).
// 이 파일은 요청 본문만 본다. 저장소·서비스를 읽지 않으므로 층 1·2 에서 서버 데이터를 읽기 전에 거절한다.
//
// 필드 접근 감시(AC-019a): 본문 객체에서 읽는 것은 아래 CONTRACT_FIELDS 여섯 이름의 값뿐이다. 객체 전체를 훑거나(키 나열·펼침·직렬화) 복사하지 않고,
// 계약 밖의 이름은 읽지도 검사하지도 담아 두지도 않는다. 시험은 본문을 Proxy 로 감싸 접근한 이름을 기록해 이 약속을 확인한다.
// 값이 없는지는 `undefined` 로 판단한다(JSON 은 undefined 를 담을 수 없으므로 키가 없을 때만 undefined 다): `in`·`hasOwn` 같은 접근을 쓰지 않는다.

/** 요청 본문 계약의 여섯 필드. 이 밖의 이름은 어떤 층에서도 읽지 않는다. */
export const CONTRACT_FIELDS = ['catalogVersion', 'ruleBundleVersion', 'generation', 'insurerType', 'cause', 'treatmentIds'] as const;

const CAUSES: readonly Cause[] = ['INJURY', 'ILLNESS', 'UNKNOWN'];

/** 층 1·2 를 통과한 요청. 여섯 필드뿐이며 다른 값은 담지 않는다. */
export interface EstimateRequest {
  catalogVersion: string;
  /** 규칙 사용 범위가 없는 병원을 본 클라이언트는 null 을 보낸다. */
  ruleBundleVersion: string | null;
  generation: Generation;
  insurerType: InsurerType;
  cause: Cause;
  /** 요청에 적힌 순서이고 중복이 없다 (수량이라는 개념이 없다). 1개 이상. */
  treatmentIds: string[];
}

export type RequestRejection = 'INVALID_REQUEST' | 'UNSUPPORTED_GENERATION' | 'NO_TREATMENT_SELECTED';

export type ParsedEstimateRequest = { ok: true; request: EstimateRequest } | { ok: false; error: RequestRejection };

const INVALID: ParsedEstimateRequest = { ok: false, error: 'INVALID_REQUEST' };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

// @MX:ANCHOR: [AUTO] 계산 요청 본문의 단일 읽기점. 계산 서비스와 필드 접근 감시 시험(AC-019a)이 부른다.
// @MX:REASON: 본문을 읽는 곳이 둘이면 계약 밖 필드(가격·비율·병원 ID 등)를 읽는 경로가 생길 수 있다. 여섯 이름만 읽는다는 약속이 한 함수에서 지켜져야 한다.
/**
 * 파싱한 JSON 값에서 계약의 여섯 필드를 읽어 층 1·2 를 검사한다. 던지지 않는다. 입력을 바꾸지 않는다.
 * 읽는 순서는 CONTRACT_FIELDS 순서이고, 거절 판단은 층 1 이 모두 끝난 뒤에 층 2 로 간다.
 */
export function parseEstimateRequest(raw: unknown): ParsedEstimateRequest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return INVALID;
  }
  const body = raw as Record<string, unknown>;
  const catalogVersion = body.catalogVersion;
  const ruleBundleVersion = body.ruleBundleVersion;
  const generation = body.generation;
  const insurerType = body.insurerType;
  const cause = body.cause;
  const treatmentIds = body.treatmentIds;

  // 층 1: 구조와 열거값.
  if (
    typeof catalogVersion !== 'string' ||
    !(typeof ruleBundleVersion === 'string' || ruleBundleVersion === null) ||
    typeof generation !== 'string' ||
    !INSURER_TYPES.includes(insurerType as InsurerType) ||
    !CAUSES.includes(cause as Cause) ||
    !isStringArray(treatmentIds)
  ) {
    return INVALID;
  }

  // 층 2: 형식은 지켰으나 지원 범위 밖이거나 비어 있다.
  if (!isGeneration(generation)) {
    return { ok: false, error: 'UNSUPPORTED_GENERATION' };
  }
  if (treatmentIds.length === 0) {
    return { ok: false, error: 'NO_TREATMENT_SELECTED' };
  }
  return {
    ok: true,
    request: {
      catalogVersion,
      ruleBundleVersion,
      generation,
      insurerType: insurerType as InsurerType,
      cause: cause as Cause,
      treatmentIds: [...new Set(treatmentIds)],
    },
  };
}
