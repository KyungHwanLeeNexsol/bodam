import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';

// User-facing verification through the local server's real HTTP handlers.
const allocator = createServer();
allocator.listen(0, '127.0.0.1');
await once(allocator, 'listening');
const { port } = allocator.address();
await new Promise((resolve) => allocator.close(resolve));
const base = `http://127.0.0.1:${port}`;
const code = randomBytes(32).toString('base64url');
const child = spawn(process.execPath, ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'demo/admin-kiosk/server.ts'], {
  env: { ...process.env, BODAM_DEMO_ADMIN_TOKEN: code, BODAM_DEMO_PORT: String(port), NEXT_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const exit = once(child, 'exit');
const clinic = 'TEST_FIXTURE_CLINIC_1';
const pat = '/api/clinics/test-fixture-clinic-1';
const adm = `/api/admin/clinics/${clinic}`;
const scenario = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' };
let cookie = '';
const get = (path, headers) => fetch(base + path, { headers, redirect: 'manual' });
const write = (path, method, data, opts = {}) => fetch(base + path, {
  method,
  redirect: 'manual',
  headers: { origin: base, 'content-type': 'application/json', ...(opts.admin ? { cookie } : {}), ...opts.headers },
  body: JSON.stringify(data),
});
async function expectJson(res, status = 200) {
  const value = await res.json();
  assert.equal(res.status, status, JSON.stringify(value));
  return value;
}
const catalog = async () => expectJson(await get(pat + '/catalog'));
async function estimate(treatmentId) {
  const [{ catalogVersion }, { ruleBundleVersion }] = await Promise.all([catalog(), get(pat + '/insurance/options').then((res) => expectJson(res))]);
  return expectJson(await write(pat + '/estimate', 'POST', { catalogVersion, ruleBundleVersion, treatmentIds: [treatmentId], ...scenario }));
}
const prices = (body) => {
  const { hospitalPayment, expectedInsurancePayout, expectedOutOfPocketAfterPayout } = body.result.amounts;
  return [hospitalPayment, expectedInsurancePayout, expectedOutOfPocketAfterPayout];
};

try {
  let ready = false;
  for (let i = 0; i < 100 && child.exitCode === null; i += 1) {
    if ((await get('/demo/health').catch(() => null))?.ok) { ready = true; break; }
    await setTimeout(150);
  }
  assert.ok(ready, 'Local demo did not start; run npm run build first');
  assert.equal((await get(adm + '/treatments')).status, 401);
  assert.equal((await get(`/admin/${clinic}/treatments`)).headers.get('location'), '/demo/login');
  assert.equal((await get('/__harness/state')).status, 404);
  for (const [url, headers] of [['/kiosk/test-fixture-clinic-1', {}], ['/demo/login', {}]]) {
    const page = await get(url, headers);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /테스트 데이터로 계산한 예시입니다/);
  }
  const login = await fetch(base + '/demo/login', { method: 'POST', redirect: 'manual', headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code }) });
  assert.equal(login.status, 303);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
  cookie = login.headers.get('set-cookie').split(';', 1)[0];
  const adminDocument = await get(login.headers.get('location'), { cookie, 'sec-fetch-dest': 'iframe' });
  assert.equal(adminDocument.status, 200);
  assert.match(await adminDocument.text(), /\/_next\/static\//);

  const before = await catalog();
  const id = before.treatments[0].treatmentId;
  assert.deepEqual(prices(await estimate(id)), [15000, 14000, 1000]);
  const draft = { priceEdits: [{ treatmentId: id, patientAmount: 12000 }], additions: [{
    draftKey: 'DEMO_NEW', displayName: 'TEST_FIXTURE 시연용 신규 치료', description: '검증용 합성 치료', benefitType: 'BENEFIT', patientAmount: 7000,
    treatmentCode: 'TEST_FIXTURE_DEMO_NEW', procedureCodes: ['TEST_FIXTURE_DEMO_CODE'],
    documentFlags: { imaging: false, biopsy: false, opinionRequired: false },
    amountCondition: { patientType: 'TEST_FIXTURE', assumption: '검증용 금액', referenceDate: '2026-10-01' }, effectiveDate: '2026-10-01',
  }] };
  assert.equal((await write(adm + '/catalog/draft', 'PUT', draft, { admin: true, headers: { origin: 'https://other.example' } })).status, 403);
  await expectJson(await write(adm + '/catalog/draft', 'PUT', draft, { admin: true }));
  assert.deepEqual(await catalog(), before);
  const denied = await expectJson(await write(adm + '/catalog/publish', 'POST', { publishConfirmation: '0'.repeat(64) }, { admin: true }), 409);
  assert.equal(denied.reason, 'PREVIEW_REQUIRED');
  const preview = await expectJson(await write(adm + '/catalog/preview', 'POST', { treatmentIds: [id], ...scenario }, { admin: true }));
  assert.deepEqual(prices(preview.after), [17000, 16000, 1000]);
  assert.deepEqual(await catalog(), before);
  await expectJson(await write(adm + '/catalog/publish', 'POST', { publishConfirmation: preview.publishConfirmation }, { admin: true }));
  const after = await catalog();
  assert.notEqual(after.catalogVersion, before.catalogVersion);
  const result = await estimate(id);
  assert.equal(result.origin, 'TEST_FIXTURE');
  assert.equal(result.result.state, 'ESTIMATED');
  assert.deepEqual(prices(result), [17000, 16000, 1000]);
  const added = after.treatments.find((row) => row.displayName === draft.additions[0].displayName);
  assert.equal(added?.patientAmount, 7000);
  const held = await estimate(added.treatmentId);
  assert.equal(held.result.state, 'ON_HOLD');
  assert.deepEqual(prices(held), [12000, null, null]);
  assert.equal((await get('/api/admin/audit-log', { cookie })).status, 200);
  assert.equal((await write('/demo/logout', 'POST', {}, { admin: true })).status, 303);
  assert.equal((await get(adm + '/treatments', { cookie })).status, 401);
  console.log('초안/미리보기 중 키오스크 금액 불변, 게시 후 병원 결제액 15,000 → 17,000원, 예상 보험금 16,000원, 보험금 반영 후 부담액 1,000원, 신규 7,000원 치료는 보험금 산출 보류.');

  if (process.argv.includes('--browser')) {
    const { chromium } = await import('playwright');
    const executablePath = process.env.BODAM_DEMO_CHROMIUM_PATH;
    const browser = await chromium.launch(executablePath ? { executablePath } : {});
    try {
      const manager = await browser.newPage({ viewport: { width: 1280, height: 1080 } });
      manager.setDefaultTimeout(8_000);
      await manager.goto(base + '/demo/login');
      await manager.getByLabel('시험 관리자 코드').fill(code);
      await manager.getByRole('button', { name: '관리자 로그인' }).click();
      const inner = manager.frameLocator('iframe.preview-app');
      await inner.locator(`[data-admin-row="${id}"] input`).fill('13000');
      await inner.getByRole('button', { name: '초안 저장', exact: true }).click();
      await inner.locator('[data-admin-draft="saved"]').waitFor();
      await inner.getByRole('button', { name: '미리보기 계산', exact: true }).click();
      await inner.locator('[data-admin-preview]').waitFor();
      await inner.getByRole('button', { name: '게시', exact: true }).click();
      await inner.locator(`[data-admin-row="${id}"] [data-admin-current]`).filter({ hasText: /^13,000원$/ }).waitFor();
      await manager.close();

      const kiosk = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
      kiosk.setDefaultTimeout(8_000);
      await kiosk.goto(base + '/kiosk/test-fixture-clinic-1');
      await kiosk.locator('[data-test-notice]').waitFor();
      const frame = kiosk.frameLocator('iframe.preview-app');
      const nextStep = frame.getByRole('button', { name: '다음', exact: true });
      await frame.getByRole('button', { name: '시작하기', exact: true }).click();
      await frame.getByRole('radio', { name: '4세대(C4)' }).check();
      await nextStep.click();
      await frame.getByRole('radio', { name: '손해보험사' }).check();
      await nextStep.click();
      await frame.getByRole('radio').first().check();
      await nextStep.click();
      await frame.getByRole('checkbox').first().check();
      await frame.getByRole('button', { name: '예상 부담액 확인' }).click();
      await frame.locator('[data-result="normal"]').waitFor();
      assert.equal((await frame.locator('[data-kiosk-amount="hospital"] .kiosk-amount__value').innerText()).trim(), '18,000원');
      console.log('브라우저: 관리자 화면에서 13,000원 게시 후, 별도 키오스크 화면에서 병원 결제액 18,000원 확인.');
    } finally {
      await browser.close();
    }
  }
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await exit;
}
