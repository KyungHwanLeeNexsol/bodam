import { compareCodePoints } from '../engine/validate';
import type { BaseFeeEdit, CommonBaseFee } from './domain/entities';
import type { Defect } from './domain/errors';

// 카탈로그 초안의 공통 기본비용 금액 수정 (M7). 초안의 기본비용 수정을 병원의 현재 게시 기본비용과 맞춰 보는 순수 함수들이다: 저장소를 읽지도 쓰지도 않는다.
// 호출한 쪽이 published-base-fees.ts 의 단일 기준(selectPublishedBaseFees)으로 읽은 기본비용 목록을 넘긴다.
//
// 지키는 약속:
//  - 수정할 수 있는 것은 현재 게시 카탈로그에 든 기본비용의 금액뿐이다. 새 기본비용 등록·삭제·코드·급여 구분(보장 판단 필드) 변경은 여기에 길이 없다.
//  - 다른 병원의 baseFeeId 와 없는 baseFeeId 는 같은 코드(BASE_FEE_NOT_IN_CATALOG)로 거절한다: 다른 병원의 기본비용 존재를 드러내지 않는다.

/** 초안의 기본비용 수정을 현재 게시 기본비용과 맞춰 본 결함. 게시된 기본비용에 없는 baseFeeId 는 BASE_FEE_NOT_IN_CATALOG(path `baseFeeEdits[i].baseFeeId`). 읽기만 한다. */
export function baseFeeEditDefects(published: readonly CommonBaseFee[], edits: readonly BaseFeeEdit[]): Defect[] {
  const ids = new Set(published.map((fee) => fee.baseFeeId));
  const defects: Defect[] = [];
  edits.forEach((edit, index) => {
    if (!ids.has(edit.baseFeeId)) {
      defects.push({ code: 'BASE_FEE_NOT_IN_CATALOG', path: `baseFeeEdits[${index}].baseFeeId` });
    }
  });
  return defects;
}

/** 현재 금액과 다른 수정만 남긴 복사본(baseFeeId 의 코드 포인트 순). 현재 금액과 같은 수정은 변경이 아니다. 게시된 기본비용에 없는 baseFeeId 는 버린다(결함은 baseFeeEditDefects 가 알린다). */
export function changedBaseFeeEdits(published: readonly CommonBaseFee[], edits: readonly BaseFeeEdit[]): BaseFeeEdit[] {
  const amountOf = new Map(published.map((fee) => [fee.baseFeeId, fee.amount]));
  return edits
    .filter((edit) => amountOf.has(edit.baseFeeId) && amountOf.get(edit.baseFeeId) !== edit.amount)
    .map((edit) => ({ baseFeeId: edit.baseFeeId, amount: edit.amount }))
    .sort((a, b) => compareCodePoints(a.baseFeeId, b.baseFeeId));
}
