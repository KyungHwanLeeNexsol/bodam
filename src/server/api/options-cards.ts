import type { Cause, Generation, InsurerType } from '../../engine/types';

// options 응답의 카드 문구 (SPEC-REIMBURSEMENT-001 M4.A, design.md DD-05·DD-19, 기획서 §3·§4).
// 카드는 병원·규칙 묶음·프로필과 무관한 고정 문구다: 승인된 프로필이 없어도, 묶음이 중지돼도 세대 5장·형태 3장·원인 3장이 항상 나온다(DD-05).
// 문구의 출처는 모두 기획서이며 여기서 새로 만든 보험 사실은 없다.
//  - 세대 5장: 기획서 §3 표의 '선택 카드'와 '이미지 기준 가입기간 안내'
//  - 형태 3장: 기획서 §4 화면 2 (손해보험사 / 생명보험사 / 그외 공제 조합과 괄호 안의 기관 예시)
//  - 원인 3장: 기획서 §4 화면 3
//  - 안내 문구: 기획서 §4 화면 1 '가입 시기를 모르실 때' 안내 문구로 고정된 문장. 1544-8069 는 문구로만 쓰고 "1588" 은 쓰지 않는다.
// 코드 목록은 엔진이 받는 열거(Generation, InsurerType, Cause)와 같은 이름이며, 같은 순서·같은 값임을 시험이 확인한다.

export interface GenerationCard {
  code: Generation;
  label: string;
  period: string;
}

export interface InsurerTypeCard {
  code: InsurerType;
  label: string;
  help: string;
}

export interface CauseCard {
  code: Cause;
  label: string;
  help: string;
}

// @MX:NOTE: [AUTO] 4세대의 기간은 기획서 표의 "2021.07.01부터의 4세대 계약" 이다. '이후 모든 계약' 이 아니다(5세대는 범위 밖, 기획서 §3).
const GENERATION_CARDS: readonly GenerationCard[] = [
  { code: 'GEN1_AS', label: '1세대(A·S)', period: '2009.08.01 이전' },
  { code: 'GEN2_C1', label: '2세대(C1)', period: '2009.08.01~2015.09.01 이전' },
  { code: 'GEN2_5_C2', label: '2.5세대(C2)', period: '2015.09.01~2017.04.01 이전' },
  { code: 'GEN3_C3', label: '3세대(C3)', period: '2017.04.01~2021.07.01 이전' },
  { code: 'GEN4_C4', label: '4세대(C4)', period: '2021.07.01부터의 4세대 계약' },
];

const INSURER_TYPE_CARDS: readonly InsurerTypeCard[] = [
  { code: 'NON_LIFE', label: '손해보험사', help: '손해보험사에서 가입한 실손보험' },
  { code: 'LIFE', label: '생명보험사', help: '생명보험사에서 가입한 실손보험' },
  { code: 'MUTUAL_AID', label: '그외 공제 조합', help: '우체국, 새마을금고 공제회, 농협' },
];

const CAUSE_CARDS: readonly CauseCard[] = [
  { code: 'INJURY', label: '다쳐서 왔어요 (상해)', help: '넘어짐, 부딪힘, 화상처럼 갑작스러운 사고로 다친 경우' },
  { code: 'ILLNESS', label: '아파서 왔어요 (질병)', help: '통증, 염증, 질환처럼 몸에 생긴 병으로 치료받는 경우' },
  { code: 'UNKNOWN', label: '잘 모르겠어요', help: '상해일 때와 질병일 때 필요한 서류를 모두 안내' },
];

const GENERATION_UNKNOWN_GUIDANCE = '보험증권이나 보험사 앱에서 가입일을 확인해 주세요. 확인이 어려우면 1544-8069로 문의해 주세요.';

export interface OptionCards {
  generations: GenerationCard[];
  insurerTypes: InsurerTypeCard[];
  causes: CauseCard[];
  guidance: { generationUnknown: string };
}

/** 요청마다 새 사본을 낸다(호출자가 고쳐도 다음 응답에 영향이 없다). */
export function optionCards(): OptionCards {
  return {
    generations: GENERATION_CARDS.map((card) => ({ ...card })),
    insurerTypes: INSURER_TYPE_CARDS.map((card) => ({ ...card })),
    causes: CAUSE_CARDS.map((card) => ({ ...card })),
    guidance: { generationUnknown: GENERATION_UNKNOWN_GUIDANCE },
  };
}
