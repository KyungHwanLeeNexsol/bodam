import { appendAudit } from './audit';
import { canonicalDigest } from './digest';
import type { ServiceDeps } from './deps';
import { requireRole } from './domain/actor';
import type { Actor } from './domain/actor';
import type { Insurer } from './domain/entities';
import { DomainError } from './domain/errors';
import type { Defect } from './domain/errors';
import { INSURER_TYPES, isAbsent, isOneOf, isPlainObject } from './validate/shape';

// 보험사 기관 기록 저장 서비스 (SPEC-REIMBURSEMENT-001 M3.D2, AC-011d, design.md DD-17 권한 표: 보험사 관리는 RV).
// 기관 기록은 id 로만 구분한다. 기관 종류(NON_LIFE · LIFE · MUTUAL_AID)가 다른 기록은 서로 다른 기관 기록이고, 이름이나 별칭이 겹쳐도
// 합치지 않는다(이름으로 기록을 찾거나 합치는 코드가 없다). 별칭 목록(formerNames)은 기록마다 따로다.
// 이 서비스는 실제 보험사 자료를 만들지 않는다: 호출자가 넘긴 기록을 검증해 저장할 뿐이다.

const isInsurerType = isOneOf(INSURER_TYPES);

/** 비어 있지 않고 공백뿐이 아닌 문자열. */
const isNamedText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** 입력을 검사해 결함을 고정 순서(id, 종류, 현재 이름, 별칭, 연락처)로 모은다. 결함이 없으면 입력에서 알려진 필드만 뽑은 사본을 돌려준다. */
function parseInsurer(input: unknown): { insurer: Insurer } | { defects: Defect[] } {
  if (!isPlainObject(input)) {
    return { defects: [{ code: 'VALUE_INVALID', path: '' }] };
  }
  const defects: Defect[] = [];
  const { id, insurerType, currentName, formerNames, verifiedContact } = input;
  if (!isNamedText(id)) {
    defects.push({ code: 'EMPTY', path: 'id' });
  }
  if (isAbsent(insurerType)) {
    defects.push({ code: 'VALUE_MISSING', path: 'insurerType' });
  } else if (!isInsurerType(insurerType)) {
    defects.push({ code: 'VALUE_INVALID', path: 'insurerType' });
  }
  if (!isNamedText(currentName)) {
    defects.push({ code: 'EMPTY', path: 'currentName' });
  }
  if (isAbsent(formerNames)) {
    defects.push({ code: 'VALUE_MISSING', path: 'formerNames' });
  } else if (!Array.isArray(formerNames)) {
    defects.push({ code: 'VALUE_INVALID', path: 'formerNames' });
  } else {
    formerNames.forEach((name: unknown, index) => {
      if (!isNamedText(name)) {
        defects.push({ code: 'EMPTY', path: `formerNames[${index}]` });
      }
    });
  }
  if (verifiedContact === undefined) {
    defects.push({ code: 'VALUE_MISSING', path: 'verifiedContact' });
  } else if (verifiedContact !== null && typeof verifiedContact !== 'string') {
    defects.push({ code: 'VALUE_INVALID', path: 'verifiedContact' });
  }
  if (defects.length > 0) {
    return { defects };
  }
  return { insurer: { id: id as string, insurerType: insurerType as Insurer['insurerType'], currentName: currentName as string, formerNames: [...(formerNames as string[])], verifiedContact: verifiedContact as string | null } };
}

/**
 * RV 가 보험사 기관 기록을 저장한다(id 기준 upsert). 입력이 틀리면 INVALID_INPUT(결함 경로 포함)이고 아무것도 저장하지 않는다.
 * [문서에 없음] 이미 있는 기록의 기관 종류는 바꿀 수 없다(STATE_CONFLICT, 경로 insurerType): 종류를 바꾸면 종류가 다른 두 기관이 한 기록으로
 * 합쳐지는 것과 같기 때문이다. 이름·별칭·연락처는 고칠 수 있다. 감사 기록에는 저장 전후 기록의 정본 해시가 남는다.
 */
export function saveInsurerRecord(deps: ServiceDeps, actor: Actor, input: unknown): Insurer {
  requireRole(actor, 'RV');
  return deps.repo.transaction(() => {
    const parsed = parseInsurer(input);
    if ('defects' in parsed) {
      throw new DomainError('INVALID_INPUT', '보험사 기록의 형식이 틀렸다', parsed.defects);
    }
    const { insurer } = parsed;
    const existing = deps.repo.getInsurer(insurer.id);
    if (existing !== null && existing.insurerType !== insurer.insurerType) {
      throw new DomainError('STATE_CONFLICT', `보험사 '${insurer.id}' 의 기관 종류는 ${existing.insurerType} 이며 ${insurer.insurerType} 로 바꿀 수 없다`, [{ code: 'INSURER_TYPE_CHANGE', path: 'insurerType' }]);
    }
    deps.repo.saveInsurer(insurer);
    appendAudit(deps, actor, {
      action: 'INSURER_SAVE',
      target: `INSURER/${insurer.id}`,
      beforeVersion: existing === null ? null : canonicalDigest(existing),
      afterVersion: canonicalDigest(insurer),
      reason: null,
    });
    return insurer;
  });
}
