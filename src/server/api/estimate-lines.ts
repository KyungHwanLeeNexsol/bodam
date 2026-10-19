import type { PublishedLine } from '../../engine/types';
import { toEngineBaseFeeLine, toEnginePublishedLine } from '../domain/projection';
import { ServerIntegrityError } from './integrity';
import type { PublishedCatalog } from './published-catalog';

// 엔진 입력 줄의 조립과 조립 검사 (SPEC-REIMBURSEMENT-001 M4.B, design.md DD-03 "입력 검증의 책임 분담" (a)~(d), AC-006i).
// 줄은 서버가 그 병원의 현재 게시 카탈로그에서 만든다(요청 본문의 값은 쓰지 않는다, AC-019a). 줄 변환은 projection.ts 의 단일 구현을 부른다.
// M1 엔진은 아래 넷을 거절하지도 보정하지도 않으므로 엔진을 부르기 전에 서버가 확인한다:
//   (a) 선택한 treatmentId 에 게시된 줄이 없음
//   (b) 선택하지 않은 treatmentId 의 줄이 엔진 입력에 들어감
//   (c) 같은 treatmentId 가 lines 와 baseFeeLines 양쪽에 있음
//   (d) isBaseFee 표시가 줄이 든 배열과 어긋남
// 위반은 요청의 잘못이 아니라 서버 데이터·조립의 결함이므로 형식을 갖춘 오류(ServerIntegrityError)를 던지고, 계산 서비스가 500 INTERNAL_ERROR 로 바꾼다.

export interface ResolvedLines {
  /** 고른 치료의 줄 (병원 카탈로그의 노출 순서). 요청의 중복 치료 id 는 요청 구문 분석(estimate-request.ts)에서 이미 한 번씩만 남았다. */
  lines: PublishedLine[];
  /** 등록된 공통 기본비용 줄 전부 (baseFeeId 순). */
  baseFeeLines: PublishedLine[];
}

/**
 * 현재 게시 카탈로그에서 엔진 입력의 줄을 만든다: 고른 치료(selectedIds 에 든 활성 치료)의 줄과 등록된 모든 공통 기본비용의 줄.
 * 같은 치료가 카탈로그에 여러 번 담겨 있으면 줄도 여러 개가 되며(걸러 내거나 고르지 않는다) 내용 충돌 판정은 엔진이 한다.
 */
export function resolveLines(published: PublishedCatalog, selectedIds: readonly string[]): ResolvedLines {
  const selected = new Set(selectedIds);
  return {
    lines: published.treatments.filter(({ treatment }) => selected.has(treatment.id)).map(({ version }) => toEnginePublishedLine(version)),
    baseFeeLines: published.baseFees.map((fee) => toEngineBaseFeeLine(fee)),
  };
}

// @MX:WARN: [AUTO] 엔진이 검사하지 않는 입력 네 가지의 유일한 방어선이다. 이 검사가 빠지면 선택하지 않은 치료의 금액이 병원 결제액에 들어가거나 기본비용이 이중으로 센다.
// @MX:REASON: M1 엔진은 (a)~(d)를 거절하지도 보정하지도 않는다(tests/engine/duplicate-conflict.test.ts 가 "검사하지 않음"으로 기록한다). 어긋난 입력이 숫자 결과로 나가면 환자에게 틀린 금액이 간다.
/**
 * 조립한 줄이 (a)~(d)를 지키는지 확인한다. 어기면 ServerIntegrityError 를 던진다. 검사 순서는 (a) (b) (c) (d)이고 처음 걸린 것 하나만 알린다.
 * 입력을 바꾸지 않는다.
 */
export function assertLineAssembly(selectedIds: readonly string[], lines: readonly PublishedLine[], baseFeeLines: readonly PublishedLine[]): void {
  const selected = new Set(selectedIds);
  const lineIds = new Set(lines.map((line) => line.treatmentId));
  if (selectedIds.some((id) => !lineIds.has(id))) {
    throw new ServerIntegrityError('ASSEMBLY_SELECTED_LINE_MISSING');
  }
  if (lines.some((line) => !selected.has(line.treatmentId))) {
    throw new ServerIntegrityError('ASSEMBLY_UNSELECTED_LINE_PRESENT');
  }
  if (baseFeeLines.some((line) => lineIds.has(line.treatmentId))) {
    throw new ServerIntegrityError('ASSEMBLY_LINE_IN_BOTH_ARRAYS');
  }
  if (lines.some((line) => line.isBaseFee !== false) || baseFeeLines.some((line) => line.isBaseFee !== true)) {
    throw new ServerIntegrityError('ASSEMBLY_BASE_FEE_FLAG_MISMATCH');
  }
}
