import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { APIRequestContext, APIResponse, Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers/test';

// 관리자 매핑 검토 흐름 (SPEC-REIMBURSEMENT-001 M7 매핑 검토): 병원 관리자(HA)가 검토를 요청하고, 검토 담당자(RV, 플랫폼 단위 소속) 한 명이 매핑 초안을 작성·제출하고,
// 작성자와 다른 검토 담당자가 승인하거나 사유와 함께 반려하며, 병원 관리자가 처리 상태와 반려 사유를 읽는다.
// 앞단(tests/e2e/harness/server.ts, 이 파일 전용 인스턴스 ADMIN_MAPPING_PORT)이 실제 관리자 핸들러·공개 핸들러를 시험 인증기와 시험 자료(TEST_FIXTURE)로 돌린다.
// 통신 가로채기는 쓰지 않는다: 모든 요청이 실제 HTTP 로 앞단을 지난다. 브라우저 문맥을 계정마다 따로 열어(쿠키가 문맥마다 다르다) 병원 1·2 관리자, 검토 담당자 둘, 병원에 매인 RV, 운영자, 로그인 없음을 쓴다.
// 증명하려는 것:
//   - 승인은 검토 기록일 뿐이다: 매핑은 APPROVED 가 되고(PUBLISHED 가 아니다) 요청이 닫히지만, 공개 카탈로그·보험 선택지·같은 조건의 계산 결과·관리자 치료 목록은 전후로 같다.
//   - 분류 확인이 남은 치료(서버가 NEEDS_REVIEW 로 정한 새 치료)는 매핑을 승인해도 계산이 보류(ON_HOLD)로 남는다. 화면은 계산이 가능해졌다고 말하지 않는다.
//   - 본인이 작성한 매핑은 승인할 수 없다(화면에 승인 단추가 없고, API 도 403). 사유 없는 반려는 화면이 막고 서버도 400 이다.
//   - 연결되지 않은 매핑·닫힌 요청·중복 초안·치료 불일치·권한 없는 계정·위조·잘못된 본문·잘못된 방법은 모두 의도한 응답으로 거절되고 500 이 없으며, 거절 뒤에도 관찰한 저장 상태가 그대로다.
//   - 치료를 숨겨 게시한 뒤에는 대기 중 요청을 승인할 수 없고(409 TREATMENT_HIDDEN), 화면은 "숨긴 치료입니다"를 보인다("현재 게시 목록에 없습니다"가 아니다).
// 증명하지 못하는 것(정직한 한계):
//   - 브라우저 흐름으로는 치료의 보장 판단 필드(치료 코드·행위 코드·급여 구분·분류)를 바꾸거나 카탈로그 참조를 깨뜨릴 길이 없다. 그래서 REVIEWED_FIELDS_CHANGED(검토 뒤 판단 필드 변경)와
//     UNREADABLE(현재 게시값 읽기 실패)의 화면 표시는 여기서 보지 못한다. 두 경우의 서버 동작과 대기열 응답은 tests/server·tests/api 의 시험이 저장소를 직접 만져 증명하고, 화면 문장은 tests/admin 의 순수 계산 시험이 본다.
//   - 운영 인증(운영 구성은 별도 층 unavailable.production.spec.ts), 규칙 묶음 게시·치료 분류 전환(이 단계에 없다), 실제 병원 자료.
// 한 파일 안에서 순서대로 돈다: 앞 시험이 만든 요청을 뒤 시험이 이어받는다. 카탈로그를 바꾸는 단계(S1 의 새 치료 게시, S7 의 숨김)를 뺀 모든 단계는 공개 자료가 기준선과 같음을 본다.
// 사진은 .moai/state/shots/m7-mapping-review/ 에 남는다(육안 검토용 자료이며 시험 결과가 아니다).

test.describe.configure({ mode: 'serial' });

const CLINIC_1 = 'TEST_FIXTURE_CLINIC_1';
const CLINIC_2 = 'TEST_FIXTURE_CLINIC_2';
const SLUG = 'test-fixture-clinic-1';
const API_1 = `/api/admin/clinics/${CLINIC_1}`;
const API_2 = `/api/admin/clinics/${CLINIC_2}`;
const QUEUE = '/api/admin/review-queue';
const HISTORY = '/api/admin/review-history';
const T1 = 'TEST_FIXTURE_TREATMENT_1';
const T2 = 'TEST_FIXTURE_TREATMENT_2';
const NAME_A = 'TEST_FIXTURE 시험 치료 A (급여)';
const NAME_B = 'TEST_FIXTURE 시험 치료 B (비급여)';
const NAME_C = 'TEST_FIXTURE 시험 치료 C (새로 추가)';
const RV_1_USER = 'TEST_FIXTURE_RV_PERSON_1';
const RV_2_USER = 'TEST_FIXTURE_RV_PERSON_2';
const CONDITION = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' };
const APPROVED_TEXT = '검토 승인됨 — 환자 화면에는 아직 반영되지 않았습니다';
const NOT_IN_LIST_TEXT = '현재 게시 목록에 없습니다';
const HIDDEN_TEXT = '숨긴 치료입니다(현재 게시값 없음)';
const SOURCE = { insurerDocumentId: 'TEST_FIXTURE_DOC_1', revisionDate: '2026-01-01', clauseOrPage: 'TEST_FIXTURE_P3', effectiveDate: '2026-01-01', verifiedBy: 'TEST_FIXTURE_VERIFIER', verifiedAt: '2026-01-02' };
const ADDITION = {
  draftKey: 'new-c',
  displayName: NAME_C,
  description: 'TEST_FIXTURE 새 치료 설명',
  benefitType: 'NON_BENEFIT',
  patientAmount: 8_000,
  treatmentCode: 'TEST_FIXTURE_NEW_TC',
  procedureCodes: ['TEST_FIXTURE_NEW_PROC_A'],
  documentFlags: { imaging: false, biopsy: false, opinionRequired: false },
  amountCondition: { patientType: 'TEST_FIXTURE_PATIENT', assumption: 'TEST_FIXTURE_ASSUMPTION', referenceDate: '2026-11-01' },
  effectiveDate: '2026-11-01',
};
const DRAFT_BODY = {
  mapping: {
    scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }],
    decision: 'COVERED',
    groupKey: 'TEST_FIXTURE_GROUP',
    validity: { from: '2026-01-01', to: '2026-12-31' },
    policySources: [SOURCE],
  },
};

const SHOTS = path.resolve('.moai/state/shots/m7-mapping-review');
let shotCount = 0;
const shoot = async (page: Page, name: string): Promise<void> => {
  mkdirSync(SHOTS, { recursive: true });
  shotCount += 1;
  await page.screenshot({ path: path.join(SHOTS, `${String(shotCount).padStart(2, '0')}-${name}.png`), animations: 'disabled', fullPage: true });
};

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface Session {
  context: BrowserContext;
  page: Page;
}

async function login(page: Page, account: string): Promise<void> {
  await page.goto('/__harness/login');
  await page.locator(`[data-test-account="${account}"]`).click();
  // 플랫폼 단위 검토 담당자(rv-1·rv-2)는 검토 대기열로, 나머지(병원에 매인 RV 포함)는 소속 병원의 가격 관리로 들어간다.
  await expect(page).toHaveURL(/\/admin\/(?:[^/]+\/treatments|review-queue|rule-scope)$/);
}

async function openAs(browser: Browser, account: string | null): Promise<Session> {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (account !== null) await login(page, account);
  return { context, page };
}

const json = async (response: APIResponse): Promise<Json> => (await response.json()) as Json;

/** 키오스크 문서가 보는 공개 자료와 관리자 치료 목록의 기록: 이 값들이 검토 처리 전후로 같아야 한다. */
async function publicState(request: APIRequestContext, treatmentIds: string[] = [T1, T2]): Promise<Json> {
  const catalog = await json(await request.get(`/api/clinics/${SLUG}/catalog`));
  const options = await json(await request.get(`/api/clinics/${SLUG}/insurance/options`));
  const estimateResponse = await request.post(`/api/clinics/${SLUG}/estimate`, { data: { catalogVersion: catalog['catalogVersion'], ruleBundleVersion: options['ruleBundleVersion'], ...CONDITION, treatmentIds } });
  return { catalog, options, estimateStatus: estimateResponse.status(), estimate: await json(estimateResponse) };
}

async function adminTreatments(session: Session): Promise<Json> {
  const response = await session.context.request.get(`${API_1}/treatments`);
  expect(response.status()).toBe(200);
  return json(response);
}

/** 기존 관리자 흐름(초안 → 미리보기 → 게시)으로 병원 1 의 카탈로그를 바꾼다. */
async function publishDraft(session: Session, draft: unknown): Promise<void> {
  const put = await session.context.request.put(`${API_1}/catalog/draft`, { data: draft });
  expect(put.status()).toBe(200);
  const preview = await session.context.request.post(`${API_1}/catalog/preview`, { data: CONDITION });
  expect(preview.status()).toBe(200);
  const published = await session.context.request.post(`${API_1}/catalog/publish`, { data: { publishConfirmation: (await json(preview))['publishConfirmation'] } });
  expect(published.status()).toBe(200);
}

const queueOf = async (rv: Session): Promise<Json[]> => (await json(await rv.context.request.get(QUEUE)))['queue'] as Json[];
const historyOf = async (rv: Session): Promise<Json[]> => (await json(await rv.context.request.get(HISTORY)))['history'] as Json[];

async function openEntry(rv: Session, treatmentId: string): Promise<Json> {
  const entry = (await queueOf(rv)).find((candidate) => candidate['treatmentId'] === treatmentId);
  expect(entry, `열린 요청 ${treatmentId}`).toBeTruthy();
  return entry as Json;
}

const row = (page: Page, requestId: string): Locator => page.locator(`[data-admin-queue-row="${requestId}"]`);
const itemUrl = (mappingId: string, version: string, action: 'submit' | 'approve' | 'reject'): string => `/api/admin/mappings/${encodeURIComponent(mappingId)}/versions/${encodeURIComponent(version)}/${action}`;
const draftUrl = (requestId: string): string => `/api/admin/review-requests/${encodeURIComponent(requestId)}/mappings`;
const requestUrl = (apiBase: string, treatmentId: string): string => `${apiBase}/treatments/${encodeURIComponent(treatmentId)}/review-requests`;

/** HA 가 화면에서 검토 요청을 보낸다. 요청 id 를 돌려준다. */
async function requestViaUi(page: Page, treatmentId: string, name: string, calcClass: string): Promise<string> {
  await page.goto(`/admin/${CLINIC_1}/review-requests`);
  await expect(page.locator('[data-admin-page="review-requests"]')).toBeVisible();
  await page.getByRole('button', { name: `${name} 검토 요청`, exact: true }).click();
  const form = page.locator(`[data-admin-review-form="${treatmentId}"]`);
  await form.getByRole('combobox', { name: '보험 계산 분류' }).selectOption(calcClass);
  const posted = page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith(`/treatments/${treatmentId}/review-requests`));
  await form.getByRole('button', { name: '검토 요청 보내기' }).click();
  const response = await posted;
  expect(response.status()).toBe(200);
  const created = (await response.json()) as Json;
  await expect(page.locator(`[data-admin-review-row="${treatmentId}"] [data-admin-review-status]`)).toHaveText('검토 요청됨 (대기 중)');
  return created['reviewRequest']['id'] as string;
}

/** 검토 담당자 화면에서 매핑 초안 양식을 채우고 저장한다. 응답(JSON)을 돌려준다. */
async function draftViaUi(page: Page, requestId: string, kind: 'COVERED' | 'EXCLUDED', tag: string): Promise<Json> {
  const entry = row(page, requestId);
  await entry.getByRole('button', { name: '매핑 초안 작성', exact: true }).click();
  const form = entry.locator(`[data-admin-draft-form="${requestId}"]`);
  await expect(form).toBeVisible();
  if (kind === 'EXCLUDED') {
    await form.getByLabel('보장 제외', { exact: true }).check();
    await form.getByLabel('제외 사유', { exact: true }).fill(`TEST_FIXTURE 제외 사유 ${tag}`);
  } else {
    await form.getByLabel('그룹 키', { exact: true }).fill(`TEST_FIXTURE_GROUP_${tag}`);
  }
  await form.getByRole('checkbox', { name: '4세대(C4) · 손해보험사' }).check();
  await form.getByRole('checkbox', { name: '4세대(C4) · 생명보험사' }).check();
  await form.getByLabel('유효 기간 시작일 (YYYY-MM-DD)', { exact: true }).fill('2026-01-01');
  await form.getByLabel('유효 기간 종료일 (YYYY-MM-DD)', { exact: true }).fill('2026-12-31');
  await form.getByLabel('보험사 문서 식별', { exact: true }).fill(SOURCE.insurerDocumentId);
  await form.getByLabel('개정일', { exact: true }).fill(SOURCE.revisionDate);
  await form.getByLabel('조항 또는 쪽', { exact: true }).fill(SOURCE.clauseOrPage);
  await form.getByLabel('효력일', { exact: true }).fill(SOURCE.effectiveDate);
  await form.getByLabel('확인자', { exact: true }).fill(SOURCE.verifiedBy);
  await form.getByLabel('확인일', { exact: true }).fill(SOURCE.verifiedAt);
  const posted = page.waitForResponse((candidate) => candidate.request().method() === 'POST' && candidate.url().endsWith(draftUrl(requestId)));
  await form.getByRole('button', { name: '초안 저장' }).click();
  const response = await posted;
  expect(response.status()).toBe(200);
  await expect(entry.locator('[data-admin-queue-stage="DRAFT"]')).toBeVisible();
  return (await response.json()) as Json;
}

/** 저장 상태 관찰: 두 검토 담당자가 보는 대기열·처리 완료, 두 병원 관리자가 각자 보는 요청 목록, 공개 자료. 거절된 시도 뒤에 이 관찰이 그대로여야 한다. */
async function observe(rv: Session, ha1: Session, ha2: Session): Promise<Json> {
  return {
    queue: await json(await rv.context.request.get(QUEUE)),
    history: await json(await rv.context.request.get(HISTORY)),
    clinic1: await json(await ha1.context.request.get(`${API_1}/review-requests`)),
    clinic2: await json(await ha2.context.request.get(`${API_2}/review-requests`)),
    publicState: await publicState(rv.context.request),
    treatments: await json(await ha1.context.request.get(`${API_1}/treatments`)),
  };
}

let stable: Json;
let stableAdmin: Json;
let idC = '';
let reqA = '';
let reqB = '';
let reqC = '';
let mappingA: { id: string; version: string } = { id: '', version: '' };
let mappingB: { id: string; version: string } = { id: '', version: '' };
let mappingC: { id: string; version: string } = { id: '', version: '' };

test('S0 기준선: 공개 카탈로그·보험 선택지·계산 결과·관리자 치료 목록을 읽고, 요청이 하나도 없음을 확인한다', async ({ browser }) => {
  rmSync(SHOTS, { recursive: true, force: true });
  const ha1 = await openAs(browser, 'ha-clinic-1');
  const rv1 = await openAs(browser, 'rv-1');
  try {
    const state = await publicState(ha1.context.request);
    expect(state['estimateStatus']).toBe(200);
    expect((state['catalog']['treatments'] as Json[]).map((entry) => entry['displayName'])).toEqual([NAME_A, NAME_B]);
    expect(await json(await ha1.context.request.get(`${API_1}/review-requests`))).toEqual({ reviewRequests: [] });
    expect(await queueOf(rv1)).toEqual([]);
    expect(await historyOf(rv1)).toEqual([]);
  } finally {
    await ha1.context.close();
    await rv1.context.close();
  }
});

test('S1 병원 1 관리자: 새 치료 C 를 기존 흐름(초안→미리보기→게시)으로 게시한 뒤 기준선을 다시 잡고, 화면에서 치료 A·B·C 에 검토를 요청한다', async ({ browser }) => {
  const ha1 = await openAs(browser, 'ha-clinic-1');
  try {
    await publishDraft(ha1, { additions: [ADDITION] });
    const published = (await adminTreatments(ha1))['treatments'] as Json[];
    const added = published.find((entry) => entry['displayName'] === NAME_C) as Json;
    expect(added).toBeTruthy();
    idC = added['treatmentId'] as string;

    // 새 치료는 서버가 분류를 "추가 검토 필요"로 정했으므로 C 를 고르면 계산이 보류다. 이 기준선은 C 게시 뒤의 안정된 공개 상태다.
    const onlyC = await publicState(ha1.context.request, [idC]);
    expect(onlyC['estimate']['result']['state']).toBe('ON_HOLD');
    expect(onlyC['estimate']['result']['holdReasons']).toContainEqual({ treatmentId: idC, code: 'CLASSIFICATION_NEEDS_REVIEW' });
    stable = { ab: await publicState(ha1.context.request), c: onlyC };
    stableAdmin = await adminTreatments(ha1);
    expect(stable['ab']['estimate']['result']['state']).toBe('ESTIMATED');

    reqA = await requestViaUi(ha1.page, T1, NAME_A, 'MAJOR_THREE_NON_BENEFIT');
    reqB = await requestViaUi(ha1.page, T2, NAME_B, 'GENERAL_NON_BENEFIT');
    reqC = await requestViaUi(ha1.page, idC, NAME_C, 'GENERAL_BENEFIT');
    // 새 치료 C 의 행: 열린 요청이 있고 분류 확인이 남았다는 안내가 병원 관리자에게도 보인다.
    const rowC = ha1.page.locator(`[data-admin-review-row="${idC}"]`);
    await expect(rowC.locator('[data-admin-review-classification="NEEDS_REVIEW"]')).toContainText('분류 확인이 남아 있습니다');
    await expect(ha1.page.locator(`[data-admin-review-row="${T1}"] [data-admin-review-classification]`)).toHaveCount(0);
    await shoot(ha1.page, 'ha-three-requests');

    // 요청은 제안 기록일 뿐이다: 공개 자료와 관리자 치료 목록은 기준선 그대로.
    expect(await publicState(ha1.context.request)).toEqual(stable['ab']);
    expect(await publicState(ha1.context.request, [idC])).toEqual(stable['c']);
    expect(await adminTreatments(ha1)).toEqual(stableAdmin);
  } finally {
    await ha1.context.close();
  }
});

test('S2 검토 담당자 1: 대기열에 열린 요청 셋이 서로 다른 상태로 보이고, 치료 A 의 매핑 초안을 화면에서 작성·제출한다. 작성자에게는 승인 단추가 없고 API 도 403 이다', async ({ browser }) => {
  const rv1 = await openAs(browser, 'rv-1');
  const ha1 = await openAs(browser, 'ha-clinic-1');
  const ha2 = await openAs(browser, 'ha-clinic-2');
  try {
    const page = rv1.page;
    await expect(page.locator('[data-admin-page="review-queue"]')).toBeVisible();
    await expect(page.locator('[data-admin-user]')).toHaveText(RV_1_USER);
    await expect(page.locator('[data-admin-queue-note]')).toContainText('검토 기록');
    await expect(page.locator('[data-admin-queue-row]')).toHaveCount(3);
    for (const requestId of [reqA, reqB, reqC]) {
      const entry = row(page, requestId);
      // 현재 게시 상태는 네 가지 중 PUBLISHED 이고 값이 보인다. 매핑 단계는 "초안 전"이다.
      await expect(entry.locator('[data-admin-queue-current-state="PUBLISHED"]')).toBeVisible();
      await expect(entry.locator('[data-admin-queue-values="current"] [data-admin-queue-field]')).toHaveCount(3);
      await expect(entry.locator('[data-admin-queue-stage="NO_MAPPING"]')).toBeVisible();
      await expect(entry.getByRole('button', { name: '매핑 초안 작성', exact: true })).toBeEnabled();
      // 반영 안내는 모든 항목에 늘 보인다.
      await expect(entry.locator('[data-admin-queue-reflection]')).toContainText('승인은 검토 기록입니다');
      await expect(entry.locator('[data-admin-queue-reflection]')).toContainText('환자 화면 반영');
    }
    // 분류 안내는 새 치료 C 에만 있다.
    await expect(row(page, reqC).locator('[data-admin-queue-classification="NEEDS_REVIEW"]')).toHaveText(
      '치료 분류 처리가 남아 있습니다. 매핑을 승인해도 분류가 바뀌지 않으므로 이 승인만으로 환자 화면 계산이 가능해지지 않습니다.',
    );
    await expect(row(page, reqA).locator('[data-admin-queue-classification]')).toHaveCount(0);
    await expect(row(page, reqB).locator('[data-admin-queue-classification]')).toHaveCount(0);
    await shoot(page, 'rv-queue-three-entries');

    // 치료 A: 양식을 열고, 빈 채로 저장하면 서버로 가지 않고 문제 목록이 뜬다.
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`);
    });
    const entryA = row(page, reqA);
    await entryA.getByRole('button', { name: '매핑 초안 작성', exact: true }).click();
    const form = entryA.locator(`[data-admin-draft-form="${reqA}"]`);
    await expect(form.locator('[data-admin-draft-test-data]')).toContainText('시험 자료입니다');
    await expect(form.getByRole('checkbox')).toHaveCount(15); // 세대 다섯 × 보험사 형태 셋
    await form.getByRole('button', { name: '초안 저장' }).click();
    const problems = form.locator('[data-admin-draft-problems]');
    await expect(problems).toContainText('그룹 키를 입력해 주세요');
    await expect(problems).toContainText('적용 범위를 하나 이상 선택해 주세요');
    await expect(problems).toContainText('유효 기간 시작일');
    await expect(problems).toContainText('약관 출처의 모든 칸을 입력해 주세요');
    expect(writes).toEqual([]);
    await shoot(page, 'rv-draft-form-problems');
    // 보장 제외로 바꾸면 그룹 키 칸이 사라지고 제외 사유 칸이 나온다. 다시 보장함으로 돌린다.
    await form.getByLabel('보장 제외', { exact: true }).check();
    await expect(form.getByLabel('그룹 키', { exact: true })).toHaveCount(0);
    await expect(form.getByLabel('제외 사유', { exact: true })).toBeVisible();
    await form.getByLabel('보장함', { exact: true }).check();
    await expect(form.getByLabel('제외 사유', { exact: true })).toHaveCount(0);
    // 처음부터 다시: 화면을 새로 읽고 양식 도우미로 채워 저장한다.
    await page.reload();
    const created = await draftViaUi(page, reqA, 'COVERED', 'A');
    expect(created['entry']).toMatchObject({ id: reqA, status: 'REVIEW_REQUESTED', mapping: { lifecycle: 'DRAFT', decision: 'COVERED', groupKey: 'TEST_FIXTURE_GROUP_A', authorId: RV_1_USER }, basis: { check: 'MATCH' } });
    mappingA = { id: created['entry']['mapping']['ref']['id'] as string, version: created['entry']['mapping']['ref']['version'] as string };
    await expect(page.locator('[data-admin-message="ok"]')).toContainText('아직 검토에 제출되지 않았습니다');
    await expect(entryA.locator('[data-admin-stage-summary]')).toContainText('TEST_FIXTURE_GROUP_A');
    await shoot(page, 'rv-draft-saved');

    // 작성자는 제출한다.
    const submitted = page.waitForResponse((candidate) => candidate.request().method() === 'POST' && candidate.url().endsWith(itemUrl(mappingA.id, mappingA.version, 'submit')));
    await entryA.getByRole('button', { name: '검토 제출', exact: true }).click();
    expect((await submitted).status()).toBe(200);
    await expect(entryA.locator('[data-admin-queue-stage="REVIEW"]')).toBeVisible();
    await expect(entryA.locator('[data-admin-stage-basis="MATCH"]')).toContainText('검토 기준과 같음');
    // 작성자 화면: 승인 단추가 없고 안내만 있다. 반려는 본인도 할 수 있다(도메인 규칙).
    await expect(entryA.getByRole('button', { name: '승인', exact: true })).toHaveCount(0);
    await expect(entryA.locator('[data-admin-stage-author-note]')).toHaveText('본인이 작성한 매핑은 승인할 수 없습니다');
    await expect(entryA.getByRole('button', { name: '반려', exact: true })).toBeEnabled();
    await shoot(page, 'rv-author-has-no-approve');

    // 같은 일을 API 로 해도 서버가 거절한다: 403 SELF_APPROVAL_FORBIDDEN, 저장 상태는 그대로.
    const before = await observe(rv1, ha1, ha2);
    const forbidden = await rv1.context.request.post(itemUrl(mappingA.id, mappingA.version, 'approve'), { data: { reviewRequestId: reqA } });
    expect(forbidden.status()).toBe(403);
    expect(await json(forbidden)).toEqual({ error: 'FORBIDDEN', reason: 'SELF_APPROVAL_FORBIDDEN' });
    expect(await observe(rv1, ha1, ha2)).toEqual(before);
  } finally {
    for (const session of [rv1, ha1, ha2]) await session.context.close();
  }
});

test('S3 검토 담당자 2: 치료 A 의 매핑을 화면에서 승인한다 — 검토 기록이며 환자 화면에는 아직 반영되지 않는다. 병원 관리자 화면에도 같은 말로 보이고 공개 자료는 기준선 그대로다', async ({ browser }) => {
  const rv2 = await openAs(browser, 'rv-2');
  const ha1 = await openAs(browser, 'ha-clinic-1');
  try {
    const page = rv2.page;
    await expect(page.locator('[data-admin-user]')).toHaveText(RV_2_USER);
    const entry = row(page, reqA);
    await expect(entry.locator('[data-admin-queue-stage="REVIEW"]')).toBeVisible();
    await expect(entry.locator('[data-admin-stage-author]')).toHaveText(RV_1_USER);
    await expect(entry.locator('[data-admin-stage-author-note]')).toHaveCount(0);
    await expect(entry.getByRole('button', { name: '승인', exact: true })).toBeEnabled();
    await shoot(page, 'rv2-review-ready');

    const approved = page.waitForResponse((candidate) => candidate.request().method() === 'POST' && candidate.url().endsWith(itemUrl(mappingA.id, mappingA.version, 'approve')));
    await entry.getByRole('button', { name: '승인', exact: true }).click();
    const response = await approved;
    expect(response.status()).toBe(200);
    // 매핑은 APPROVED 이고 PUBLISHED 가 아니다. 요청은 닫히고 결과 매핑이 연결된다.
    expect((await response.json()) as Json).toMatchObject({ entry: { id: reqA, status: 'APPROVED', mapping: { lifecycle: 'APPROVED' }, resultMappingRef: { id: mappingA.id, version: mappingA.version }, closedBy: RV_2_USER } });

    // 안내: 검토 기록이며 환자 화면에는 아직 반영되지 않았다. 항목은 대기열에서 빠지고 "처리 완료"에 들어간다.
    await expect(page.locator('[data-admin-message="ok"]')).toContainText('검토 기록');
    await expect(page.locator('[data-admin-message="ok"]')).toContainText('환자 화면에는 아직 반영되지 않았습니다');
    await expect(entry).toHaveCount(0);
    const done = page.locator(`[data-admin-done-item="${reqA}"]`);
    await expect(done.locator('[data-admin-done-status]')).toHaveText(APPROVED_TEXT);
    await expect(done.locator('[data-admin-done-closed-by]')).toHaveText(RV_2_USER);
    await expect(done.locator('[data-admin-done-result]')).toContainText(mappingA.id);
    await expect(done.locator('[data-admin-queue-reflection]')).toBeVisible();
    await shoot(page, 'rv2-approve-success');

    const closed = (await historyOf(rv2)).find((candidate) => candidate['id'] === reqA) as Json;
    expect(closed['mapping']['lifecycle']).toBe('APPROVED');
    // 어느 항목의 매핑도 PUBLISHED 가 아니다(승인은 게시가 아니다).
    for (const candidate of [...(await historyOf(rv2)), ...(await queueOf(rv2))]) {
      if (candidate['mapping'] !== null) expect(candidate['mapping']['lifecycle'], candidate['id']).not.toBe('PUBLISHED');
    }

    // 병원 관리자: 같은 말로 읽는다. 내부 자료(매핑·작성자)는 보이지 않는다.
    await ha1.page.goto(`/admin/${CLINIC_1}/review-requests`);
    const status = ha1.page.locator(`[data-admin-review-row="${T1}"] [data-admin-review-status]`);
    await expect(status).toHaveText(APPROVED_TEXT);
    await expect(status).toHaveAttribute('data-admin-review-status', 'APPROVED');
    await expect(ha1.page.locator(`[data-admin-review-sent-item="${reqA}"] [data-admin-review-sent-status]`)).toHaveText(APPROVED_TEXT);
    const haText = await ha1.page.locator('main').innerText();
    expect(haText).not.toContain('TEST_FIXTURE_MAPPING');
    expect(haText).not.toContain(RV_1_USER);
    expect(haText).not.toContain(RV_2_USER);
    await shoot(ha1.page, 'ha-approved-status');

    // 승인은 검토 기록일 뿐: 공개 자료와 관리자 치료 목록은 기준선과 같다.
    expect(await publicState(ha1.context.request)).toEqual(stable['ab']);
    expect(await adminTreatments(ha1)).toEqual(stableAdmin);
  } finally {
    for (const session of [rv2, ha1]) await session.context.close();
  }
});

test('S4 치료 B: 검토 담당자 1 이 초안(보장 제외)·제출, 검토 담당자 2 는 사유 없는 반려가 화면에서 막히고 API 도 400 이며, 사유를 적으면 반려된다. 병원 1 은 사유를 읽고 병원 2 는 읽을 수 없다', async ({ browser }) => {
  const rv1 = await openAs(browser, 'rv-1');
  const rv2 = await openAs(browser, 'rv-2');
  const ha1 = await openAs(browser, 'ha-clinic-1');
  const ha2 = await openAs(browser, 'ha-clinic-2');
  try {
    const created = await draftViaUi(rv1.page, reqB, 'EXCLUDED', 'B');
    expect(created['entry']['mapping']).toMatchObject({ decision: 'EXCLUDED', groupKey: null, exclusionReason: 'TEST_FIXTURE 제외 사유 B' });
    mappingB = { id: created['entry']['mapping']['ref']['id'] as string, version: created['entry']['mapping']['ref']['version'] as string };
    await row(rv1.page, reqB).getByRole('button', { name: '검토 제출', exact: true }).click();
    await expect(row(rv1.page, reqB).locator('[data-admin-queue-stage="REVIEW"]')).toBeVisible();

    const page = rv2.page;
    await page.reload();
    const entry = row(page, reqB);
    await expect(entry.locator('[data-admin-queue-stage="REVIEW"]')).toBeVisible();
    const before = await observe(rv2, ha1, ha2);
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`);
    });
    // 사유 없이 반려: 화면이 막고 서버로 가지 않는다. 공백뿐인 사유도 같다.
    await entry.getByRole('button', { name: '반려', exact: true }).click();
    await expect(entry.locator('[data-admin-reject-problem]')).toHaveText('사유를 입력해 주세요');
    await entry.getByLabel('반려 사유 (필수)').fill('   ');
    await entry.getByRole('button', { name: '반려', exact: true }).click();
    await expect(entry.locator('[data-admin-reject-problem]')).toHaveText('사유를 입력해 주세요');
    expect(writes).toEqual([]);
    await shoot(page, 'rv2-reject-reason-required');
    // 같은 일을 API 로 해도 서버가 거절한다: 400 이고 요청은 열려 있고 저장 상태는 그대로.
    const empty = await rv2.context.request.post(itemUrl(mappingB.id, mappingB.version, 'reject'), { data: { reviewRequestId: reqB, reason: '' } });
    expect(empty.status()).toBe(400);
    expect(await json(empty)).toEqual({ error: 'INVALID_REQUEST', defects: [{ code: 'EMPTY', path: 'reason' }] });
    expect(await observe(rv2, ha1, ha2)).toEqual(before);

    // 사유를 적고 반려한다.
    await entry.getByLabel('반려 사유 (필수)').fill('TEST_FIXTURE 약관 근거가 부족합니다');
    await expect(entry.locator('[data-admin-reject-problem]')).toHaveCount(0);
    const rejected = page.waitForResponse((candidate) => candidate.request().method() === 'POST' && candidate.url().endsWith(itemUrl(mappingB.id, mappingB.version, 'reject')));
    await entry.getByRole('button', { name: '반려', exact: true }).click();
    const response = await rejected;
    expect(response.status()).toBe(200);
    expect((await response.json()) as Json).toMatchObject({ entry: { id: reqB, status: 'REJECTED', rejectionReason: 'TEST_FIXTURE 약관 근거가 부족합니다', resultMappingRef: null, mapping: { lifecycle: 'REJECTED' }, closedBy: RV_2_USER } });
    await expect(entry).toHaveCount(0);
    const done = page.locator(`[data-admin-done-item="${reqB}"]`);
    await expect(done.locator('[data-admin-done-status]')).toHaveText('반려됨');
    await expect(done.locator('[data-admin-done-reason]')).toContainText('TEST_FIXTURE 약관 근거가 부족합니다');
    await expect(done.locator('[data-admin-done-result]')).toHaveText('없음');

    // 병원 1: 반려됨과 사유. 병원 2: 병원 1 의 요청을 읽을 수 없다(403).
    await ha1.page.goto(`/admin/${CLINIC_1}/review-requests`);
    await expect(ha1.page.locator(`[data-admin-review-row="${T2}"] [data-admin-review-status]`)).toHaveText('반려됨');
    await expect(ha1.page.locator(`[data-admin-review-row="${T2}"] [data-admin-review-reason]`)).toContainText('TEST_FIXTURE 약관 근거가 부족합니다');
    await expect(ha1.page.locator(`[data-admin-review-sent-item="${reqB}"] [data-admin-review-sent-reason]`)).toContainText('TEST_FIXTURE 약관 근거가 부족합니다');
    await shoot(ha1.page, 'ha-rejected-status');
    const denied = await ha2.context.request.get(`${API_1}/review-requests`);
    expect(denied.status()).toBe(403);
    expect(await json(denied)).toEqual({ error: 'FORBIDDEN' });
    await ha2.page.goto(`/admin/${CLINIC_1}/review-requests`);
    await expect(ha2.page.locator('[data-admin-state="forbidden"]')).toBeVisible();
    expect(await ha2.page.locator('body').innerText()).not.toContain('TEST_FIXTURE 약관 근거가 부족합니다');
    expect(await publicState(ha1.context.request)).toEqual(stable['ab']);
  } finally {
    for (const session of [rv1, rv2, ha1, ha2]) await session.context.close();
  }
});

test('S5 새 치료 C(분류 확인 필요): 분류 안내가 검토 담당자 항목과 병원 관리자 행에 보이고, 초안·제출·승인은 검토 기록으로 되지만 계산은 승인 전후로 보류 그대로다', async ({ browser }) => {
  const rv1 = await openAs(browser, 'rv-1');
  const rv2 = await openAs(browser, 'rv-2');
  const ha1 = await openAs(browser, 'ha-clinic-1');
  try {
    const before = await publicState(ha1.context.request, [idC]);
    expect(before).toEqual(stable['c']);
    expect(before['estimate']['result']['state']).toBe('ON_HOLD');
    expect(before['estimate']['result']['holdReasons']).toContainEqual({ treatmentId: idC, code: 'CLASSIFICATION_NEEDS_REVIEW' });
    const calcBefore = (await adminTreatments(ha1))['treatments'].find((entry: Json) => entry['treatmentId'] === idC);

    const created = await draftViaUi(rv1.page, reqC, 'COVERED', 'C');
    expect(created['entry']).toMatchObject({ classification: 'NEEDS_REVIEW', current: { state: 'PUBLISHED', calcClass: 'NEEDS_REVIEW' } });
    mappingC = { id: created['entry']['mapping']['ref']['id'] as string, version: created['entry']['mapping']['ref']['version'] as string };
    const entryRv1 = row(rv1.page, reqC);
    await expect(entryRv1.locator('[data-admin-queue-classification="NEEDS_REVIEW"]')).toContainText('이 승인만으로 환자 화면 계산이 가능해지지 않습니다');
    await entryRv1.getByRole('button', { name: '검토 제출', exact: true }).click();
    await expect(entryRv1.locator('[data-admin-queue-stage="REVIEW"]')).toBeVisible();

    await rv2.page.reload();
    const entry = row(rv2.page, reqC);
    await expect(entry.locator('[data-admin-queue-classification="NEEDS_REVIEW"]')).toBeVisible();
    await shoot(rv2.page, 'rv2-needs-review-entry');
    const approved = rv2.page.waitForResponse((candidate) => candidate.request().method() === 'POST' && candidate.url().endsWith(itemUrl(mappingC.id, mappingC.version, 'approve')));
    await entry.getByRole('button', { name: '승인', exact: true }).click();
    expect((await approved).status()).toBe(200);
    await expect(entry).toHaveCount(0);
    const message = await rv2.page.locator('[data-admin-message="ok"]').innerText();
    expect(message).toContain('환자 화면에는 아직 반영되지 않았습니다');
    // 화면 어디에도 계산이 가능해졌다는 말이 없다.
    const rvText = await rv2.page.locator('main').innerText();
    expect(rvText).not.toMatch(/계산이 가능해졌|계산 가능|반영되었습니다|반영됨/);

    // 병원 관리자 행: 검토 승인됨 + 분류 확인이 남았다는 안내.
    await ha1.page.goto(`/admin/${CLINIC_1}/review-requests`);
    const rowC = ha1.page.locator(`[data-admin-review-row="${idC}"]`);
    await expect(rowC.locator('[data-admin-review-status]')).toHaveText(APPROVED_TEXT);
    await expect(rowC.locator('[data-admin-review-classification="NEEDS_REVIEW"]')).toContainText('환자 화면 계산이 가능해지지 않습니다');
    expect(await ha1.page.locator('main').innerText()).not.toMatch(/계산이 가능해졌|계산 가능합니다/);

    // 승인 전후로 C 의 계산은 보류 그대로이고 분류도 그대로다.
    const after = await publicState(ha1.context.request, [idC]);
    expect(after).toEqual(before);
    expect(after['estimate']['result']['state']).toBe('ON_HOLD');
    expect(after['estimate']['result']['holdReasons']).toContainEqual({ treatmentId: idC, code: 'CLASSIFICATION_NEEDS_REVIEW' });
    expect((await adminTreatments(ha1))['treatments'].find((entry: Json) => entry['treatmentId'] === idC)).toEqual(calcBefore);
    // A·B·C 의 처리가 모두 끝난 지금도 공개 자료와 관리자 치료 목록은 S1 의 기준선과 완전히 같다.
    expect(await publicState(ha1.context.request)).toEqual(stable['ab']);
    expect(await adminTreatments(ha1)).toEqual(stableAdmin);
  } finally {
    for (const session of [rv1, rv2, ha1]) await session.context.close();
  }
});

test('S6 거절: 연결되지 않은 매핑 · 없는 요청/매핑 · 닫힌 요청 · 중복 초안 · 치료 불일치 · 권한 없는 계정 · 위조·잘못된 본문 · 잘못된 방법 — 응답과 함께 관찰한 저장 상태가 그대로다', async ({ browser }) => {
  test.setTimeout(240_000);
  const rv1 = await openAs(browser, 'rv-1');
  const rv2 = await openAs(browser, 'rv-2');
  const rvClinic = await openAs(browser, 'rv-clinic-1');
  const ha1 = await openAs(browser, 'ha-clinic-1');
  const ha2 = await openAs(browser, 'ha-clinic-2');
  const po = await openAs(browser, 'po-1');
  const anonymous = await openAs(browser, null);
  try {
    const post = (session: Session, url: string, data?: unknown, headers: Record<string, string> = {}): Promise<APIResponse> =>
      session.context.request.fetch(url, { method: 'POST', headers, ...(data === undefined ? {} : { data }) });
    /** 거절 하나: 응답(상태·본문·no-store)을 확인하고, 그 전후로 관찰한 저장 상태가 같음을 확인한다. */
    async function refused(name: string, run: () => Promise<APIResponse>, status: number, body?: Json): Promise<Json> {
      const before = await observe(rv1, ha1, ha2);
      const response = await run();
      const parsed = await json(response);
      expect(response.status(), `${name}: ${JSON.stringify(parsed)}`).toBe(status);
      if (body !== undefined) expect(parsed, name).toEqual(body);
      expect(response.headers()['cache-control'], name).toBe('no-store');
      expect(await observe(rv1, ha1, ha2), `${name}: 저장 상태`).toEqual(before);
      return parsed;
    }

    // 준비: 새 요청 둘(치료 A, 치료 C)을 열어 RV-1 이 초안·제출까지 한다. (이 준비는 정상 흐름이라 상태가 바뀐다.)
    const ha1Request = async (treatmentId: string): Promise<string> => {
      const response = await post(ha1, requestUrl(API_1, treatmentId), { proposed: { benefitType: 'NON_BENEFIT', procedureCodes: [], calcClass: 'GENERAL_NON_BENEFIT' } });
      expect(response.status()).toBe(200);
      return (await json(response))['reviewRequest']['id'] as string;
    };
    const draftAndSubmit = async (requestId: string): Promise<{ id: string; version: string }> => {
      const drafted = await post(rv1, draftUrl(requestId), DRAFT_BODY);
      expect(drafted.status()).toBe(200);
      const ref = (await json(drafted))['entry']['mapping']['ref'] as Json;
      expect((await post(rv1, itemUrl(ref['id'], ref['version'], 'submit'), { reviewRequestId: requestId })).status()).toBe(200);
      return { id: ref['id'] as string, version: ref['version'] as string };
    };
    const reqA2 = await ha1Request(T1);
    const reqC2 = await ha1Request(idC);
    const mapA2 = await draftAndSubmit(reqA2);
    const mapC2 = await draftAndSubmit(reqC2);

    // 1. 연결되지 않은 매핑: 다른 요청으로 처리하려 하면 409 MAPPING_NOT_LINKED_TO_REQUEST (제출·승인·반려 모두).
    const notLinked = { error: 'CONFLICT', reason: 'MAPPING_NOT_LINKED_TO_REQUEST' };
    await refused('다른 요청으로 승인', () => post(rv2, itemUrl(mapA2.id, mapA2.version, 'approve'), { reviewRequestId: reqC2 }), 409, notLinked);
    await refused('다른 요청으로 반려', () => post(rv2, itemUrl(mapA2.id, mapA2.version, 'reject'), { reviewRequestId: reqC2, reason: 'TEST_FIXTURE 사유' }), 409, notLinked);
    await refused('다른 요청으로 제출', () => post(rv1, itemUrl(mapA2.id, mapA2.version, 'submit'), { reviewRequestId: reqC2 }), 409, notLinked);
    await refused('없는 매핑(요청은 있음)', () => post(rv2, itemUrl('TEST_FIXTURE_NO_SUCH_MAPPING', '1', 'approve'), { reviewRequestId: reqA2 }), 409, notLinked);
    await refused('틀린 버전', () => post(rv2, itemUrl(mapA2.id, '99', 'approve'), { reviewRequestId: reqA2 }), 409, notLinked);
    // 2. 없는 요청 → 404.
    await refused('없는 요청으로 승인', () => post(rv2, itemUrl(mapA2.id, mapA2.version, 'approve'), { reviewRequestId: 'TEST_FIXTURE_NO_SUCH_REQUEST' }), 404, { error: 'NOT_FOUND' });
    await refused('없는 요청에 초안', () => post(rv1, draftUrl('TEST_FIXTURE_NO_SUCH_REQUEST'), DRAFT_BODY), 404, { error: 'NOT_FOUND' });
    // 3. 작성자 규칙: 작성자가 아닌 RV 의 제출 403, 작성자의 승인 403. 헤더로 사용자를 주장해도 검증된 신원이 쓰인다.
    await refused('이미 제출한 매핑의 재제출', () => post(rv1, itemUrl(mapA2.id, mapA2.version, 'submit'), { reviewRequestId: reqA2 }), 409, { error: 'CONFLICT', reason: 'TRANSITION_NOT_ALLOWED' });
    await refused('작성자 본인의 승인', () => post(rv1, itemUrl(mapA2.id, mapA2.version, 'approve'), { reviewRequestId: reqA2 }), 403, { error: 'FORBIDDEN', reason: 'SELF_APPROVAL_FORBIDDEN' });
    await refused('헤더로 다른 사용자를 주장해도 본인 승인', () => post(rv1, itemUrl(mapA2.id, mapA2.version, 'approve'), { reviewRequestId: reqA2 }, { 'x-user-id': RV_2_USER, 'x-role': 'RV', 'x-clinic-id': CLINIC_1 }), 403, {
      error: 'FORBIDDEN',
      reason: 'SELF_APPROVAL_FORBIDDEN',
    });
    await refused('질의로 다른 사용자를 주장해도 본인 승인', () => post(rv1, `${itemUrl(mapA2.id, mapA2.version, 'approve')}?userId=${RV_2_USER}&role=RV`, { reviewRequestId: reqA2 }), 403, { error: 'FORBIDDEN', reason: 'SELF_APPROVAL_FORBIDDEN' });
    // 4. 중복 초안 → 409.
    await refused('같은 요청에 두 번째 초안', () => post(rv1, draftUrl(reqA2), DRAFT_BODY), 409, { error: 'CONFLICT', reason: 'MAPPING_DRAFT_ALREADY_EXISTS' });

    // 5. 닫힌 요청: C 를 승인한 뒤 같은 요청에 승인·반려·제출·초안을 다시 하면 409 REVIEW_REQUEST_CLOSED.
    expect((await post(rv2, itemUrl(mapC2.id, mapC2.version, 'approve'), { reviewRequestId: reqC2 })).status()).toBe(200);
    const closedConflict = { error: 'CONFLICT', reason: 'REVIEW_REQUEST_CLOSED' };
    await refused('닫힌 요청 승인', () => post(rv2, itemUrl(mapC2.id, mapC2.version, 'approve'), { reviewRequestId: reqC2 }), 409, closedConflict);
    await refused('닫힌 요청 반려', () => post(rv2, itemUrl(mapC2.id, mapC2.version, 'reject'), { reviewRequestId: reqC2, reason: 'TEST_FIXTURE 사유' }), 409, closedConflict);
    await refused('닫힌 요청 제출', () => post(rv1, itemUrl(mapC2.id, mapC2.version, 'submit'), { reviewRequestId: reqC2 }), 409, closedConflict);
    await refused('닫힌 요청에 초안', () => post(rv1, draftUrl(reqC2), DRAFT_BODY), 409, closedConflict);
    await refused('S3 에서 승인한 요청을 다시 승인', () => post(rv2, itemUrl(mappingA.id, mappingA.version, 'approve'), { reviewRequestId: reqA }), 409, closedConflict);
    await refused('S4 에서 반려한 요청을 다시 반려', () => post(rv2, itemUrl(mappingB.id, mappingB.version, 'reject'), { reviewRequestId: reqB, reason: 'TEST_FIXTURE 사유' }), 409, closedConflict);

    // 6. 치료 불일치: 초안이 없는 열린 요청(C 의 새 요청)에 다른 치료 id 를 적으면 409 REF_CONTENT_MISMATCH.
    const reqC3 = await ha1Request(idC);
    await refused('요청과 다른 치료로 초안', () => post(rv1, draftUrl(reqC3), { mapping: { ...DRAFT_BODY.mapping, treatmentId: T1 } }), 409, { error: 'CONFLICT', reason: 'REF_CONTENT_MISMATCH' });

    // 7. 권한 매트릭스: 새 경로 다섯 개 × {로그인 없음 401, 병원 1 HA 403, 병원 2 HA 403, PO 403, 병원에 매인 RV 403}. 플랫폼 RV 는 형식이 틀린 본문이면 400 에서 멈춘다(권한은 통과).
    const routes: Array<[string, string, string, unknown]> = [
      ['이력', 'GET', HISTORY, undefined],
      ['초안', 'POST', draftUrl(reqC3), DRAFT_BODY],
      ['제출', 'POST', itemUrl(mapA2.id, mapA2.version, 'submit'), { reviewRequestId: reqA2 }],
      ['승인', 'POST', itemUrl(mapA2.id, mapA2.version, 'approve'), { reviewRequestId: reqA2 }],
      ['반려', 'POST', itemUrl(mapA2.id, mapA2.version, 'reject'), { reviewRequestId: reqA2, reason: 'TEST_FIXTURE 사유' }],
    ];
    const accounts: Array<[string, Session | null, number, Json]> = [
      ['로그인 없음', anonymous, 401, { error: 'UNAUTHENTICATED' }],
      ['병원 1 HA', ha1, 403, { error: 'FORBIDDEN' }],
      ['병원 2 HA', ha2, 403, { error: 'FORBIDDEN' }],
      ['PO', po, 403, { error: 'FORBIDDEN' }],
      ['병원에 매인 RV', rvClinic, 403, { error: 'FORBIDDEN' }],
    ];
    for (const [routeName, method, url, data] of routes) {
      for (const [accountName, session, status, expected] of accounts) {
        await refused(`${routeName} · ${accountName}`, () => (session as Session).context.request.fetch(url, { method, ...(data === undefined ? {} : { data }) }), status, expected);
      }
    }
    expect((await rv1.context.request.get(HISTORY)).status()).toBe(200);
    for (const [routeName, , url] of routes.slice(1)) {
      await refused(`${routeName} · 플랫폼 RV 의 빈 본문`, () => post(rv2, url, {}), 400);
    }
    // 위조: 병원 1 HA 가 헤더로 RV 를 주장해도 403 이다.
    await refused('HA 가 헤더로 RV 주장', () => post(ha1, itemUrl(mapA2.id, mapA2.version, 'approve'), { reviewRequestId: reqA2 }, { 'x-role': 'RV', 'x-clinic-id': CLINIC_1 }), 403, { error: 'FORBIDDEN' });

    // 8. 잘못된 본문 → 400 (서버가 정하는 값을 본문으로 보낼 길이 없다). 위조 키는 UNKNOWN_FIELD.
    const badDrafts: Array<[string, unknown, string]> = [
      ['빈 범위', { mapping: { ...DRAFT_BODY.mapping, scope: [] } }, 'mapping.scope'],
      ['세대 열거 밖', { mapping: { ...DRAFT_BODY.mapping, scope: [{ generation: 'GEN9', insurerType: 'NON_LIFE' }] } }, 'mapping.scope[0].generation'],
      ['판정 열거 밖', { mapping: { ...DRAFT_BODY.mapping, decision: 'MAYBE' } }, 'mapping.decision'],
      ['시작일이 종료일보다 늦음', { mapping: { ...DRAFT_BODY.mapping, validity: { from: '2026-12-31', to: '2026-01-01' } } }, 'mapping.validity'],
      ['달력에 없는 날짜', { mapping: { ...DRAFT_BODY.mapping, validity: { from: '2026-02-30', to: '2026-12-31' } } }, 'mapping.validity.from'],
      ['보장함인데 그룹 키 없음', { mapping: { ...DRAFT_BODY.mapping, groupKey: undefined } }, 'mapping.groupKey'],
      ['보장 제외인데 사유 없음', { mapping: { ...DRAFT_BODY.mapping, decision: 'EXCLUDED', groupKey: undefined } }, 'mapping.exclusionReason'],
      ['빈 약관 출처', { mapping: { ...DRAFT_BODY.mapping, policySources: [] } }, 'mapping.policySources'],
      ['역할 위조', { ...DRAFT_BODY, role: 'RV' }, 'request.role'],
      ['병원 위조', { ...DRAFT_BODY, clinicId: CLINIC_2 }, 'request.clinicId'],
      ['사용자 위조', { mapping: { ...DRAFT_BODY.mapping, authorId: RV_2_USER } }, 'mapping.authorId'],
      ['상태 위조', { mapping: { ...DRAFT_BODY.mapping, state: 'APPROVED' } }, 'mapping.state'],
      ['출처 위조', { mapping: { ...DRAFT_BODY.mapping, origin: 'OPERATING' } }, 'mapping.origin'],
    ];
    for (const [name, data, defectPath] of badDrafts) {
      const parsed = await refused(`초안 본문 · ${name}`, () => post(rv1, draftUrl(reqC3), data), 400);
      expect(parsed['error']).toBe('INVALID_REQUEST');
      expect((parsed['defects'] as Json[]).map((defect) => defect['path']), name).toContain(defectPath);
    }
    for (const action of ['submit', 'approve'] as const) {
      await refused(`${action} 본문 · 요청 id 없음`, () => post(rv2, itemUrl(mapA2.id, mapA2.version, action), {}), 400, { error: 'INVALID_REQUEST', defects: [{ code: 'VALUE_MISSING', path: 'reviewRequestId' }] });
      await refused(`${action} 본문 · 위조 키`, () => post(rv2, itemUrl(mapA2.id, mapA2.version, action), { reviewRequestId: reqA2, role: 'RV', actor: 'x' }), 400, {
        error: 'INVALID_REQUEST',
        defects: [{ code: 'UNKNOWN_FIELD', path: 'request.role' }, { code: 'UNKNOWN_FIELD', path: 'request.actor' }],
      });
    }
    await refused('반려 본문 · 공백뿐인 사유', () => post(rv2, itemUrl(mapA2.id, mapA2.version, 'reject'), { reviewRequestId: reqA2, reason: '  \n ' }), 400, { error: 'INVALID_REQUEST', defects: [{ code: 'EMPTY', path: 'reason' }] });
    await refused('JSON 아님', () => rv1.context.request.fetch(draftUrl(reqC3), { method: 'POST', headers: { 'content-type': 'application/json' }, data: Buffer.from('{not json') }), 400, {
      error: 'INVALID_REQUEST',
      defects: [{ code: 'NOT_JSON', path: 'request' }],
    });

    // 9. 잘못된 방법 → 405 (인증된 요청에서만. 로그인 없음은 401).
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      await refused(`초안 경로 ${method}`, () => rv1.context.request.fetch(draftUrl(reqC3), { method }), 405);
      await refused(`승인 경로 ${method}`, () => rv2.context.request.fetch(itemUrl(mapA2.id, mapA2.version, 'approve'), { method }), 405);
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await refused(`이력 경로 ${method}`, () => rv1.context.request.fetch(HISTORY, { method }), 405);
    }
    await refused('로그인 없는 DELETE 는 401', () => anonymous.context.request.fetch(HISTORY, { method: 'DELETE' }), 401, { error: 'UNAUTHENTICATED' });

    // 작성자가 아닌 RV 의 제출: 제출 전(DRAFT)인 초안이 있어야 한다. 초안이 없던 reqC3 에 초안을 만든 뒤 RV-2 가 제출하려 하면 403 NOT_ITEM_AUTHOR 이다.
    const draftC3 = await post(rv1, draftUrl(reqC3), DRAFT_BODY);
    expect(draftC3.status()).toBe(200);
    const refC3 = (await json(draftC3))['entry']['mapping']['ref'] as Json;
    await refused('작성자가 아닌 RV 의 제출', () => post(rv2, itemUrl(refC3['id'], refC3['version'], 'submit'), { reviewRequestId: reqC3 }), 403, { error: 'FORBIDDEN', reason: 'NOT_ITEM_AUTHOR' });

    // 거절이 이어지는 동안 열린 요청은 정확히 둘(A 의 두 번째 요청 reqA2 = 검토 중, C 의 세 번째 요청 reqC3 = 초안 전)이다.
    expect((await queueOf(rv1)).map((entry) => entry['id']).sort()).toEqual([reqA2, reqC3].sort());
    // 정상 거절 뒤에도 공개 카탈로그·보험 선택지·계산 결과(A·B)는 기준선과 같다.
    expect(await publicState(ha1.context.request)).toEqual(stable['ab']);
    // 마무리: reqA2 는 사유와 함께 반려해 닫아 둔다(reqC3 은 초안 전의 열린 요청으로 남는다).
    expect((await post(rv2, itemUrl(mapA2.id, mapA2.version, 'reject'), { reviewRequestId: reqA2, reason: 'TEST_FIXTURE 시험 정리' })).status()).toBe(200);
    await rv2.page.reload();
    await shoot(rv2.page, 'rv2-after-refusals');
  } finally {
    for (const session of [rv1, rv2, rvClinic, ha1, ha2, po, anonymous]) await session.context.close();
  }
});

test('S7 숨김 (마지막: 카탈로그를 바꾼다): 승인 단추가 켜진 채 열려 있던 화면에서 승인하면 409 TREATMENT_HIDDEN 안내가 뜨고, 항목은 "숨긴 치료입니다"로 바뀌며 승인 단추가 막힌다. 반려로 닫는다', async ({ browser }) => {
  const rv1 = await openAs(browser, 'rv-1');
  const rv2 = await openAs(browser, 'rv-2');
  const ha1 = await openAs(browser, 'ha-clinic-1');
  const ha2 = await openAs(browser, 'ha-clinic-2');
  try {
    // 치료 B 에 새 요청을 내고 RV-1 이 초안을 만들어 제출한다.
    const requested = await ha1.context.request.post(requestUrl(API_1, T2), { data: { proposed: { benefitType: 'NON_BENEFIT', procedureCodes: [], calcClass: 'GENERAL_NON_BENEFIT' } } });
    expect(requested.status()).toBe(200);
    const reqB2 = (await json(requested))['reviewRequest']['id'] as string;
    await rv1.page.reload();
    const created = await draftViaUi(rv1.page, reqB2, 'COVERED', 'B2');
    const map = { id: created['entry']['mapping']['ref']['id'] as string, version: created['entry']['mapping']['ref']['version'] as string };
    await row(rv1.page, reqB2).getByRole('button', { name: '검토 제출', exact: true }).click();
    await expect(row(rv1.page, reqB2).locator('[data-admin-queue-stage="REVIEW"]')).toBeVisible();

    // RV-2 화면을 먼저 열어 둔다: 아직 게시 상태이므로 승인 단추가 켜져 있다.
    await rv2.page.reload();
    const entry = row(rv2.page, reqB2);
    await expect(entry.locator('[data-admin-queue-current-state="PUBLISHED"]')).toBeVisible();
    await expect(entry.getByRole('button', { name: '승인', exact: true })).toBeEnabled();

    // 그 사이 병원 1 관리자가 치료 B 를 숨겨 게시한다.
    await publishDraft(ha1, { deactivations: [T2] });
    const before = await observe(rv2, ha1, ha2);

    // 낡은 화면에서 승인: 서버가 409 TREATMENT_HIDDEN 으로 거절하고, 안내가 뜨며, 항목이 숨김 표시로 바뀐다.
    const attempt = rv2.page.waitForResponse((candidate) => candidate.request().method() === 'POST' && candidate.url().endsWith(itemUrl(map.id, map.version, 'approve')));
    await entry.getByRole('button', { name: '승인', exact: true }).click();
    const response = await attempt;
    expect(response.status()).toBe(409);
    expect(await response.json()).toEqual({ error: 'CONFLICT', reason: 'TREATMENT_HIDDEN' });
    await expect(entry.locator('[data-admin-message="error"]')).toContainText('숨긴 치료라서 승인할 수 없습니다');
    await expect(entry.locator('[data-admin-message="error"]')).toContainText('저장된 내용은 바뀌지 않았습니다');
    // 숨김 표시: "숨긴 치료입니다" 이고 "현재 게시 목록에 없습니다"가 아니다. 승인 단추는 막히고 이유 문장이 붙는다. 반려는 계속 할 수 있다.
    const current = entry.locator('[data-admin-queue-current-state="HIDDEN"]');
    await expect(current).toBeVisible();
    await expect(current.locator('[data-admin-queue-hidden]')).toHaveText(HIDDEN_TEXT);
    await expect(entry.locator('[data-admin-queue-not-published]')).toHaveCount(0);
    expect(await entry.innerText()).not.toContain(NOT_IN_LIST_TEXT);
    // 숨김은 읽기 실패가 아니다: 서버 분류 표지는 UNKNOWN 이지만 항목 어디에도 "읽지 못했습니다/읽을 수 없어"가 없고 분류 안내도 없다. 검토 기준은 "게시값이 없어" 비교하지 못했다고 말한다.
    const hiddenText = await entry.innerText();
    expect(hiddenText).not.toContain('읽지 못했습니다');
    expect(hiddenText).not.toContain('읽을 수 없');
    await expect(entry.locator('[data-admin-queue-classification]')).toHaveCount(0);
    await expect(entry.locator('[data-admin-queue-unreadable]')).toHaveCount(0);
    await expect(entry.locator('[data-admin-stage-basis="UNCHECKABLE"]')).toContainText('현재 게시값이 없어 검토 기준과 비교하지 못함');
    await expect(entry.locator('[data-admin-queue-current-state="PUBLISHED"]')).toHaveCount(0);
    await expect(entry.getByRole('button', { name: '승인', exact: true })).toBeDisabled();
    await expect(entry.locator('[data-admin-stage-blocked]')).toContainText('숨긴 치료라서 승인할 수 없습니다');
    await expect(entry.getByRole('button', { name: '반려', exact: true })).toBeEnabled();
    await shoot(rv2.page, 'rv2-hidden-treatment');
    // 서버의 대기열 응답도 같은 말이다: HIDDEN + 승인 차단 사유.
    expect(await openEntry(rv2, T2)).toMatchObject({ id: reqB2, current: { state: 'HIDDEN' }, classification: 'UNKNOWN', basis: { check: 'UNCHECKABLE' }, approvalBlockedReason: 'TREATMENT_HIDDEN' });
    // 거절은 아무것도 바꾸지 않았다: 시도 직전에 잡은 관찰과 같다.
    expect(await observe(rv2, ha1, ha2)).toEqual(before);

    // API 로도 같다.
    const viaApi = await rv2.context.request.post(itemUrl(map.id, map.version, 'approve'), { data: { reviewRequestId: reqB2 } });
    expect(viaApi.status()).toBe(409);
    expect(await json(viaApi)).toEqual({ error: 'CONFLICT', reason: 'TREATMENT_HIDDEN' });

    // 숨긴 치료의 요청은 반려로 닫는다.
    await entry.getByLabel('반려 사유 (필수)').fill('TEST_FIXTURE 치료가 내려가 반려합니다');
    const rejected = rv2.page.waitForResponse((candidate) => candidate.request().method() === 'POST' && candidate.url().endsWith(itemUrl(map.id, map.version, 'reject')));
    await entry.getByRole('button', { name: '반려', exact: true }).click();
    expect((await rejected).status()).toBe(200);
    await expect(entry).toHaveCount(0);
    await expect(rv2.page.locator(`[data-admin-done-item="${reqB2}"] [data-admin-done-status]`)).toHaveText('반려됨');
  } finally {
    for (const session of [rv1, rv2, ha1, ha2]) await session.context.close();
  }
});
