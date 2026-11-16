// 병원 기본 정보 화면 문구 (SPEC-REIMBURSEMENT-001 M7 병원 설정). **시험용 문구이며 최종 문구가 아니다** — 관리자 문구는 소유자 확인 전이다.
// 보험 설명을 새로 쓰지 않는다. 이 화면이 말하는 것은 세 가지다:
//  - 바꿀 수 있는 것은 병원명과 상담번호뿐이다. 서비스 이름("보담")과 병원 식별 정보·현재 카탈로그 버전은 보이기만 한다.
//  - 저장한 병원명은 이미 열려 있는 키오스크에는 바로 닿지 않고 새로 연 키오스크 시작 화면부터 보인다. 상담번호는 이번에는 이 화면에서만 다룬다.
//  - 치료·가격·기본비용·계산·규칙·무조작 시간은 이 설정으로 바뀌지 않는다.
// 아래 한도(40자·20자·숫자 4개)는 서버의 잠정 값(src/server/clinic-settings.ts)을 글자로 옮긴 것이다. 같은 값인지는 tests/admin/clinic-settings-model.test.ts 가 서버 상수와 견준다.

import { ADMIN_COPY } from './copy';

const NOTHING_CHANGED = '저장되지 않았고 서버의 설정은 그대로입니다. 입력한 값은 화면에 남아 있습니다.';

export const SETTINGS_COPY = {
  navSettings: '병원 정보',
  title: '병원 기본 정보',
  note: '키오스크 시작 화면에 보이는 병원명과 병원의 상담번호를 고칩니다. 서비스 이름과 병원 식별 정보는 여기서 바꿀 수 없습니다.',
  applyNote:
    '저장한 병원명은 이미 열려 있는 키오스크 화면에는 바로 닿지 않고, 키오스크 화면을 새로 열 때(브라우저에서 페이지를 다시 열거나 새로 고칠 때)부터 시작 화면에 보입니다. 상담번호는 이번에는 이 관리자 화면에서만 다루며 키오스크에는 표시되지 않습니다. 치료·가격·기본비용·계산·규칙·무조작 시간은 이 설정으로 바뀌지 않습니다.',
  loading: ADMIN_COPY.loading,
  unauthenticated: ADMIN_COPY.unauthenticated,
  forbidden: '이 병원의 기본 정보를 관리할 권한이 없습니다. 병원 관리자 권한이 있는 계정으로 로그인해 주세요.',
  notFound: '병원을 찾을 수 없습니다.',
  loadFailed: ADMIN_COPY.loadFailed,
  retry: ADMIN_COPY.retry,
  sessionAs: ADMIN_COPY.sessionAs,
  clinicLabel: '병원',

  readonlyTitle: '바꿀 수 없는 정보',
  serviceLabel: '서비스 이름',
  serviceNote: '병원명과 별도이며 바꿀 수 없습니다.',
  clinicIdLabel: '병원 식별자',
  slugLabel: '주소 이름 (slug)',
  typeLabel: '기관 종별',
  typeNames: { CLINIC: '의원 (통원 전용)' } as Readonly<Record<string, string>>,
  versionLabel: '현재 카탈로그 버전',
  versionNone: '아직 게시한 적 없음',

  editableTitle: '바꿀 수 있는 정보',
  nameLabel: '병원명',
  nameHelp: '앞뒤 공백을 뺀 1~40자입니다. 키오스크 시작 화면에 서비스 이름과 따로 보입니다.',
  contactLabel: '상담번호',
  contactHelp: '숫자와 - ( ) + 공백만, 숫자 4개 이상 20자 이내입니다.',
  // 입력 옆의 안내. 막지는 않는다: 최종 판정은 서버가 한다.
  hintNameEmpty: '병원명을 입력해 주세요.',
  hintContactEmpty: '상담번호를 입력해 주세요.',

  save: '저장',
  saving: '저장하는 중입니다…',
  reload: '서버 값 다시 읽기',
  recheck: '서버 값 다시 확인',
  dirtyNote: '저장하지 않은 변경이 있습니다.',
  cleanNote: '화면의 값이 서버에 저장된 값과 같습니다.',
  // 서버가 "그 사이 설정이 바뀌었다" 고 거절한 뒤, 서버 값을 다시 읽기 전까지 저장 단추를 막는 이유.
  staleNote: '서버의 설정이 이 화면을 연 뒤에 바뀌어 저장할 수 없습니다. "서버 값 다시 읽기" 로 바뀐 설정을 확인해 주세요.',

  saved: '저장했습니다. 서버에 저장된 값을 다시 읽어 아래에 보여 드립니다. 이미 열려 있는 키오스크에는 적용되지 않고, 키오스크 화면을 새로 여는 때부터 새 병원명이 보입니다.',
  savedReadFailed: '저장했습니다. 다만 저장된 값을 다시 읽지 못해 저장 응답에 담긴 값을 보여 드립니다. "서버 값 다시 읽기" 로 확인해 주세요.',
  // 응답이 끊기거나 서버 오류로 끝났을 때: 저장 여부를 단정하지 않고 서버 값을 다시 읽어 알린다.
  lostConfirmed: '저장 결과를 확인하지 못했지만, 서버 값을 다시 읽어 보니 방금 입력한 값이 저장되어 있습니다.',
  lostNotSaved: '저장 결과를 확인하지 못했고, 서버 값을 다시 읽어 보니 방금 입력한 값은 저장되어 있지 않습니다. 서버의 설정은 그대로이고 입력한 값은 화면에 남아 있으니 다시 저장해 주세요.',
  lostUnverified:
    '서버의 응답을 받지 못해 저장됐는지 알 수 없고, 서버 값을 다시 읽는 데도 실패했습니다. 저장에 성공했을 수도, 실패했을 수도 있습니다. "서버 값 다시 확인" 을 눌러 확인해 주세요. 입력한 값은 화면에 남아 있습니다.',
  recheckFailed: '서버 값을 아직 확인하지 못했습니다. 잠시 뒤 "서버 값 다시 확인" 을 다시 눌러 주세요.',

  failure: {
    generic: `요청을 처리하지 못했습니다. ${NOTHING_CHANGED}`,
    notFound: `병원을 찾을 수 없습니다. ${NOTHING_CHANGED}`,
    unauthenticated: `${ADMIN_COPY.unauthenticated} ${NOTHING_CHANGED}`,
    forbidden: `이 병원의 기본 정보를 바꿀 권한이 없습니다. ${NOTHING_CHANGED}`,
    // 서버의 조건부 저장 거절(409 CLINIC_SETTINGS_CHANGED): 화면을 연 뒤 다른 창·다른 사람이 설정을 바꿨다. 자동으로 덮어쓰거나 다시 보내지 않고, 사람이 서버 값을 다시 읽어 확인하게 한다.
    settingsChanged:
      '저장하지 못했습니다. 이 화면을 연 뒤에 다른 창이나 다른 사람이 병원 기본 정보를 바꿨습니다. 다른 설정을 덮어쓰지 않으려고 아무것도 저장하지 않았고 서버의 설정은 그대로입니다. 입력한 값은 화면에 남아 있습니다. "서버 값 다시 읽기" 를 눌러 바뀐 설정을 확인한 뒤(입력한 값은 지워집니다) 다시 고쳐 저장해 주세요.',
    invalidIntro: '서버가 입력값을 받아들이지 않았습니다.',
    invalidEnd: NOTHING_CHANGED,
    // 서버가 돌려준 결함 → 문장. 코드를 그대로 보이지 않는다.
    nameInvalid: '병원명은 앞뒤 공백을 뺀 1~40자여야 하고 줄바꿈이나 눈에 보이지 않는 문자는 쓸 수 없습니다.',
    nameMissing: '병원명이 비어 있습니다.',
    contactInvalid: '상담번호는 숫자와 - ( ) + 공백만 쓸 수 있고, 숫자가 4개 이상이며 20자 이내여야 합니다.',
    contactMissing: '상담번호가 비어 있습니다.',
    digestProblem: '화면이 읽은 설정의 확인값에 문제가 있습니다. "서버 값 다시 읽기" 로 다시 읽은 뒤 저장해 주세요.',
    notEditable: '바꿀 수 없는 항목이 들어 있습니다.',
    other: '입력값의 형식이 올바르지 않습니다.',
  },
} as const;
