import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { expect, test } from '../helpers/test';
import { CLINIC_1, CLINIC_2, OTHER_TREATMENT, SLUG_1, SLUG_2, TREATMENT_A, auditLog, changedStateKeys, closeAll, json, openAs, publicSnapshot, resetWorld, stateText } from '../helpers/bundle-flow';
import type { Json, PublicSnapshot, Session } from '../helpers/bundle-flow';
import { expectStartScreen } from '../helpers/kiosk';

// 병원 기본 정보 설정 (SPEC-REIMBURSEMENT-001 M7 병원 설정, AC-023e · AC-022a): 실제 Chrome, 실제 HTTP(요청 가로채기 없음 — 응답이 끊기는 상황만 page.route 로 만든다), 기본 세계 + 시험 전용 끝점(--test-hooks).
// 세계: 병원 A(=병원 1, 규칙 묶음·카탈로그 있음)·병원 B(=병원 2). 시험 세계 병원 기록의 상담번호 'TEST_FIXTURE_CONTACT' 는 전화번호 형식이 아니다(예전 형식의 값): 저장하려면 올바른 상담번호도 함께 보내야 한다.
// 증명하려는 것:
//   - 병원 A 의 관리자(HA)가 화면에서 병원명과 상담번호를 고쳐 저장하면 서버 값을 다시 읽어 보이고(앞뒤 공백은 서버가 뗀다), 병원 B 의 병원 기록·화면·공개 응답은 글자 그대로 같다. 서비스 이름 "보담"은 병원명과 별도로 보이고 입력 칸이 없다.
//   - 새로 연 키오스크 시작 화면만 새 병원명과 기존 서비스 이름 "보담"을 보인다. 저장 전에 열어 둔 키오스크는 다시 열기 전까지 그대로이고, 병원 B 키오스크는 옛 이름이다. 상담번호는 공개 응답 어디에도 없다.
//   - 치료·가격·기본비용·계산 결과·규칙 묶음·무조작 정책·카탈로그 버전은 설정 저장으로 바뀌지 않는다(공개 응답 글자 비교, 저장소에서 달라진 영역은 병원 기록과 감사 기록뿐이다).
//   - 잘못된 입력(빈 병원명·예전 형식 또는 글자가 든 상담번호)은 서버가 거절하고 화면이 어느 값이 왜 틀렸는지 알리며, 저장소 전체 사본과 감사 기록이 한 글자도 바뀌지 않고 입력은 남는다.
//   - 인증 없음은 401, 다른 병원의 HA 와 검토 담당자(RV)·플랫폼 운영자(PO)는 화면에서 안내만 보이고 직접 보낸 쓰기는 403 으로 거절되어 저장소가 그대로이다.
//   - 두 창이 같은 설정을 읽고 먼저 저장한 창이 이기면, 나중 창의 낡은 저장은 서버가 409 로 거절한다: 화면은 자동으로 덮어쓰거나 다시 보내지 않고 입력을 남긴 채 저장을 막으며, 서버 값을 다시 읽은 뒤에야 저장할 수 있다.
//   - 설정 화면을 연 뒤 카탈로그가 새로 게시돼도 저장은 막히지 않고, 저장 뒤에도 병원의 현재 카탈로그 버전은 새 버전이며 새 가격이 공개된다(과거 버전으로 돌아가지 않는다).
//   - 응답이 끊기면 저장 실패로 단정하지 않고 서버 값을 다시 읽어 알린다(저장 안 됨 / 저장됨).
// 한 파일 안에서 순서대로 돈다. 사진은 .moai/state/shots/m7-clinic-settings/ 에 남는다(육안 검토용).

test.describe.configure({ mode: 'serial' });

const SHOTS = path.resolve('.moai/state/shots/m7-clinic-settings');
async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled', fullPage: true });
}

const settingsApi = (clinicId: string): string => `/api/admin/clinics/${clinicId}/settings`;
const settingsPage = (clinicId: string): string => `/admin/${clinicId}/settings`;

// ───────────────────────── 화면 도우미 ─────────────────────────

const nameInput = (page: Page) => page.locator('[data-settings-name]');
const contactInput = (page: Page) => page.locator('[data-settings-contact]');
const saveButton = (page: Page) => page.locator('[data-settings-save]');
const reloadButton = (page: Page) => page.locator('[data-settings-reload]');
const messageOf = (page: Page, code: string) => page.locator(`[data-admin-message][data-admin-message-code="${code}"]`);

async function gotoSettings(page: Page, clinicId: string = CLINIC_1): Promise<void> {
  await page.goto(settingsPage(clinicId));
  await expect(page.locator('main[data-admin-state="ready"][data-admin-page="settings"]')).toBeVisible();
}

async function serverView(session: Session, clinicId: string = CLINIC_1): Promise<Json> {
  const response = await session.context.request.get(settingsApi(clinicId));
  expect(response.status()).toBe(200);
  return json(response);
}

// ───────────────────────── 키오스크 도우미 ─────────────────────────

async function openKiosk(browser: Browser, slug: string): Promise<Session> {
  const context = await browser.newContext({ viewport: { width: 1080, height: 1920 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await context.newPage();
  await page.goto(`/kiosk/${slug}`);
  await expectStartScreen(page);
  return { context, page };
}

const hospitalOf = (page: Page) => page.locator('.kiosk-k00__hospital');
const serviceOf = (page: Page) => page.locator('.kiosk-wordmark__name');

// ───────────────────────── 기준선 ─────────────────────────

/** 공개 응답에서 병원명만 뺀 글자: 병원명 말고는 하나도 달라지지 않았는지 견준다. */
const catalogWithoutName = (snapshot: PublicSnapshot): string => {
  const copy = JSON.parse(snapshot.catalog.text) as Json;
  delete copy['clinic']['displayName'];
  return JSON.stringify(copy);
};

const NEW_NAME = '새 시험 의원';
const NEW_CONTACT = '02-555-6666';

let baselineState = '';
let baselineAudit = 0;
let baselineA: PublicSnapshot;
let baselineB: PublicSnapshot;
let nameA0 = '';
let nameB0 = '';
let ha: Session;
let haB: Session;

const settingsSaves = async (request: Parameters<typeof auditLog>[0]): Promise<Json[]> => (await auditLog(request)).filter((entry) => entry['action'] === 'CLINIC_SETTINGS_SAVE');

test('S0 세계 만들기와 기준선: 병원 A·B 의 병원명과 공개 응답을 기록한다', async ({ browser, request }) => {
  await resetWorld(request);
  baselineState = await stateText(request);
  baselineAudit = (await auditLog(request)).length;
  baselineA = await publicSnapshot(request, SLUG_1, [TREATMENT_A]);
  baselineB = await publicSnapshot(request, SLUG_2, [OTHER_TREATMENT]);
  expect(baselineA.estimate.body['result']['state']).toBe('ESTIMATED');
  nameA0 = baselineA.catalog.body['clinic']['displayName'] as string;
  nameB0 = baselineB.catalog.body['clinic']['displayName'] as string;
  // 시험 세계에서 병원 B 는 병원 A 와 같은 기본 병원명으로 만들어진다. 그래서 병원 A 의 이름이 바뀐 뒤에야 둘이 갈리고, 병원 B 가 옛 이름 그대로인 것이 "병원 A 만 바뀐다"의 증거가 된다.
  expect(nameB0).toBe(nameA0);
  expect(baselineA.catalog.body['serviceDisplayName']).toBe('보담');
  ha = await openAs(browser, 'ha-clinic-1');
  haB = await openAs(browser, 'ha-clinic-2');
});

test('S1 첫 화면: 홈과 이동 줄에서 열리고, 서비스 이름은 병원명과 별도로 보이며 입력 칸이 없고, 병원 식별 정보는 읽기 전용이다', async () => {
  const { page } = ha;
  await page.goto('/admin');
  await expect(page.locator(`a[href="${settingsPage(CLINIC_1)}"]`)).toBeVisible();
  await page.goto(`/admin/${CLINIC_1}/treatments`);
  await page.locator('[data-admin-nav-link="settings"]').click();
  await expect(page.locator('main[data-admin-state="ready"][data-admin-page="settings"]')).toBeVisible();
  await expect(page.locator('[data-admin-nav-link="settings"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-admin-user]')).toHaveText('TEST_FIXTURE_HA_CLINIC_1');

  await expect(page.locator('[data-settings-service]')).toHaveText('보담');
  await expect(page.locator('[data-settings-clinic]')).toHaveText(nameA0);
  await expect(nameInput(page)).toHaveValue(nameA0);
  await expect(page.locator('[data-settings-clinic-id]')).toHaveText(CLINIC_1);
  await expect(page.locator('[data-settings-slug]')).toHaveText(SLUG_1);
  await expect(page.locator('[data-settings-type]')).toContainText('의원');
  await expect(page.locator('[data-settings-catalog-version]')).toHaveText(baselineA.catalog.body['catalogVersion'] as string);
  // 입력 칸은 병원명과 상담번호 둘뿐이다: 서비스 이름·식별 정보에는 입력 칸이 없다.
  await expect(page.locator('main input')).toHaveCount(2);
  await expect(page.locator('main textarea, main select')).toHaveCount(0);
  await expect(page.locator('[data-settings-service]').locator('xpath=ancestor-or-self::input')).toHaveCount(0);
  await expect(saveButton(page)).toBeDisabled();
  await expect(page.locator('[data-settings-dirty]')).toHaveAttribute('data-settings-dirty', 'false');
  await expect(page.locator('[data-settings-apply-note]')).toContainText('키오스크에는 표시되지 않습니다');
  const view = await serverView(ha);
  expect(view.serviceDisplayName).toBe('보담');
  await shoot(page, '01-first');
});

test('S2 잘못된 입력: 서버가 거절하고 어느 값이 왜 틀렸는지 알리며, 저장소·감사 기록은 한 글자도 안 바뀌고 입력은 남는다', async ({ request }) => {
  const { page } = ha;
  await gotoSettings(page);

  // (1) 병원명이 비어 있다.
  await nameInput(page).fill('   ');
  await expect(page.locator('[data-settings-name-hint]')).toContainText('병원명을 입력해 주세요');
  await expect(saveButton(page)).toBeEnabled();
  await saveButton(page).click();
  await expect(messageOf(page, 'HTTP_400')).toBeVisible();
  await expect(messageOf(page, 'HTTP_400')).toContainText('병원명은 앞뒤 공백을 뺀 1~40자');
  await expect(messageOf(page, 'HTTP_400')).toContainText('저장되지 않았고 서버의 설정은 그대로입니다');
  await expect(nameInput(page)).toHaveValue('   ');

  // (2) 병원명은 올바르지만 상담번호가 예전 형식(전화번호가 아님)이다: 서버가 상담번호를 거절한다.
  await nameInput(page).fill(NEW_NAME);
  await saveButton(page).click();
  await expect(messageOf(page, 'HTTP_400')).toContainText('상담번호는 숫자와');
  await expect(messageOf(page, 'HTTP_400')).not.toContainText('병원명은 앞뒤 공백');

  // (3) 상담번호에 글자가 있다. 코드 글자는 화면에 나오지 않는다.
  await contactInput(page).fill('02-abc-4567');
  await saveButton(page).click();
  await expect(messageOf(page, 'HTTP_400')).toContainText('상담번호는 숫자와');
  await expect(page.locator('[data-admin-message]')).not.toContainText('VALUE_INVALID');
  await expect(nameInput(page)).toHaveValue(NEW_NAME);
  await expect(contactInput(page)).toHaveValue('02-abc-4567');
  await shoot(page, '02-rejected');

  expect(await stateText(request)).toBe(baselineState);
  expect((await auditLog(request)).length).toBe(baselineAudit);
  // 거절 뒤에도 서버의 병원명은 그대로다.
  expect((await serverView(ha)).settings.name).toBe(nameA0);
});

test('S3 (AC-023e) 저장: 서버 값을 다시 읽어 보이고, 새로 연 키오스크만 새 병원명과 "보담"을 보이며, 병원 B·치료·가격·규칙·계산·무조작 정책·카탈로그 버전은 그대로다', async ({ browser, request }) => {
  // 저장 전에 열어 둔 키오스크(병원 A)와 병원 B 키오스크.
  const oldKiosk = await openKiosk(browser, SLUG_1);
  await expect(hospitalOf(oldKiosk.page)).toHaveText(nameA0);
  const kioskB = await openKiosk(browser, SLUG_2);
  await expect(hospitalOf(kioskB.page)).toHaveText(nameB0);

  const { page } = ha;
  await gotoSettings(page);
  await nameInput(page).fill(`  ${NEW_NAME}  `);
  await contactInput(page).fill(` ${NEW_CONTACT} `);
  await expect(page.locator('[data-settings-dirty]')).toHaveAttribute('data-settings-dirty', 'true');
  await saveButton(page).click();

  await expect(messageOf(page, 'SAVED')).toBeVisible();
  await expect(messageOf(page, 'SAVED')).toContainText('서버에 저장된 값을 다시 읽어');
  // 서버가 앞뒤 공백을 뗀 값을 다시 읽어 보인다.
  await expect(nameInput(page)).toHaveValue(NEW_NAME);
  await expect(contactInput(page)).toHaveValue(NEW_CONTACT);
  await expect(page.locator('[data-settings-clinic]')).toHaveText(NEW_NAME);
  await expect(page.locator('[data-settings-service]')).toHaveText('보담');
  await expect(page.locator('[data-settings-dirty]')).toHaveAttribute('data-settings-dirty', 'false');
  await expect(saveButton(page)).toBeDisabled();
  await shoot(page, '03-saved');

  const view = await serverView(ha);
  expect(view.settings).toEqual({ name: NEW_NAME, contact: NEW_CONTACT });
  expect(view.clinic).toEqual({ id: CLINIC_1, slug: SLUG_1, institutionType: 'CLINIC' });
  expect(view.catalogVersion).toBe(baselineA.catalog.body['catalogVersion']);

  // 감사 기록: 한 건. 저장소에서 달라진 영역은 병원 기록과 감사 기록뿐이다.
  const saves = await settingsSaves(request);
  expect(saves).toHaveLength(1);
  expect(saves[0]).toMatchObject({ role: 'HA', actorId: 'TEST_FIXTURE_HA_CLINIC_1', target: `CLINIC/${CLINIC_1}/SETTINGS`, reason: null });
  expect((await auditLog(request)).length).toBe(baselineAudit + 1);
  expect(changedStateKeys(baselineState, await stateText(request))).toEqual(['auditLog', 'clinics']);

  // 공개 응답: 병원 A 는 병원명만 바뀌고 나머지(치료·가격·기본비용·무조작 정책·카탈로그 버전·보험 선택지·계산)는 글자 그대로 같다. 상담번호는 어디에도 없다.
  const afterA = await publicSnapshot(request, SLUG_1, [TREATMENT_A]);
  expect(afterA.catalog.body['clinic']['displayName']).toBe(NEW_NAME);
  expect(afterA.catalog.body['serviceDisplayName']).toBe('보담');
  expect(catalogWithoutName(afterA)).toBe(catalogWithoutName(baselineA));
  expect(afterA.options.text).toBe(baselineA.options.text);
  expect(afterA.estimate.text).toBe(baselineA.estimate.text);
  for (const text of [afterA.catalog.text, afterA.options.text, afterA.estimate.text]) {
    expect(text).not.toContain(NEW_CONTACT);
    expect(text).not.toContain('contact');
  }
  // 병원 B 는 공개 응답 전체가 글자 그대로 같다.
  const afterB = await publicSnapshot(request, SLUG_2, [OTHER_TREATMENT]);
  expect(afterB.catalog.text).toBe(baselineB.catalog.text);
  expect(afterB.options.text).toBe(baselineB.options.text);
  expect(afterB.estimate.text).toBe(baselineB.estimate.text);

  // 키오스크: 저장 전에 열어 둔 화면은 다시 열기 전까지 그대로이고, 새로 연 화면만 새 병원명과 "보담"이다. 병원 B 는 옛 이름이다.
  await expect(hospitalOf(oldKiosk.page)).toHaveText(nameA0);
  const freshKiosk = await openKiosk(browser, SLUG_1);
  await expect(hospitalOf(freshKiosk.page)).toHaveText(NEW_NAME);
  await expect(freshKiosk.page.locator('.kiosk-hospital__name')).toHaveText(NEW_NAME);
  await expect(serviceOf(freshKiosk.page)).toHaveText('보담');
  await shoot(freshKiosk.page, '04-kiosk-new-name');
  await oldKiosk.page.reload();
  await expectStartScreen(oldKiosk.page);
  await expect(hospitalOf(oldKiosk.page)).toHaveText(NEW_NAME);
  const freshB = await openKiosk(browser, SLUG_2);
  await expect(hospitalOf(freshB.page)).toHaveText(nameB0);
  await expect(serviceOf(freshB.page)).toHaveText('보담');
  await closeAll(oldKiosk, kioskB, freshKiosk, freshB);
});

test('S4 병원 A 만 바뀐다: 병원 B 의 HA 는 자기 병원의 옛 이름을 보고, 병원 B 의 설정·저장소 항목은 그대로다', async () => {
  const { page } = haB;
  await gotoSettings(page, CLINIC_2);
  await expect(page.locator('[data-settings-clinic]')).toHaveText(nameB0);
  await expect(nameInput(page)).toHaveValue(nameB0);
  await expect(page.locator('[data-settings-clinic-id]')).toHaveText(CLINIC_2);
  await expect(page.locator('[data-settings-service]')).toHaveText('보담');
  const viewB = await serverView(haB, CLINIC_2);
  expect(viewB.settings.name).toBe(nameB0);
  await shoot(page, '05-clinic-b');
});

test('S5 (AC-022a) 접근 판정: 인증 없음 401, 다른 병원 HA·RV·PO 는 화면에서 안내만 보이고 직접 보낸 쓰기는 403 이며 저장소가 그대로이다', async ({ browser, request }) => {
  const before = await stateText(request);
  const digest = (await serverView(ha)).settingsDigest as string;
  const attempt = { name: '가로챈 이름', contact: '02-999-9999', expectedDigest: digest };
  const rv = await openAs(browser, 'rv-1');
  const po = await openAs(browser, 'po-1');
  const anonymous = await openAs(browser, null);

  // 다른 병원의 HA(병원 B)가 병원 A 의 설정을 열면 화면은 안내만 보인다.
  for (const [label, session] of [['병원 B 의 HA', haB], ['검토 담당자(RV)', rv], ['플랫폼 운영자(PO)', po]] as const) {
    await session.page.goto(settingsPage(CLINIC_1));
    await expect(session.page.locator('main[data-admin-state="forbidden"]'), label).toBeVisible();
    await expect(nameInput(session.page), label).toHaveCount(0);
    const read = await session.context.request.get(settingsApi(CLINIC_1));
    expect(read.status(), `${label} GET`).toBe(403);
    const write = await session.context.request.put(settingsApi(CLINIC_1), { data: attempt });
    expect(write.status(), `${label} PUT`).toBe(403);
    expect(await json(write), label).toEqual({ error: 'FORBIDDEN' });
  }
  await shoot(haB.page, '06-forbidden');

  // 로그인하지 않으면 화면은 안내만 보이고 직접 보낸 쓰기는 401 이다.
  await anonymous.page.goto(settingsPage(CLINIC_1));
  await expect(anonymous.page.locator('main[data-admin-state="unauthenticated"]')).toBeVisible();
  const anonymousWrite = await anonymous.context.request.put(settingsApi(CLINIC_1), { data: attempt });
  expect(anonymousWrite.status()).toBe(401);
  expect(await json(anonymousWrite)).toEqual({ error: 'UNAUTHENTICATED' });

  // 병원 A 의 HA 도 본문에 병원 id·slug 같은 바꿀 수 없는 값을 적으면 400 으로 거절된다.
  for (const key of ['id', 'slug', 'institutionType', 'currentCatalogVersionId', 'serviceDisplayName']) {
    const response = await ha.context.request.put(settingsApi(CLINIC_1), { data: { ...attempt, [key]: 'X' } });
    expect(response.status(), key).toBe(400);
    expect(await json(response), key).toEqual({ error: 'INVALID_REQUEST', defects: [{ code: 'FIELD_NOT_EDITABLE', path: key }] });
  }

  expect(await stateText(request)).toBe(before);
  await closeAll(rv, po, anonymous);
});

test('S6 두 창: 먼저 저장한 창이 이기고 나중 창의 낡은 저장은 409 로 거절된다. 화면은 자동으로 덮어쓰지 않고 입력을 남긴 채 저장을 막으며, 서버 값을 다시 읽은 뒤에야 저장할 수 있다', async ({ request }) => {
  const window1 = await ha.context.newPage();
  const window2 = await ha.context.newPage();
  await gotoSettings(window1);
  await gotoSettings(window2);

  await nameInput(window1).fill('창 1 의 이름');
  await saveButton(window1).click();
  await expect(messageOf(window1, 'SAVED')).toBeVisible();
  const afterFirst = await stateText(request);
  const savesAfterFirst = (await settingsSaves(request)).length;
  expect(savesAfterFirst).toBe(2); // S3 의 저장 + 창 1 의 저장

  // 창 2 는 창 1 이 저장하기 전의 값을 보고 있다.
  await nameInput(window2).fill('창 2 의 이름');
  await expect(saveButton(window2)).toBeEnabled();
  await saveButton(window2).click();
  await expect(messageOf(window2, 'CLINIC_SETTINGS_CHANGED')).toBeVisible();
  await expect(messageOf(window2, 'CLINIC_SETTINGS_CHANGED')).toContainText('아무것도 저장하지 않았고');
  await expect(window2.locator('[data-settings-stale]')).toBeVisible();
  await expect(saveButton(window2)).toBeDisabled(); // 같은 낡은 지문으로 다시 보내지 않는다
  await expect(nameInput(window2)).toHaveValue('창 2 의 이름'); // 입력은 남는다
  await shoot(window2, '07-conflict');

  // 서버는 창 1 의 값 그대로이고 저장소·감사 기록은 거절 전과 같다(자동 재시도·덮어쓰기 없음).
  expect(await stateText(request)).toBe(afterFirst);
  expect((await settingsSaves(request)).length).toBe(savesAfterFirst);
  expect((await serverView(ha)).settings.name).toBe('창 1 의 이름');
  await window2.waitForTimeout(500);
  expect((await settingsSaves(request)).length).toBe(savesAfterFirst);

  // 서버 값을 다시 읽으면 창 1 의 값으로 채워지고(창 2 의 입력은 지워진다) 막힘이 풀린다. 새 값을 고쳐 저장하면 저장된다.
  await reloadButton(window2).click();
  await expect(nameInput(window2)).toHaveValue('창 1 의 이름');
  await expect(window2.locator('[data-settings-stale]')).toHaveCount(0);
  await nameInput(window2).fill('창 2 의 두 번째 이름');
  await saveButton(window2).click();
  await expect(messageOf(window2, 'SAVED')).toBeVisible();
  expect((await serverView(ha)).settings.name).toBe('창 2 의 두 번째 이름');
  expect((await settingsSaves(request)).length).toBe(savesAfterFirst + 1);
  await window1.close();
  await window2.close();
});

test('S6b 서버 값이 원래대로 돌아와도(A→B→A) 다시 읽은 뒤에는 저장 단추가 잠기지 않는다: 409 로 막힌 창이 서버 값을 다시 읽고 처음 읽었던 값으로 저장해 지문이 처음으로 돌아가도 다음 저장이 된다', async ({ request }) => {
  const stale = await ha.context.newPage();
  const winner = await ha.context.newPage();
  await gotoSettings(stale);
  await gotoSettings(winner);
  const name0 = await nameInput(stale).inputValue(); // 두 창이 같은 값(지문 D0)을 읽는다

  // 다른 창이 먼저 저장한다 → 낡은 창의 저장은 409 이고 그 지문(D0)이 거절된 것으로 기억된다.
  await nameInput(winner).fill('다른 창이 바꾼 이름');
  await saveButton(winner).click();
  await expect(messageOf(winner, 'SAVED')).toBeVisible();
  await nameInput(stale).fill('낡은 창의 시도');
  await saveButton(stale).click();
  await expect(messageOf(stale, 'CLINIC_SETTINGS_CHANGED')).toBeVisible();
  await expect(saveButton(stale)).toBeDisabled();

  // 낡은 창이 서버 값을 다시 읽고(지문 D1) 처음 읽었던 이름으로 저장한다 → 서버 상태가 처음(D0)으로 돌아온다.
  await reloadButton(stale).click();
  await expect(nameInput(stale)).toHaveValue('다른 창이 바꾼 이름');
  await expect(saveButton(stale)).toBeDisabled(); // 고친 것이 없다
  await nameInput(stale).fill(name0);
  await saveButton(stale).click();
  await expect(messageOf(stale, 'SAVED')).toBeVisible();
  expect((await serverView(ha)).settings.name).toBe(name0);

  // 지금 읽은 지문은 거절됐던 D0 과 같다. 그래도 새로 읽은 값 위에서의 저장은 막히지 않아야 한다.
  await nameInput(stale).fill('돌아온 뒤의 새 이름');
  await expect(stale.locator('[data-settings-stale]')).toHaveCount(0);
  await expect(saveButton(stale)).toBeEnabled();
  const before = (await settingsSaves(request)).length;
  await saveButton(stale).click();
  await expect(messageOf(stale, 'SAVED')).toBeVisible();
  expect((await serverView(ha)).settings.name).toBe('돌아온 뒤의 새 이름');
  expect((await settingsSaves(request)).length).toBe(before + 1);
  await stale.close();
  await winner.close();
});

test('S7 설정을 읽은 뒤 카탈로그가 새로 게시돼도 저장은 막히지 않고, 저장 뒤에도 현재 카탈로그 버전은 새 버전이며 새 가격이 공개된다', async ({ request }) => {
  const { page } = ha;
  await gotoSettings(page);
  const opened = await serverView(ha);
  const oldVersion = opened.catalogVersion as string;
  const catalogBefore = await publicSnapshot(request, SLUG_1, [TREATMENT_A]);
  const priceBefore = (catalogBefore.catalog.body['treatments'] as Json[]).find((entry) => entry['treatmentId'] === TREATMENT_A)!['patientAmount'] as number;

  // 화면을 열어 둔 사이 병원 A 의 HA 가 실제 흐름(초안 → 미리보기 → 게시)으로 새 카탈로그를 게시한다.
  const draft = await ha.context.request.put(`/api/admin/clinics/${CLINIC_1}/catalog/draft`, { data: { priceEdits: [{ treatmentId: TREATMENT_A, patientAmount: priceBefore + 1_000 }] } });
  expect(draft.status()).toBe(200);
  const preview = await ha.context.request.post(`/api/admin/clinics/${CLINIC_1}/catalog/preview`, { data: { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds: [TREATMENT_A] } });
  expect(preview.status()).toBe(200);
  const published = await ha.context.request.post(`/api/admin/clinics/${CLINIC_1}/catalog/publish`, { data: { publishConfirmation: (await json(preview)).publishConfirmation } });
  expect(published.status()).toBe(200);
  const newVersion = (await json(published)).catalogVersion as string;
  expect(newVersion).not.toBe(oldVersion);

  // 설정 화면은 옛 값을 보여 주고 있다(지문은 카탈로그와 무관하다). 저장은 막히지 않는다.
  await expect(page.locator('[data-settings-catalog-version]')).toHaveText(oldVersion);
  await nameInput(page).fill('카탈로그 게시 뒤에 바꾼 이름');
  await saveButton(page).click();
  await expect(messageOf(page, 'SAVED')).toBeVisible();

  // 저장 뒤: 현재 카탈로그 버전은 새 버전(옛 버전으로 돌아가지 않음), 화면도 새 버전을 다시 읽어 보인다.
  const view = await serverView(ha);
  expect(view.catalogVersion).toBe(newVersion);
  expect(view.settings.name).toBe('카탈로그 게시 뒤에 바꾼 이름');
  await expect(page.locator('[data-settings-catalog-version]')).toHaveText(newVersion);
  const after = await publicSnapshot(request, SLUG_1, [TREATMENT_A]);
  expect(after.catalog.body['catalogVersion']).toBe(newVersion);
  expect(after.catalog.body['clinic']['displayName']).toBe('카탈로그 게시 뒤에 바꾼 이름');
  expect((after.catalog.body['treatments'] as Json[]).find((entry) => entry['treatmentId'] === TREATMENT_A)!['patientAmount']).toBe(priceBefore + 1_000);
  await shoot(page, '08-after-publish');
});

test('S8 응답이 끊기면 저장 실패로 단정하지 않고 서버 값을 다시 읽어 알린다: 서버에 닿지 못한 저장은 "저장 안 됨", 서버가 저장했지만 응답이 끊긴 저장은 "저장됨"', async ({ request }) => {
  const { page } = ha;
  await gotoSettings(page);
  const before = await serverView(ha);

  // (1) 요청이 서버에 닿지 못하고 끊긴다.
  await page.route(`**${settingsApi(CLINIC_1)}`, async (route) => {
    if (route.request().method() === 'PUT') await route.abort();
    else await route.continue();
  });
  await contactInput(page).fill('070-1234-5678');
  await saveButton(page).click();
  await expect(messageOf(page, 'LOST_NOT_SAVED')).toBeVisible();
  await expect(messageOf(page, 'LOST_NOT_SAVED')).toContainText('저장되어 있지 않습니다');
  await expect(contactInput(page)).toHaveValue('070-1234-5678');
  expect((await serverView(ha)).settings.contact).toBe(before.settings.contact);

  // (2) 서버는 저장했는데 응답이 끊긴다: 다시 읽어 보니 저장되어 있다.
  await page.unroute(`**${settingsApi(CLINIC_1)}`);
  await page.route(`**${settingsApi(CLINIC_1)}`, async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await saveButton(page).click();
  await expect(messageOf(page, 'LOST_CONFIRMED')).toBeVisible();
  await expect(messageOf(page, 'LOST_CONFIRMED')).toContainText('저장되어 있습니다');
  await expect(contactInput(page)).toHaveValue('070-1234-5678');
  expect((await serverView(ha)).settings.contact).toBe('070-1234-5678');
  await page.unroute(`**${settingsApi(CLINIC_1)}`);
  await shoot(page, '09-lost-response');

  // 병원 B 는 처음부터 지금까지 같다.
  expect((await serverView(haB, CLINIC_2)).settings.name).toBe(nameB0);
  expect((await publicSnapshot(request, SLUG_2, [OTHER_TREATMENT])).catalog.text).toBe(baselineB.catalog.text);
  await closeAll(ha, haB);
});
