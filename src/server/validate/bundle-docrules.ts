import { checkDocumentRuleSetStructure } from '../../engine/documents';
import type { DocumentRuleSet } from '../../engine/types';
import type { Defect } from '../domain/errors';

// 규칙 묶음 게시 검증: 서류 규칙 묶음의 구조와 `when` 계약 (design.md DD-06 "규칙 평가" 9번, AC-007f 의 게시 쪽).
// 엔진의 checkDocumentRuleSetStructure 를 그대로 부르고(두 번째 구현 없음) 결함 경로에 묶음 경로를 붙인다.
// 거절 목록: 닫힌 10종 밖의 문서 코드, 빠진·공백뿐인 reason(REASON_INVALID), 0 이상의 안전 정수가 아닌 priority, `when` 이 객체가 아님,
// `when` 의 알 수 없는 키, 열거 밖 값, true 가 아닌 플래그. 거절하지 않는 것: 빈 `rules: []`, `when: {}`, priority 0 과 Number.MAX_SAFE_INTEGER,
// 상해·질병 전용 줄의 수.
// 출처 · 약관 출처 · 승인자 · 내용 해시는 머리 검사(bundle-header.ts)가 본다.
// 이 층에는 형식 층을 통과한 객체만 온다. 그래서 엔진이 묶음 자신이 객체가 아닐 때만 내는 RULE_SET_NOT_OBJECT(`ruleSet` 경로)는 닿지 않는다.

export function checkDocumentRules(out: Defect[], ruleSet: DocumentRuleSet, path: string): void {
  const result = checkDocumentRuleSetStructure(ruleSet);
  if (!result.ok) {
    for (const defect of result.defects) {
      out.push({ code: defect.code, path: `${path}.${defect.path}` });
    }
  }
}
