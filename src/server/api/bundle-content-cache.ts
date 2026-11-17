import type { BundleContent } from './bundle-content';

// 규칙 묶음 내용 캐시 (SPEC-REIMBURSEMENT-001 M4.C, design.md DD-14 "캐시 계약"·"항목 생명주기 상태와 캐시 계약", plan.md M4 캐시 적중 계약).
//
// 담는 것: 바뀌지 않는 묶음 내용(BundleContent: 묶음 id·내용 해시와 프로필·매핑·서류 규칙 묶음의 항목 버전 기록)뿐이다. 키는 (묶음 id, 내용 해시).
// 담지 않는 것(담을 자리가 없다): 항목의 현재 상태·승인자·승인 지문, 묶음 가용성, 병원의 규칙 사용 범위, 환자 선택, 요청 식별자.
//   BundleContent 타입에 그 필드가 없고, 이 캐시는 BundleContent 만 받는다. 상태·승인자·지문·가용성은 요청마다 저장소에서 새로 읽어 합친다(bundle-content.ts).
//
// 구성이 만든 인스턴스다: 모듈 수준 상태가 아니다. 운영 구성(composition.ts)이 서비스마다 하나를 만들어 ApiServices 에 싣는다.
// 무효화 메서드가 없다: 키가 (id, 내용 해시)이고 묶음 버전은 게시 뒤 바뀌지 않으므로 무효화할 일이 없다. 상태가 바뀌어도(재승인 포함) 캐시된 내용은 그대로 맞다.
//
// 크기: 항목의 수는 서로 다른 (묶음 id, 내용 해시)의 수다. 그 값은 검토 담당자가 게시한 묶음 버전에서만 나오고(요청은 키를 만들 수 없다: 로드하는 묶음 id 는
// 병원의 규칙 사용 범위가 가리키는 값이다), 한 묶음의 내용은 작다(프로필·매핑·서류 규칙 묶음 수십 개). 그래서 쫓아내는 장치(eviction)를 두지 않는다.
// 묶음 게시가 늘어 크기가 문제가 되면 그때 상한을 더한다(OPEN, progress.md).

/** 캐시의 한 항목: 키와 그 키로 찾은 (깊이 얼린) 묶음 내용. */
export interface BundleContentCacheEntry {
  readonly bundleId: string;
  readonly contentHash: string;
  readonly content: BundleContent;
}

export interface BundleContentCache {
  /** (묶음 id, 내용 해시)로 찾는다. 없으면 null. 돌려주는 값은 깊이 얼려 있어 바꿀 수 없다. */
  lookup(bundleId: string, contentHash: string): BundleContent | null;
  /** 내용을 저장한다. 키는 내용의 id·contentHash 다. 이미 있는 키면 처음 사본을 그대로 둔다. 저장하는 것은 깊은 복사본이라 호출한 쪽의 이후 변경과 분리된다. */
  store(content: BundleContent): void;
  /** 읽기 전용 보기(시험·진단용): 지금 담긴 모든 항목. 호출마다 새 배열이고, 배열도 항목도 얼려 있다. */
  entries(): readonly BundleContentCacheEntry[];
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) {
      deepFreeze(inner);
    }
    Object.freeze(value);
  }
  return value;
}

/** 빈 캐시를 만든다. 호출마다 따로 산다(공유 상태 없음). */
export function createBundleContentCache(): BundleContentCache {
  // 키는 [id, 해시]의 JSON 이라 id 나 해시에 어떤 문자가 들어 있어도 서로 다른 쌍이 같은 키가 되지 않는다.
  const byKey = new Map<string, BundleContentCacheEntry>();
  const keyOf = (bundleId: string, contentHash: string): string => JSON.stringify([bundleId, contentHash]);
  return {
    lookup(bundleId, contentHash) {
      return byKey.get(keyOf(bundleId, contentHash))?.content ?? null;
    },
    store(content) {
      const key = keyOf(content.id, content.contentHash);
      if (!byKey.has(key)) {
        byKey.set(key, deepFreeze({ bundleId: content.id, contentHash: content.contentHash, content: structuredClone(content) }));
      }
    },
    entries() {
      return Object.freeze([...byKey.values()]);
    },
  };
}
