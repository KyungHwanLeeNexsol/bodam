// 병원 무조작 정책 화면 문구 (SPEC-REIMBURSEMENT-001 M7 병원별 무조작 정책 설정). **시험용 문구이며 최종 문구가 아니다** — 관리자 문구는 소유자 확인 전이다.
// 보험 설명을 새로 쓰지 않는다. 이 화면이 말하는 것은 세 가지다:
//  - 저장은 정책 전체를 한 번에 바꾼다. "기본값" 줄은 저장하지 않은 상태이고, 줄을 직접 설정하면 그 값이 저장된다.
//  - 이미 열려 있는 키오스크에는 바로 닿지 않는다. 새로 연 키오스크부터 바뀐 시간을 쓴다.
//  - 이용 완료 화면의 자동 복귀는 비워 두면 자동으로 돌아가지 않는다(기본 시간을 정해 두지 않았다).

import { ADMIN_COPY } from './copy';
import type { IdleScreenKind } from './idle-policy-types';

/** 화면 종류의 이름과 묶음 설명. 서버 주석의 묶음(입력 단계 / 정상·보장 제외 결과 / 계산 근거·필요 서류 / 보류 결과 / 세대 확인 안내·계산 중·통신 오류)을 따른다. */
export const IDLE_SCREEN_LABEL: Readonly<Record<IdleScreenKind, { name: string; detail: string }>> = {
  INPUT: { name: '입력 단계', detail: '세대·보험사 형태·치료 원인·치료 고르기' },
  RESULT: { name: '결과 화면', detail: '정상·보장 제외 결과' },
  BASIS_AND_DOCUMENTS: { name: '계산 근거·필요 서류', detail: '계산 근거와 서류 안내' },
  HOLD_RESULT: { name: '보류 결과', detail: '계산을 보류한 결과' },
  NOTICE_PROGRESS_ERROR: { name: '안내·계산 중·통신 오류', detail: '세대 확인 안내, 계산 중, 통신 오류' },
};

const NOTHING_CHANGED = '저장되지 않았고 서버의 설정은 그대로입니다. 입력한 값은 화면에 남아 있습니다.';

export const IDLE_COPY = {
  navIdlePolicy: '무조작 시간',
  title: '무조작 시간 설정',
  note: '환자가 키오스크를 만지지 않을 때 "계속 사용하시겠어요?" 안내를 띄우는 시간(경고)과, 입력한 내용을 지우고 처음 화면으로 돌아가는 시간(초기화)을 화면 종류별로 정합니다.',
  applyNote:
    '저장한 시간은 이미 열려 있는 키오스크에는 적용되지 않습니다. 키오스크 화면을 새로 열 때(브라우저에서 페이지를 다시 열거나 새로 고칠 때) 바뀐 시간을 읽어 씁니다. 처음 화면으로 돌아가는 것만으로는 다시 읽지 않습니다. 가격·보장 규칙·계산 결과는 이 설정으로 바뀌지 않습니다.',
  replaceNote:
    '저장은 설정 전체를 한 번에 바꿉니다. "기본값" 으로 표시된 줄은 저장하지 않은 상태라 기본 시간을 따르고, 시간을 고치면 그 줄은 "직접 설정" 이 되어 저장됩니다. "기본값으로 되돌리기" 를 누른 줄은 저장할 때 설정이 지워져 기본 시간으로 돌아갑니다.',
  loading: ADMIN_COPY.loading,
  unauthenticated: ADMIN_COPY.unauthenticated,
  forbidden: '이 병원의 무조작 시간을 관리할 권한이 없습니다. 병원 관리자 권한이 있는 계정으로 로그인해 주세요.',
  notFound: '병원을 찾을 수 없습니다.',
  loadFailed: ADMIN_COPY.loadFailed,
  retry: ADMIN_COPY.retry,
  sessionAs: ADMIN_COPY.sessionAs,
  clinicLabel: '병원',

  tableCaption: '화면 종류별 경고·초기화 시간 (초)',
  colScreen: '화면 종류',
  colWarn: '경고 (초)',
  colReset: '초기화 (초)',
  colSource: '현재 설정',
  colControls: '관리',
  sourceDefault: '기본값',
  sourceCustom: '직접 설정',
  defaultLine: (warn: number, reset: number): string => `기본 ${warn}초 / ${reset}초`,
  warnLabel: (screen: string): string => `${screen} 경고 시간 (초)`,
  resetLabel: (screen: string): string => `${screen} 초기화 시간 (초)`,
  revertDefault: '기본값으로 되돌리기',
  revertDefaultLabel: (screen: string): string => `${screen} 기본값으로 되돌리기`,
  revertedNote: '저장하면 기본값으로 돌아갑니다',

  holdTitle: '이용 완료 화면의 자동 복귀',
  holdNote: '"이용 완료" 를 누른 뒤 화면이 자동으로 처음으로 돌아가기까지의 시간입니다. 켜지 않으면 자동으로 돌아가지 않고, 처음 화면으로 돌아가는 버튼을 눌러야 합니다. 기본 시간은 정해져 있지 않고, 20초 이상 같은 하한도 없습니다(1초 이상의 정수).',
  holdToggle: '자동으로 처음 화면으로 돌아가기',
  holdSeconds: '복귀까지 걸리는 시간 (초)',
  holdOffState: '자동 복귀 없음',
  holdOnState: (seconds: number): string => `${seconds}초 뒤 자동으로 복귀`,

  // 입력 옆의 안내. 막지는 않는다: 최종 판정은 서버가 한다.
  hintInteger: '0 이상의 정수(초)를 입력해 주세요.',
  hintLead: (min: number): string => `초기화 시간은 경고 시간보다 ${min}초 이상 길어야 합니다.`,
  hintHold: '1 이상의 정수(초)를 입력해 주세요.',

  save: '저장',
  saving: '저장하는 중입니다…',
  saveHintNothing: '고친 내용이 있어야 저장할 수 있습니다.',
  reload: '서버 값 다시 읽기',
  reloadHint: '저장하지 않은 입력을 버리고 서버에 저장된 값을 다시 읽습니다.',
  recheck: '서버 값 다시 확인',
  dirtyNote: '저장하지 않은 변경이 있습니다.',
  cleanNote: '화면의 값이 서버에 저장된 값과 같습니다.',

  saved: '저장했습니다. 서버에 저장된 값을 다시 읽어 아래에 보여 드립니다. 이미 열려 있는 키오스크에는 적용되지 않고, 키오스크 화면을 새로 여는 때부터 바뀐 시간을 씁니다.',
  savedReadFailed: '저장했습니다. 다만 저장된 값을 다시 읽지 못해 저장 응답에 담긴 값을 보여 드립니다. "서버 값 다시 읽기" 로 확인해 주세요.',
  // 응답이 끊기거나 서버 오류로 끝났을 때: 저장 여부를 단정하지 않고 서버 값을 다시 읽어 알린다.
  lostConfirmed: '저장 결과를 확인하지 못했지만, 서버 값을 다시 읽어 보니 방금 입력한 값이 저장되어 있습니다.',
  lostNotSaved: '저장 결과를 확인하지 못했고, 서버 값을 다시 읽어 보니 방금 입력한 값은 저장되어 있지 않습니다. 서버의 설정은 그대로이고 입력한 값은 화면에 남아 있으니 다시 저장해 주세요.',
  lostUnverified:
    '서버의 응답을 받지 못해 저장됐는지 알 수 없고, 서버 값을 다시 읽는 데도 실패했습니다. 저장에 성공했을 수도, 실패했을 수도 있습니다. "서버 값 다시 확인" 을 눌러 확인해 주세요. 입력한 값은 화면에 남아 있습니다.',
  serverChanged:
    '저장하기 전에 확인해 보니 서버의 설정이 이 화면을 연 뒤에 바뀌어 있었습니다(다른 창이나 다른 사람이 저장했을 수 있습니다). 다른 설정을 덮어쓰지 않으려고 아무것도 저장하지 않았고, 서버에 저장된 값을 다시 읽어 아래에 보여 드립니다. 입력했던 값은 지워졌으니 확인한 뒤 다시 고쳐 저장해 주세요.',
  precheckFailed: '저장하기 전에 서버의 현재 설정을 확인하지 못해 아무것도 저장하지 않았습니다. 입력한 값은 화면에 남아 있습니다. 잠시 뒤 다시 저장해 주세요.',
  recheckFailed: '서버 값을 아직 확인하지 못했습니다. 잠시 뒤 "서버 값 다시 확인" 을 다시 눌러 주세요.',

  failure: {
    generic: `요청을 처리하지 못했습니다. ${NOTHING_CHANGED}`,
    notFound: `병원을 찾을 수 없습니다. ${NOTHING_CHANGED}`,
    unauthenticated: `${ADMIN_COPY.unauthenticated} ${NOTHING_CHANGED}`,
    forbidden: `이 병원의 무조작 시간을 바꿀 권한이 없습니다. ${NOTHING_CHANGED}`,
    invalidIntro: '서버가 입력값을 받아들이지 않았습니다.',
    invalidEnd: NOTHING_CHANGED,
    // 서버가 돌려준 결함 → 문장. 코드를 그대로 보이지 않는다.
    warnInvalid: (screen: string): string => `${screen}: 경고 시간은 0 이상의 정수(초)여야 합니다.`,
    resetInvalid: (screen: string): string => `${screen}: 초기화 시간은 0 이상의 정수(초)여야 합니다.`,
    warnMissing: (screen: string): string => `${screen}: 경고 시간이 비어 있습니다.`,
    resetMissing: (screen: string): string => `${screen}: 초기화 시간이 비어 있습니다.`,
    lead: (screen: string, min: number): string => `${screen}: 초기화 시간은 경고 시간보다 ${min}초 이상 길어야 합니다.`,
    screenUnknown: '알 수 없는 화면 종류가 들어 있습니다.',
    holdInvalid: '이용 완료 자동 복귀 시간은 1 이상의 정수(초)여야 합니다.',
    holdMissing: '이용 완료 자동 복귀 시간이 비어 있습니다.',
    other: '입력값의 형식이 올바르지 않습니다.',
  },
} as const;
