import { expect, test } from '../helpers/test';
import { dumpStorage } from '../helpers/storage';

// 운영 구성 층 (M7 첫 기능, BRIEF D12): 빌드한 앱을 운영 구성 그대로 띄운다. 인증 공급자가 연결되기 전이라 운영 구성의 인증기는 어떤 요청도 인증하지 않는다.
// 이 층이 증명하는 것: 운영에서 관리자 기능을 쓸 수 없고(모든 관리자 API 401), 헤더·쿼리·쿠키로 역할을 주장해도 달라지지 않으며(위조 시도 401), 시험 로그인·시험 계정이 운영 구성에 없고,
// 관리자 문서도 no-store 라는 것뿐이다. 운영 자료로 가격 게시가 된다는 증거가 아니다.

const CLINIC = 'TEST_FIXTURE_CLINIC_1';

test.describe('운영 구성: 관리자 기능은 인증 공급자가 연결되기 전까지 쓸 수 없다', () => {
  test('/admin 과 가격 관리 화면은 안내만 보이고 가격 입력·초안 저장·게시 단추가 없다', async ({ page }) => {
    for (const path of ['/admin', `/admin/${CLINIC}/treatments`]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      expect(response?.headers()['cache-control'], path).toBe('no-store');
      await expect(page.locator('[data-admin-state="unauthenticated"]')).toBeVisible();
      await expect(page.locator('[data-admin-state] .admin-banner--error')).toContainText('로그인이 필요합니다');
      await expect(page.getByRole('button')).toHaveCount(0);
      await expect(page.locator('input')).toHaveCount(0);
      expect(await page.locator('body').innerText()).not.toMatch(/TEST_FIXTURE|가격 변경 내역|초안 저장/);
    }
  });

  test('보장 검토 요청 화면과 검토 대기열 화면도 안내만 보이고 단추·입력칸이 없다 (요청 자료도 보이지 않는다)', async ({ page }) => {
    for (const path of [`/admin/${CLINIC}/review-requests`, '/admin/review-queue']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      expect(response?.headers()['cache-control'], path).toBe('no-store');
      await expect(page.locator('[data-admin-state="unauthenticated"]')).toBeVisible();
      await expect(page.locator('[data-admin-state] .admin-banner--error')).toContainText('로그인이 필요합니다');
      await expect(page.getByRole('button')).toHaveCount(0);
      await expect(page.locator('input, select, textarea')).toHaveCount(0);
      expect(await page.locator('body').innerText()).not.toMatch(/TEST_FIXTURE|검토 요청 보내기|현재 게시값/);
    }
  });

  test('모든 관리자 API 는 401 이다 (일반 요청, 시험 쿠키·역할 헤더·쿼리 위조 모두), 응답은 no-store 이다', async ({ request }) => {
    const paths: Array<[string, string, unknown?]> = [
      ['GET', '/api/admin/session'],
      ['GET', `/api/admin/clinics/${CLINIC}/treatments`],
      ['PUT', `/api/admin/clinics/${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: 'TEST_FIXTURE_TREATMENT_1', patientAmount: 1 }] }],
      ['DELETE', `/api/admin/clinics/${CLINIC}/catalog/draft`],
      ['POST', `/api/admin/clinics/${CLINIC}/catalog/preview`, { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' }],
      ['POST', `/api/admin/clinics/${CLINIC}/catalog/publish`, { publishConfirmation: 'a'.repeat(64) }],
      ['GET', `/api/admin/clinics/${CLINIC}/catalog/versions`],
      // 보장 검토 요청(M7): 제출 · 병원 관리자의 요청 목록 · 검토 담당자의 대기열 — 운영 구성에서는 셋 다 쓸 수 없다.
      ['POST', `/api/admin/clinics/${CLINIC}/treatments/TEST_FIXTURE_TREATMENT_1/review-requests`, { proposed: { benefitType: 'NON_BENEFIT', procedureCodes: [], calcClass: 'GENERAL_NON_BENEFIT' } }],
      ['GET', `/api/admin/clinics/${CLINIC}/review-requests`],
      ['GET', '/api/admin/review-queue'],
    ];
    const spoof = { cookie: 'bodam_test_session=TEST_FIXTURE_SESSION_1_ha-clinic-1; role=HA', 'x-role': 'HA', 'x-clinic-id': CLINIC, authorization: 'Bearer HA' };
    for (const [method, path, body] of paths) {
      for (const headers of [{}, spoof]) {
        const response = await request.fetch(`${path}?role=HA&clinicId=${CLINIC}`, { method, headers, ...(body === undefined ? {} : { data: body }) });
        expect(response.status(), `${method} ${path}`).toBe(401);
        expect(await response.json()).toEqual({ error: 'UNAUTHENTICATED' });
        expect(response.headers()['cache-control']).toBe('no-store');
      }
    }
  });

  test('시험 로그인은 운영 구성에 없다 (/__harness 는 앱이 모르는 경로 404)', async ({ request }) => {
    expect((await request.get('/__harness/login')).status()).toBe(404);
    expect((await request.post('/__harness/login', { form: { account: 'ha-clinic-1' } })).status()).toBe(404);
  });

  test('브라우저 저장소에는 아무것도 쓰지 않는다', async ({ page }) => {
    await page.goto(`/admin/${CLINIC}/treatments`);
    await expect(page.locator('[data-admin-state="unauthenticated"]')).toBeVisible();
    const dump = await dumpStorage(page);
    expect(dump.localStorage).toEqual({});
    expect(dump.sessionStorage).toEqual({});
    expect(dump.cookie).toBe('');
    expect(dump.indexedDb).toEqual({});
  });
});
