import { compareCodePoints } from '../engine/validate';
import { canonicalDigest } from './digest';
import type { ItemVersionRef } from './domain/items';

// 묶음 게시 확인값 (SPEC-REIMBURSEMENT-001 M7 묶음 구성). "서버가 이 구성의 미리보기를 이 관리자에게 보여 줄 수 있었다"는 것을 게시 때 서버가 다시 계산해 확인하는 값이다.
// 사람이 화면을 읽었다는 증명이 아니다: 같은 관리자가 같은 기준 묶음·같은 매핑 집합(같은 내용·같은 승인 상태)을 고른 구성이라는 사실만 확인한다.
//
//   확인값 = canonicalDigest([ 용도 표지, 관리자 id, 기준 묶음 id, 기준 묶음 내용 해시, 고른 매핑(참조·내용 해시·상태·고정 지문; 참조 순), 합친 항목 참조 목록(참조 순) ])
//
// - 저장소에 아무것도 쓰지 않는다: 발급은 계산이고 확인도 계산이다. 미리보기가 읽기만 한다는 약속이 그대로다. 그래서 카탈로그 게시 확인값(publish-confirmation.ts)과 달리
//   서버만 아는 열쇠(초안 revision)가 없다 — 입력을 아는 쪽은 같은 값을 계산할 수 있다. 이 값은 위조를 막는 인증이 아니라 "입력이 미리보기 이후 바뀌지 않았다"는 확인이다
//   (인증·역할은 라우터와 서비스의 RV 확인이 따로 맡는다).
// - 고른 매핑의 내용 해시·승인 상태·고정 지문과 기준 묶음의 내용 해시가 묶여 있어, 미리보기 뒤에 입력이 바뀌면(다른 매핑 집합, 다른 기준 묶음, 매핑이 다른 묶음에 게시돼 PUBLISHED 가 됨,
//   재승인으로 지문이 바뀜) 이전 확인값은 맞지 않는다. 치료의 현재 지문처럼 매핑 밖에서 바뀌는 값은 묶지 않는다: 그 변화는 게시의 FINGERPRINT_STALE 전제가 거절한다.
// - 고른 순서는 확인값에 영향을 주지 않는다(참조 순으로 정렬한다).

const PURPOSE = 'bodam.bundle-publish-confirmation.v1';

/** 확인값에 묶이는 고른 매핑 한 건. */
export interface ConfirmationMapping {
  ref: ItemVersionRef;
  /** 저장된 항목 내용의 정본 해시. */
  contentDigest: string;
  /** 현재 생명주기 상태. 상태 기록이 없으면 null. */
  state: string | null;
  approvedFingerprint: string | null;
}

export interface ConfirmationInput {
  actorId: string;
  baseBundleId: string;
  baseContentHash: string;
  chosen: readonly ConfirmationMapping[];
  /** 합친 항목 참조 전부(기준 묶음 + 고른 매핑). */
  composedRefs: readonly ItemVersionRef[];
}

const compareRefs = (a: ItemVersionRef, b: ItemVersionRef): number =>
  compareCodePoints(a.kind, b.kind) || compareCodePoints(a.id, b.id) || compareCodePoints(a.version, b.version);

const refTuple = (ref: ItemVersionRef): [string, string, string] => [ref.kind, ref.id, ref.version];

/** 이 구성에 대해 발급되는 확인값. 입력의 순서(고른 순서·항목 순서)에 달라지지 않는다. */
export function bundleConfirmationOf(input: ConfirmationInput): string {
  const chosen = [...input.chosen].sort((a, b) => compareRefs(a.ref, b.ref)).map((mapping) => [refTuple(mapping.ref), mapping.contentDigest, mapping.state, mapping.approvedFingerprint]);
  const composed = [...input.composedRefs].sort(compareRefs).map(refTuple);
  return canonicalDigest([PURPOSE, input.actorId, input.baseBundleId, input.baseContentHash, chosen, composed]);
}

/**
 * 받은 값이 이 구성에 대해 발급된 확인값인지 본다. 두 값을 한 번 더 해시해서 비교한다: 맞는 값을 한 글자씩 알아내는 시간 차이 공격에 쓸 수 있는 부분 일치가 남지 않는다
 * (publish-confirmation.ts 의 confirmsPublish 와 같은 방식). 문자열이 아닌 값은 어떤 구성에도 맞지 않는다.
 */
export function confirmsBundlePublish(input: ConfirmationInput, provided: unknown): boolean {
  if (typeof provided !== 'string') {
    return false;
  }
  return canonicalDigest(['compare', bundleConfirmationOf(input)]) === canonicalDigest(['compare', provided]);
}
