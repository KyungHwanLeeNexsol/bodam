import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { APIRequestContext, APIResponse, Browser, BrowserContext, Page } from '@playwright/test';
import { appendEvidenceLine, resetEvidenceFile } from './evidence';
import { expect } from './test';

// 시험 자료(TEST_FIXTURE). 묶음 게시·규칙 사용 범위 브라우저 시험(*.admin-bundle.spec.ts · *.admin-bundle-reject.spec.ts)이 함께 쓰는 도우미 (M7 묶음 구성).
// 앞단(tests/e2e/harness/server.ts)을 --bundle-demo --test-hooks 로 띄운 인스턴스를 가정한다: 병원 1 에 치료 C 가 있고(기준 묶음에 C 의 매핑이 없다), 병원 2 도 기준 묶음을 쓰고,
// 감사 기록(/__harness/audit)·저장소 사본(/__harness/state)을 읽고 세계를 새로 만들 수 있다(/__harness/reset). 계정마다 브라우저 문맥을 따로 연다(쿠키가 문맥마다 다르다).
// 선행 단계(검토 요청 → 매핑 초안 → 제출 → 다른 검토 담당자의 승인)는 매핑 검토 시험(mapping-review.admin-mapping.spec.ts)이 화면으로 이미 확인했으므로 여기서는 로그인한 세션의 실제 관리자 API 로 한다.

export const CLINIC_1 = 'TEST_FIXTURE_CLINIC_1';
export const CLINIC_2 = 'TEST_FIXTURE_CLINIC_2';
export const SLUG_1 = 'test-fixture-clinic-1';
export const SLUG_2 = 'test-fixture-clinic-2';
export const TREATMENT_A = 'TEST_FIXTURE_TREATMENT_1';
export const TREATMENT_B = 'TEST_FIXTURE_TREATMENT_2';
/** 묶음 시연 세계에서 병원 1 에 더해진 치료 C. 기준 묶음에는 이 치료의 매핑이 없다. */
export const TREATMENT_C = 'TEST_FIXTURE_TREATMENT_3';
export const NAME_C = 'TEST_FIXTURE 시험 치료 C (묶음 시험)';
export const OTHER_TREATMENT = 'TEST_FIXTURE_OTHER_TREATMENT_1';
export const CONDITION = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' } as const;

export const USERS = {
  'ha-clinic-1': 'TEST_FIXTURE_HA_CLINIC_1',
  'rv-1': 'TEST_FIXTURE_RV_PERSON_1',
  'rv-2': 'TEST_FIXTURE_RV_PERSON_2',
  'po-1': 'TEST_FIXTURE_PO_PERSON_1',
} as const;

export type Account = 'ha-clinic-1' | 'ha-clinic-2' | 'rv-1' | 'rv-2' | 'rv-clinic-1' | 'po-1';

/** 로그인 직후 도착하는 화면(시험 앞단의 로그인 이동). */
export const HOME: Record<Account, string> = {
  'ha-clinic-1': `/admin/${CLINIC_1}/treatments`,
  'ha-clinic-2': `/admin/${CLINIC_2}/treatments`,
  'rv-1': '/admin/review-queue',
  'rv-2': '/admin/review-queue',
  'rv-clinic-1': `/admin/${CLINIC_1}/treatments`,
  'po-1': '/admin/rule-scope',
};

export const SOURCE = { insurerDocumentId: 'TEST_FIXTURE_DOC_1', revisionDate: '2026-01-01', clauseOrPage: 'TEST_FIXTURE_P3', effectiveDate: '2026-01-01', verifiedBy: 'TEST_FIXTURE_VERIFIER', verifiedAt: '2026-01-02' };
/** 기준 묶음의 프로필(4세대 · 손해보험사 칸)에 있는 그룹 키: 기준 묶음의 매핑과 같은 칸을 쓴다. */
export const BASE_GROUP_KEY = 'TEST_GROUP_BENEFIT';

export interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface Session {
  context: BrowserContext;
  page: Page;
}

export const json = async (response: APIResponse): Promise<Json> => (await response.json()) as Json;

// ───────────────────────── 사진·기록 ─────────────────────────

export const SHOTS = path.resolve('.moai/state/shots/m7-bundle');
// 실행 기록(텍스트)은 증거 도구(evidence.ts) 한 곳만 쓴다: 환경 변수 KIOSK_E2E_EVIDENCE_DIR 이 있을 때만 그 폴더 아래에 남고, 없으면 아무것도 쓰지 않는다(시험을 돌려도 저장소에 파일이 생기지 않는다).
// 예: KIOSK_E2E_EVIDENCE_DIR=.moai/state/shots/m7-bundle npx playwright test --project=admin-bundle --project=admin-bundle-reject. 사진(SHOTS)은 육안 검토용이라 늘 남는다(.moai/state 는 git 이 보지 않는다).
export const LOG_FILE = 'bundle-flow-log.txt';
export const REJECT_LOG_FILE = 'bundle-reject-log.txt';

export async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled', fullPage: true });
}

/** 실행 기록에 한 줄을 더한다(병렬이 아니라 한 파일 안에서 순서대로 도는 시험이 쓴다). */
export function note(line: string, file: string = LOG_FILE): void {
  appendEvidenceLine(file, line);
}

/** 기록 파일을 비운다(시험 첫 단계에서 한 번). */
export function resetNote(file: string = LOG_FILE): void {
  resetEvidenceFile(file);
}

/** 긴 응답 본문을 기록에 넣을 때 쓰는 앞부분(잘랐으면 표시한다). */
export function excerpt(text: string, max = 700): string {
  return text.length <= max ? text : `${text.slice(0, max)} …(${String(text.length)}자 중 앞 ${String(max)}자)`;
}

// ───────────────────────── 로그인·문맥 ─────────────────────────

export async function login(page: Page, account: Account): Promise<void> {
  await page.goto('/__harness/login');
  await page.locator(`[data-test-account="${account}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${HOME[account].replace(/\//g, '\\/')}$`));
}

export async function openAs(browser: Browser, account: Account | null): Promise<Session> {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (account !== null) await login(page, account);
  return { context, page };
}

export async function closeAll(...sessions: Session[]): Promise<void> {
  for (const session of sessions) await session.context.close();
}

/** 선행 단계(검토 요청·초안·제출·승인)를 하는 세 계정의 문맥: 병원 1 관리자, 검토 담당자 1·2. */
export async function openRoles(browser: Browser): Promise<Roles> {
  return { ha: await openAs(browser, 'ha-clinic-1'), rv1: await openAs(browser, 'rv-1'), rv2: await openAs(browser, 'rv-2') };
}

// ───────────────────────── 시험 전용 끝점 ─────────────────────────

export interface RawCall {
  status: number;
  text: string;
  body: Json;
}

async function raw(response: APIResponse): Promise<RawCall> {
  const text = await response.text();
  let body: Json = {};
  try {
    body = JSON.parse(text) as Json;
  } catch {
    body = {};
  }
  return { status: response.status(), text, body };
}

/** 세계를 통째로 새로 만든다(저장소·시계·식별자·로그인 세션 모두 새것). */
export async function resetWorld(request: APIRequestContext): Promise<void> {
  const response = await request.post('/__harness/reset');
  expect(response.status()).toBe(200);
}

/** 저장소 전체 사본의 글자 그대로(비교용). */
export async function stateText(request: APIRequestContext): Promise<string> {
  const response = await request.get('/__harness/state');
  expect(response.status()).toBe(200);
  return response.text();
}

export async function auditLog(request: APIRequestContext): Promise<Json[]> {
  const response = await request.get('/__harness/audit');
  expect(response.status()).toBe(200);
  return ((await response.json()) as Json)['entries'] as Json[];
}

export async function changeCoverage(request: APIRequestContext, treatmentId: string = TREATMENT_C): Promise<Json> {
  const response = await request.post('/__harness/test/change-coverage', { data: { treatmentId } });
  expect(response.status()).toBe(200);
  return json(response);
}

// ───────────────────────── 공개 API(키오스크가 읽는 것) ─────────────────────────

export interface PublicSnapshot {
  catalog: RawCall;
  options: RawCall;
  estimate: RawCall;
}

/** 그 병원의 공개 자료를 지금 값으로 읽고, 같은 값으로 계산을 요청한다(4세대 · 손해보험사). 글자 그대로 비교할 수 있게 본문 원문을 함께 돌려준다. */
export async function publicSnapshot(request: APIRequestContext, slug: string, treatmentIds: string[]): Promise<PublicSnapshot> {
  const catalog = await raw(await request.get(`/api/clinics/${slug}/catalog`));
  const options = await raw(await request.get(`/api/clinics/${slug}/insurance/options`));
  const estimate = await estimateWith(request, slug, catalog.body['catalogVersion'] as string, options.body['ruleBundleVersion'] as string | null, treatmentIds);
  return { catalog, options, estimate };
}

export async function estimateWith(request: APIRequestContext, slug: string, catalogVersion: string, ruleBundleVersion: string | null, treatmentIds: string[]): Promise<RawCall> {
  return raw(await request.post(`/api/clinics/${slug}/estimate`, { data: { catalogVersion, ruleBundleVersion, ...CONDITION, treatmentIds } }));
}

/** 계산 결과에서 그 치료의 줄(상태·보류 사유). */
export function lineOf(call: RawCall, treatmentId: string): Json {
  return ((call.body['result'] as Json)['lines'] as Json[]).find((line) => line['treatmentId'] === treatmentId) as Json;
}

// ───────────────────────── 선행 단계(실제 관리자 API) ─────────────────────────

export const SCOPE_NON_LIFE = [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }];

export interface MappingRef {
  id: string;
  version: string;
}

/** 병원 관리자가 그 치료에 검토 요청을 보낸다(제안: 현재 값 그대로 + 분류). 요청 id 를 돌려준다. */
export async function requestReview(ha: Session, treatmentId: string, benefitType = 'BENEFIT', calcClass = 'GENERAL_BENEFIT'): Promise<string> {
  const response = await ha.context.request.post(`/api/admin/clinics/${CLINIC_1}/treatments/${treatmentId}/review-requests`, {
    data: { proposed: { benefitType, procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_B'], calcClass } },
  });
  expect(response.status(), `검토 요청 ${treatmentId}: ${await response.text()}`).toBe(200);
  return ((await response.json()) as Json)['reviewRequest']['id'] as string;
}

export interface DraftOptions {
  groupKey?: string;
  scope?: Array<{ generation: string; insurerType: string }>;
  decision?: 'COVERED' | 'EXCLUDED';
}

/** 검토 담당자가 열린 요청으로 매핑 초안을 만든다. */
export async function draftMapping(rv: Session, reviewRequestId: string, options: DraftOptions = {}): Promise<MappingRef> {
  const decision = options.decision ?? 'COVERED';
  const mapping = {
    scope: options.scope ?? SCOPE_NON_LIFE,
    decision,
    ...(decision === 'COVERED' ? { groupKey: options.groupKey ?? BASE_GROUP_KEY } : { exclusionReason: 'TEST_FIXTURE 제외 사유' }),
    validity: { from: '2026-01-01', to: '2026-12-31' },
    policySources: [SOURCE],
  };
  const response = await rv.context.request.post(`/api/admin/review-requests/${encodeURIComponent(reviewRequestId)}/mappings`, { data: { mapping } });
  expect(response.status(), `매핑 초안: ${await response.text()}`).toBe(200);
  const ref = ((await response.json()) as Json)['entry']['mapping']['ref'] as Json;
  return { id: ref['id'] as string, version: ref['version'] as string };
}

const itemUrl = (ref: MappingRef, action: 'submit' | 'approve' | 'reject'): string => `/api/admin/mappings/${encodeURIComponent(ref.id)}/versions/${encodeURIComponent(ref.version)}/${action}`;

export async function submitMapping(rv: Session, ref: MappingRef, reviewRequestId: string): Promise<void> {
  const response = await rv.context.request.post(itemUrl(ref, 'submit'), { data: { reviewRequestId } });
  expect(response.status(), `제출: ${await response.text()}`).toBe(200);
}

export async function approveMapping(rv: Session, ref: MappingRef, reviewRequestId: string): Promise<void> {
  const response = await rv.context.request.post(itemUrl(ref, 'approve'), { data: { reviewRequestId } });
  expect(response.status(), `승인: ${await response.text()}`).toBe(200);
}

export interface Roles {
  ha: Session;
  rv1: Session;
  rv2: Session;
}

/** 검토 요청 → 초안(rv-1) → 제출(rv-1) → 승인(rv-2) 까지 가서 APPROVED 매핑 하나를 만든다. */
export async function approvedMapping(roles: Roles, treatmentId: string, options: DraftOptions = {}): Promise<MappingRef & { reviewRequestId: string }> {
  const reviewRequestId = await requestReview(roles.ha, treatmentId);
  const ref = await draftMapping(roles.rv1, reviewRequestId, options);
  await submitMapping(roles.rv1, ref, reviewRequestId);
  await approveMapping(roles.rv2, ref, reviewRequestId);
  return { ...ref, reviewRequestId };
}

/** 검토 요청 → 초안까지(승인 전). 제출 여부를 고른다. */
export async function unapprovedMapping(roles: Roles, treatmentId: string, submit: boolean, options: DraftOptions = {}): Promise<MappingRef & { reviewRequestId: string }> {
  const reviewRequestId = await requestReview(roles.ha, treatmentId);
  const ref = await draftMapping(roles.rv1, reviewRequestId, options);
  if (submit) await submitMapping(roles.rv1, ref, reviewRequestId);
  return { ...ref, reviewRequestId };
}

// ───────────────────────── 묶음 게시·규칙 사용 범위 API ─────────────────────────

export const refBody = (ref: MappingRef): MappingRef => ({ id: ref.id, version: ref.version });
export const PUBLISH_PATH = '/api/admin/bundle-publish';
export const PREVIEW_PATH = '/api/admin/bundle-publish/preview';
export const SCOPE_PATH = '/api/admin/rule-scope';
export const scopeClinicPath = (clinicId: string): string => `/api/admin/rule-scope/clinics/${encodeURIComponent(clinicId)}`;

/** 새 API 다섯 경로(메서드, 경로, 본문). 본문은 형식만 맞춘 값이라 인증·권한에서 거절되는 시험에 쓴다. */
export function fiveRoutes(baseBundleId: string, ref: MappingRef): Array<{ name: string; method: string; path: string; data?: unknown; role: 'RV' | 'PO' }> {
  return [
    { name: '개요(RV)', method: 'GET', path: PUBLISH_PATH, role: 'RV' },
    { name: '미리보기(RV)', method: 'POST', path: PREVIEW_PATH, data: { baseBundleId, mappings: [refBody(ref)] }, role: 'RV' },
    { name: '게시(RV)', method: 'POST', path: PUBLISH_PATH, data: { baseBundleId, mappings: [refBody(ref)], publishConfirmation: 'a'.repeat(64) }, role: 'RV' },
    { name: '개요(PO)', method: 'GET', path: SCOPE_PATH, role: 'PO' },
    { name: '지정(PO)', method: 'POST', path: scopeClinicPath(CLINIC_1), data: { ruleBundleVersionId: baseBundleId, expectedCurrentBundleId: baseBundleId }, role: 'PO' },
  ];
}

/** RV 가 묶음 게시 개요를 읽는다. */
export async function bundleOverview(rv: Session): Promise<Json> {
  const response = await rv.context.request.get(PUBLISH_PATH);
  expect(response.status()).toBe(200);
  return json(response);
}

/** PO 가 규칙 사용 범위 개요를 읽는다. */
export async function scopeOverview(po: Session): Promise<Json> {
  const response = await po.context.request.get(SCOPE_PATH);
  expect(response.status()).toBe(200);
  return json(response);
}

/** 가장 최근에 게시된 사용 가능한 기준 묶음 id (개요의 첫 줄: 최신순). */
export async function newestBaseId(rv: Session): Promise<string> {
  const bases = (await bundleOverview(rv))['bases'] as Json[];
  const active = bases.find((base) => base['status'] === 'ACTIVE');
  expect(active, '사용 가능한 기준 묶음').toBeTruthy();
  return (active as Json)['bundleId'] as string;
}

/** 미리보기를 API 로 받아 확인값을 돌려준다(깨끗한 구성이어야 한다). */
export async function previewConfirmation(rv: Session, baseBundleId: string, refs: MappingRef[]): Promise<string> {
  const response = await rv.context.request.post(PREVIEW_PATH, { data: { baseBundleId, mappings: refs.map(refBody) } });
  expect(response.status()).toBe(200);
  const confirmation = ((await response.json()) as Json)['publishConfirmation'] as string | null;
  expect(confirmation).toMatch(/^[0-9a-f]{64}$/);
  return confirmation as string;
}

/** 미리보기 → 게시를 API 로 한다. 새 묶음 id 를 돌려준다. */
export async function publishViaApi(rv: Session, baseBundleId: string, refs: MappingRef[]): Promise<string> {
  const confirmation = await previewConfirmation(rv, baseBundleId, refs);
  const response = await rv.context.request.post(PUBLISH_PATH, { data: { baseBundleId, mappings: refs.map(refBody), publishConfirmation: confirmation } });
  expect(response.status(), `게시: ${await response.text()}`).toBe(200);
  return ((await response.json()) as Json)['bundle']['id'] as string;
}

// ───────────────────────── 화면 표지 ─────────────────────────

export async function gotoBundles(session: Session): Promise<void> {
  await session.page.goto('/admin/bundles');
  await expect(session.page.locator('[data-admin-page="bundles"]')).toBeVisible();
}

export async function gotoScope(session: Session): Promise<void> {
  await session.page.goto('/admin/rule-scope');
  await expect(session.page.locator('[data-admin-page="rule-scope"]')).toBeVisible();
}

export const candidateRow = (page: Page, ref: MappingRef) => page.locator(`[data-admin-candidate="${ref.id}@${ref.version}"]`);
export const previewButton = (page: Page) => page.locator('button[data-admin-action="preview"]');
export const publishButton = (page: Page) => page.locator('button[data-admin-action="publish"]');
export const scopeRow = (page: Page, clinicId: string) => page.locator(`[data-admin-scope-row="${clinicId}"]`);

// ───────────────────────── 키오스크 화면 ─────────────────────────

/** 키오스크에서 4세대 · 손해보험사 · 첫 원인까지 입력하고 치료 선택 화면에서 멈춘다. */
export async function kioskToTreatments(page: Page, slug: string): Promise<void> {
  await page.goto(`/kiosk/${slug}`);
  await page.getByRole('button', { name: '시작하기' }).click();
  await page.getByRole('radio', { name: '4세대(C4)' }).check();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('radio', { name: '손해보험사' }).check();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByRole('heading', { name: '확인할 치료를 선택해 주세요' })).toBeVisible();
}

export interface KioskOutcome {
  kind: string | null;
  state: string;
  hospitalPaymentText: string | null;
  body: Json;
}

/** 키오스크에서 이름(정규식)으로 치료를 골라 계산하고, 서버 응답과 화면 표지·병원 결제액 글자를 돌려준다. 새 브라우저 문맥(키오스크 크기)에서 연다. */
export async function kioskCalculate(browser: Browser, slug: string, pick: RegExp, shotName?: string): Promise<KioskOutcome> {
  const context = await browser.newContext({ viewport: { width: 1080, height: 1920 }, locale: 'ko-KR' });
  try {
    const kiosk = await context.newPage();
    await kioskToTreatments(kiosk, slug);
    await kiosk.getByRole('checkbox', { name: pick }).check();
    const response = kiosk.waitForResponse((entry) => entry.url().endsWith('/estimate') && entry.request().method() === 'POST');
    await kiosk.getByRole('button', { name: '예상 부담액 확인' }).click();
    const body = (await (await response).json()) as Json;
    await expect(kiosk.locator('[data-result]')).toBeVisible();
    const hospital = kiosk.locator('[data-kiosk-amount="hospital"] .kiosk-amount__value');
    const outcome: KioskOutcome = {
      kind: await kiosk.locator('[data-result]').getAttribute('data-result'),
      state: (body['result'] as Json)['state'] as string,
      hospitalPaymentText: (await hospital.count()) > 0 ? (await hospital.innerText()).trim() : null,
      body,
    };
    if (shotName !== undefined) await shoot(kiosk, shotName);
    return outcome;
  } finally {
    await context.close();
  }
}
