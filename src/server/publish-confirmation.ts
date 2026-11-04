import { canonicalDigest } from './digest';
import type { CatalogDraft } from './domain/entities';

// 게시 확인값 (SPEC-REIMBURSEMENT-001 M7 첫 기능). "서버가 이 초안의 미리보기를 이 관리자에게 만들어 주었다"는 것을 게시 때 서버가 다시 확인하는 값이다.
// 사람이 화면을 읽었다는 증명이 아니다: 미리보기 요청이 성공했고 그 응답을 받은 쪽이 같은 초안·같은 관리자라는 사실만 확인한다.
//
//   확인값 = canonicalDigest([ 용도 표지, 초안 revision, 관리자 id, 병원 id, 기준 카탈로그 버전 id, 가격 목록의 지문 ])
//
// - 열쇠는 초안의 revision 이다. 저장할 때마다 서버가 새로 만들고(가격이 같아도 다르다) 어떤 응답에도 싣지 않으므로, 미리보기 응답을 받지 않은 쪽은 계산할 수 없다.
//   목록·저장 응답의 draftDigest(가격 목록의 지문)는 revision 을 담지 않아 이 값을 만드는 데 쓸 수 없다.
// - 초안을 다시 저장하거나 버렸다 새로 만들면 revision 이 바뀌어 이전 확인값은 맞지 않는다. 기준 카탈로그가 바뀐 뒤 같은 가격으로 다시 저장해도 마찬가지다.
// - 관리자 id·병원 id·기준 카탈로그가 묶여 있어 다른 관리자·다른 병원의 확인값은 맞지 않는다.
// - 저장소에 아무것도 쓰지 않는다: 발급은 계산이고 확인도 계산이다. 미리보기가 읽기만 한다는 약속이 그대로다.
// 실제 비밀성은 revision 을 만드는 식별자 생성기에 기댄다(src/server 는 난수를 직접 만들 수 없다). 운영 생성기(src/app/clock.ts)는 UUID 를 쓴다. 시험 생성기는 예측 가능해서
// 시험 세계에서는 확인값을 위조할 수 있다(예측 불가 요건은 domain/ports.ts 의 IdGenerator 에 적었다). 생성기를 순차 번호 같은 예측 가능한 것으로 바꾸면 이 방어는 보통의 해시로 내려앉는다.
// revision 이 비어 있거나 문자열이 아닌 초안(저장소가 막지만 가져오기 등으로 들어올 수 있는 결함)은 확인값을 발급하지 않고(서버 데이터 결함, 500) 어떤 값도 맞다고 하지 않는다.

const PURPOSE = 'bodam.publish-confirmation.v1';

/** 형식: 소문자 16진수 64자(canonicalDigest 의 출력). 이 모양이 아니면 확인값으로 보지 않는다. */
export const PUBLISH_CONFIRMATION_PATTERN = /^[0-9a-f]{64}$/;

/** 열쇠(revision)가 있는 초안인가. 타입은 string 이지만 저장소 밖에서 들어온 자료는 런타임에 확인한다. */
export const hasRevision = (draft: CatalogDraft): boolean => typeof draft.revision === 'string' && draft.revision !== '';

/** 이 관리자가 이 초안의 미리보기를 본 것으로 인정할 확인값. 미리보기가 성공했을 때만 응답에 싣는다. */
export function issuePublishConfirmation(draft: CatalogDraft, adminId: string): string {
  if (!hasRevision(draft)) {
    throw new Error('초안의 revision 이 비어 있어 게시 확인값을 만들 수 없다');
  }
  return canonicalDigest([PURPOSE, draft.revision, adminId, draft.clinicId, draft.baseCatalogVersionId, canonicalDigest(draft.priceEdits)]);
}

/**
 * 받은 값이 이 관리자·이 초안에 대해 발급된 확인값인지 본다.
 * 두 값을 한 번 더 해시해서 비교한다: 맞는 값을 한 글자씩 알아내는 시간 차이 공격에 쓸 수 있는 부분 일치가 남지 않는다.
 */
export function confirmsPublish(draft: CatalogDraft, adminId: string, provided: string): boolean {
  if (!hasRevision(draft)) {
    return false;
  }
  return canonicalDigest(['compare', issuePublishConfirmation(draft, adminId)]) === canonicalDigest(['compare', provided]);
}
