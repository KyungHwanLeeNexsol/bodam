// 병원 기본 정보 화면이 읽고 보내는 관리자 API 의 모양 (src/server/admin/router.ts 의 GET·PUT /api/admin/clinics/{clinicId}/settings).
// 화면 코드는 서버 모듈을 가져오지 않고 이 형식만 쓴다.

export interface ClinicSettingsView {
  /** 읽기 전용: 요청으로 바꿀 수 없다. */
  clinic: { id: string; slug: string; institutionType: string };
  /** 서비스 표시명. 병원명과 별도이며 읽기 전용이다(공개 catalog 응답의 serviceDisplayName 과 같은 값). */
  serviceDisplayName: string;
  /** 바꿀 수 있는 두 값. */
  settings: { name: string; contact: string };
  /** 읽기 전용: 병원의 현재 카탈로그 버전. 게시한 적이 없으면 null. */
  catalogVersion: string | null;
  /** 읽은 순간의 병원명·상담번호 지문. 저장(PUT)에 expectedDigest 로 그대로 되돌려 보낸다. 변경 감지용이며 화면이 해석하거나 만들지 않는다. */
  settingsDigest: string;
}

/**
 * 실제로 보내는 PUT 본문. 입력은 글자 그대로 보낸다(앞뒤 공백 정리와 값 검사는 서버가 한다): 화면이 값을 몰래 고치지 않는다.
 * 서비스 표시명·병원 id·slug·종별·카탈로그 버전은 본문에 담지 않는다(서버가 적으면 거절한다).
 */
export interface ClinicSettingsPutBody {
  name: string;
  contact: string;
  expectedDigest: string;
}
