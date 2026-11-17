import { compareCodePoints } from '../engine/validate';
import { canonicalDigest } from './digest';
import type { ItemVersionRef } from './domain/items';

// 묶음 게시 확인값 (SPEC-REIMBURSEMENT-001 M7 묶음 구성). "서버가 이 관리자에게 이 구성의 미리보기를 만들었다"는 서버 쪽 증거이고, 사람이 화면을 읽었다는 증명이 아니다.
//
// 확인값 자체는 서버가 발급한 예측할 수 없는 일회용 값(token)이다. 입력에서 다시 계산할 수 있는 값이 아니다:
//
//   token                = canonicalDigest([ 용도 표지, 주입한 식별자 생성기의 'BUNDLE_CONFIRMATION' 값 ])   — issueBundleConfirmationToken
//   configurationDigest  = canonicalDigest([ 용도 표지, 관리자 id, 기준 묶음 id, 기준 묶음 내용 해시, 고른 매핑(참조·내용 해시·상태·고정 지문; 참조 순), 합친 항목 참조 목록(참조 순) ]) — bundleConfirmationOf
//
// - 미리보기가 깨끗한 구성에 대해서만 token 을 만들고 서버 기록(BundlePublishConfirmation: token, 관리자, 기준 묶음, 고른 매핑, configurationDigest, 발급·소비 시각)으로 남긴다.
//   응답에 실리는 것은 token 뿐이다. configurationDigest 는 서버 안에만 있고 어떤 응답에도 싣지 않는다.
// - 옛 방식(확인값 = 입력의 해시)은 입력을 아는 쪽이 같은 값을 계산할 수 있어 미리보기 없이 게시할 수 있었다. 지금의 configurationDigest 는 위조를 막는 인증이 아니라
//   "발급 때의 구성이 지금 저장소의 구성과 같다"를 확인하는 묶음 입력일 뿐이다 — 이 값을 계산할 수 있어도 서버 기록이 없으면 게시할 수 없다.
// - 게시는 한 트랜잭션 안에서 token 으로 기록을 찾고, 관리자·기준 묶음·고른 매핑이 같고 현재 저장소에서 다시 계산한 configurationDigest 가 기록과 같고 아직 쓰이지 않았을 때만 통과한다.
//   고른 매핑의 내용 해시·승인 상태·고정 지문과 기준 묶음의 내용 해시가 묶여 있어, 미리보기 뒤에 입력이 바뀌면(다른 매핑 집합, 다른 기준 묶음, 매핑이 다른 묶음에 게시돼 PUBLISHED 가 됨,
//   재승인으로 지문이 바뀜) 이전 확인값은 맞지 않는다. 치료의 현재 지문처럼 매핑 밖에서 바뀌는 값은 묶지 않는다: 그 변화는 게시의 FINGERPRINT_STALE 전제가 거절한다.
// - 고른 순서는 영향을 주지 않는다(참조 순으로 정렬한다).
// - 실제 비밀성은 식별자 생성기에 기댄다(src/server 는 난수를 직접 만들 수 없다). 운영 생성기(src/app/clock.ts)는 UUID 를 쓴다. 시험 생성기는 예측 가능하지만 기록 대조(관리자·구성 일치)가 남는다.

const PURPOSE = 'bodam.bundle-publish-confirmation.v1';
const TOKEN_PURPOSE = 'bodam.bundle-confirmation-token.v1';

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

export const compareRefs = (a: ItemVersionRef, b: ItemVersionRef): number =>
  compareCodePoints(a.kind, b.kind) || compareCodePoints(a.id, b.id) || compareCodePoints(a.version, b.version);

const refTuple = (ref: ItemVersionRef): [string, string, string] => [ref.kind, ref.id, ref.version];

/** 항목 참조를 (종류, id, 버전) 코드 포인트 순으로 정렬한 새 목록. */
export const sortedRefs = (refs: readonly ItemVersionRef[]): ItemVersionRef[] => [...refs].sort(compareRefs).map((ref) => ({ kind: ref.kind, id: ref.id, version: ref.version }));

/** 두 참조 목록이 순서와 무관하게(정렬해서) 같은가. */
export function sameRefLists(a: readonly ItemVersionRef[], b: readonly ItemVersionRef[]): boolean {
  const left = sortedRefs(a);
  const right = sortedRefs(b);
  return left.length === right.length && left.every((ref, index) => compareRefs(ref, right[index] as ItemVersionRef) === 0);
}

/**
 * 이 구성의 해시. 입력의 순서(고른 순서·항목 순서)에 달라지지 않는다. 서버 기록에 남겨 게시 때 다시 계산한 값과 비교하는 데만 쓴다 — 확인값이 아니고 응답에 싣지 않는다.
 */
export function bundleConfirmationOf(input: ConfirmationInput): string {
  const chosen = [...input.chosen].sort((a, b) => compareRefs(a.ref, b.ref)).map((mapping) => [refTuple(mapping.ref), mapping.contentDigest, mapping.state, mapping.approvedFingerprint]);
  const composed = [...input.composedRefs].sort(compareRefs).map(refTuple);
  return canonicalDigest([PURPOSE, input.actorId, input.baseBundleId, input.baseContentHash, chosen, composed]);
}

/**
 * 주입한 식별자 생성기의 값(접두어 'BUNDLE_CONFIRMATION')에서 확인값을 파생한다. 64자 소문자 16진수(canonicalDigest 의 출력)라
 * 게시 요청 본문의 형식 검사(PUBLISH_CONFIRMATION_PATTERN)가 그대로 받는다. 생성기가 예측할 수 없는 값을 내는 만큼만 예측할 수 없다.
 */
export const issueBundleConfirmationToken = (generatedId: string): string => canonicalDigest([TOKEN_PURPOSE, generatedId]);
