import { appendAudit } from './audit';
import type { ServiceDeps } from './deps';
import type { Actor } from './domain/actor';
import type { TreatmentVersion } from './domain/entities';
import { formatRef } from './domain/items';
import type { ItemVersionRecordOf, ItemVersionRef } from './domain/items';
import { coverageFingerprintOf } from './fingerprint';
import { assertTransition } from './lifecycle';

// 재검토 전환 (design.md DD-16, AC-009a 의 단위 수준 부분).
// 보장 판단 필드(treatmentCode, procedureCodes, benefitType, calcClass)가 바뀐 치료 버전이 게시되면 그 치료의 APPROVED·PUBLISHED
// 매핑을 UNDER_REREVIEW 로 옮긴다. 가격·표시 이름 등은 지문에 들지 않으므로(fingerprint.ts) 아무것도 바뀌지 않는다.
// 비교는 "매핑이 승인 때 고정한 지문"과 "새 치료 버전의 지문"이다 — 직전 치료 버전과 비교하지 않으므로 여러 번 바뀐 뒤에도,
// 같은 호출을 되풀이해도 결과가 같다.

const REASON = 'COVERAGE_JUDGMENT_FIELD_CHANGED';

// @MX:ANCHOR: [AUTO] 재검토 전환의 단일 구현. 카탈로그 게시(M3.D)가 같은 트랜잭션 안에서 부르고 운영 준비 상태·시험이 이 결과를 읽는다.
// @MX:REASON: 호출하는 쪽이 자기 트랜잭션을 열어 둔 채로 부르므로 여기서 던지면 호출 쪽 게시 전체가 되돌려져야 한다(저장소의 중첩 트랜잭션 계약). 전환이 빠지면 관리 화면 상태 전환 없이도 지문 불일치가 엔진에서 보류로 드러나지만(DD-15 백스톱) 승인 목록에는 계속 승인으로 남는다.
/**
 * 새로 만들어졌거나 게시된 치료 버전(version)에 대해, 같은 치료의 APPROVED·PUBLISHED 매핑 가운데 고정된 지문이 새 지문과 다른 것을
 * UNDER_REREVIEW 로 옮기고 옮긴 매핑 버전 참조를 (쓴 순서대로) 돌려준다. 전환은 상태 이력(사유 COVERAGE_JUDGMENT_FIELD_CHANGED)과
 * 감사 기록에 행위자(게시한 주체)로 남는다. 이것은 게시에 딸린 시스템 효과이므로 어떤 역할이든 부를 수 있고 RV 동작이 아니다.
 * 승인자 기록과 고정 지문은 그대로 둔다(재승인이 새로 고정한다). 다른 상태의 매핑, 다른 치료의 매핑, 프로필·서류 규칙 묶음은 건드리지 않는다.
 * [문서에 없음] 상태 기록이 아직 없는 매핑 버전은 건너뛰고, 고정된 지문이 없는(null) APPROVED·PUBLISHED 매핑은 비교할 수 없으므로 전환한다.
 * 치료 버전 자체를 저장하지 않는다(저장은 카탈로그 게시의 몫).
 */
export function triggerReReview(deps: ServiceDeps, actor: Actor, version: TreatmentVersion): ItemVersionRef[] {
  return deps.repo.transaction(() => {
    const fingerprint = coverageFingerprintOf(version);
    // listItemVersions('MAPPING') 는 매핑 기록만 돌려준다.
    const mappings = (deps.repo.listItemVersions('MAPPING') as Array<ItemVersionRecordOf<'MAPPING'>>).filter((record) => record.content.treatmentId === version.treatmentId);
    const moved: ItemVersionRef[] = [];
    deps.repo.readItemStates(mappings.map((record) => record.ref)).forEach((state, index) => {
      if (state === null) {
        return;
      }
      if ((state.state !== 'APPROVED' && state.state !== 'PUBLISHED') || state.approvedFingerprint === fingerprint) {
        return;
      }
      const record = mappings[index]!;
      assertTransition(state.state, 'UNDER_REREVIEW');
      deps.repo.recordItemTransition(record.ref, {
        from: state.state,
        to: 'UNDER_REREVIEW',
        actor,
        at: deps.clock.now(),
        reason: REASON,
        approverAfter: state.approver,
        approvedFingerprintAfter: state.approvedFingerprint,
      });
      appendAudit(deps, actor, { action: 'ITEM_REREVIEW', target: formatRef(record.ref), beforeVersion: state.state, afterVersion: 'UNDER_REREVIEW', reason: REASON });
      moved.push(record.ref);
    });
    return moved;
  });
}
