import type { Origin } from '../../../src/engine/types';
import { createAdminServices } from '../../../src/server/admin/services';
import type { AdminServices } from '../../../src/server/admin/services';
import type { AdminAuthenticator, AdminIdentity } from '../../../src/server/admin/auth';
import type { ApiServices } from '../../../src/server/api/services';
import type { World } from './lifecycle.fixture';
import { TEST_FIXTURE_CLINIC_ID } from './actors.fixture';
import { createTestServices } from './api-composition.fixture';
import type { TestServicesOptions } from './api-composition.fixture';
import { OTHER_CLINIC_ID } from './versioning.fixture';

// 시험 자료(TEST_FIXTURE). 관리자 API(M7 첫 기능) 시험이 쓰는 시험 계정과 시험 인증기다. 모두 가짜 주체이며 실제 운영 계정이 아니다.
// 이 파일은 tests/ 아래에만 있고 운영 진입점(src/server/composition.ts, src/app/**)은 가져오지 않는다(tests/boundary/production-no-fixtures.test.ts).
// 운영 구성은 인증기가 UNCONNECTED 로 고정이라 아래 인증기는 운영에 닿는 길이 없다.

/** 시험 계정. 키는 로그인 화면(시험 앞단)과 시험이 쓰는 이름이다. */
export const TEST_ACCOUNTS = {
  /** 병원 1 의 병원 관리자(HA). */
  'ha-clinic-1': { userId: 'TEST_FIXTURE_HA_CLINIC_1', label: '병원 1 관리자 (HA)', home: TEST_FIXTURE_CLINIC_ID, memberships: [{ clinicId: TEST_FIXTURE_CLINIC_ID, role: 'HA' }] },
  /** 병원 2 의 병원 관리자(HA): 병원 1 의 자원에는 권한이 없다. */
  'ha-clinic-2': { userId: 'TEST_FIXTURE_HA_CLINIC_2', label: '병원 2 관리자 (HA)', home: OTHER_CLINIC_ID, memberships: [{ clinicId: OTHER_CLINIC_ID, role: 'HA' }] },
  /** 보험 기준 검토 담당자(RV): 가격 수정·카탈로그 게시 권한이 없다. */
  'rv-1': { userId: 'TEST_FIXTURE_RV_PERSON_1', label: '보험 기준 검토 담당자 (RV)', home: TEST_FIXTURE_CLINIC_ID, memberships: [{ clinicId: null, role: 'RV' }] },
  /** 둘째 보험 기준 검토 담당자(RV, 플랫폼 단위 소속): 매핑 검토에서 작성자(rv-1)와 다른 사람으로 승인·반려한다. */
  'rv-2': { userId: 'TEST_FIXTURE_RV_PERSON_2', label: '보험 기준 검토 담당자 2 (RV)', home: TEST_FIXTURE_CLINIC_ID, memberships: [{ clinicId: null, role: 'RV' }] },
  /** 병원 1 에 매인 RV: 플랫폼 단위 소속이 아니므로 검토 대기열·매핑 검토 경로가 거절(403)된다. 로그인하면 병원 1 의 가격 관리 화면으로 들어간다. */
  'rv-clinic-1': { userId: 'TEST_FIXTURE_RV_CLINIC_BOUND_1', label: '병원 1 소속 검토 담당자 (RV, 병원에 매임)', home: TEST_FIXTURE_CLINIC_ID, memberships: [{ clinicId: TEST_FIXTURE_CLINIC_ID, role: 'RV' }] },
  /** 플랫폼 운영자(PO): 가격 수정·카탈로그 게시 권한이 없다. */
  'po-1': { userId: 'TEST_FIXTURE_PO_PERSON_1', label: '플랫폼 운영자 (PO)', home: TEST_FIXTURE_CLINIC_ID, memberships: [{ clinicId: null, role: 'PO' }] },
} as const;
export type TestAccountKey = keyof typeof TEST_ACCOUNTS;

export function identityOf(key: TestAccountKey): AdminIdentity {
  const account = TEST_ACCOUNTS[key];
  return { userId: account.userId, memberships: account.memberships.map((membership) => ({ clinicId: membership.clinicId, role: membership.role })) };
}

export const TEST_SESSION_COOKIE = 'bodam_test_session';

/**
 * 시험 인증기: 요청의 쿠키 `bodam_test_session` 값이 로그인으로 만든 세션 토큰일 때만 그 세션의 신원을 낸다(서버가 가진 세션 표에서만 읽는다).
 * 쿠키가 없거나 모르는 토큰이면 null 이다. 헤더·쿼리의 역할·사용자는 읽지 않는다(시험이 위조 시도로 확인한다).
 * 토큰은 시험 앞단이 만들어 쿠키로 내려 준다. 이 클래스는 시험용이다(운영에는 없다).
 */
export class TestAdminAuthenticator implements AdminAuthenticator {
  private readonly sessions = new Map<string, AdminIdentity>();
  private counter = 0;

  /** 계정으로 로그인하고 세션 토큰을 돌려준다. */
  login(key: TestAccountKey): string {
    this.counter += 1;
    const token = `TEST_FIXTURE_SESSION_${this.counter}_${key}`;
    this.sessions.set(token, identityOf(key));
    return token;
  }

  logout(token: string): void {
    this.sessions.delete(token);
  }

  authenticate(request: Request): Promise<AdminIdentity | null> {
    const cookie = request.headers.get('cookie') ?? '';
    const token = cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${TEST_SESSION_COOKIE}=`))
      ?.slice(TEST_SESSION_COOKIE.length + 1);
    return Promise.resolve(token === undefined ? null : (this.sessions.get(token) ?? null));
  }
}

/** 항상 같은 신원(또는 null = 인증 안 됨)을 내는 인증기. 단위·통합 시험용이다. */
export function staticAuthenticator(identity: AdminIdentity | null): AdminAuthenticator {
  return { authenticate: () => Promise.resolve(identity) };
}

export interface AdminTestOptions {
  authenticator: AdminAuthenticator;
  api?: Partial<TestServicesOptions>;
  /** 새 치료의 출처. 생략하면 시험 자료 출처(TEST_FIXTURE)다: 시험 구성의 줄 허용 출처가 그것을 받는다. 운영 구성은 이 값을 정하지 못한다(기본 OPERATING). */
  newTreatmentOrigin?: Origin;
}

/** 시험 세계의 저장소·시계·식별자 생성기를 그대로 쓰는 관리자 서비스. 공개 API 서비스(api)도 같은 저장소다. */
export function adminServicesOf(world: World, options: AdminTestOptions): { admin: AdminServices; api: ApiServices } {
  const api = createTestServices({ repo: world.repo, ...options.api });
  return {
    api,
    admin: createAdminServices({ api, clock: world.clock, ids: world.ids, authenticator: options.authenticator, newTreatmentOrigin: options.newTreatmentOrigin ?? 'TEST_FIXTURE' }),
  };
}
