import type { Browser } from '@playwright/test';
import { expect, test } from '../helpers/test';
import {
  CLINIC_1,
  CLINIC_2,
  NAME_C,
  OTHER_TREATMENT,
  PUBLISH_PATH,
  SLUG_1,
  SLUG_2,
  TREATMENT_A,
  TREATMENT_B,
  TREATMENT_C,
  USERS,
  approvedMapping,
  auditLog,
  bundleOverview,
  candidateRow,
  closeAll,
  estimateWith,
  excerpt,
  gotoBundles,
  json,
  kioskCalculate,
  lineOf,
  newestBaseId,
  note,
  openAs,
  previewButton,
  previewConfirmation,
  publicSnapshot,
  publishButton,
  refBody,
  resetNote,
  resetWorld,
  scopeOverview,
  scopeRow,
  shoot,
  stateText,
} from '../helpers/bundle-flow';
import type { Json, MappingRef, PublicSnapshot, Session } from '../helpers/bundle-flow';

// 묶음 게시 · 규칙 사용 범위 흐름 (SPEC-REIMBURSEMENT-001 M7 묶음 구성): 승인된 매핑 → 검토 담당자(RV)가 새 규칙 묶음을 게시 → 플랫폼 운영자(PO)가 병원 한 곳에 지정 → 그 병원의 키오스크 선택지·계산이 새 묶음을 쓴다.
// 앞단(tests/e2e/harness/server.ts, 이 파일 전용 인스턴스 ADMIN_BUNDLE_PORT)이 실제 관리자 핸들러·공개 핸들러를 시험 인증기와 시험 자료(TEST_FIXTURE)로 돌린다. 묶음 시연 세계(--bundle-demo): 병원 1 에 치료 C 가 있고 기준 묶음에는 C 의 매핑이 없다.
// 통신 가로채기는 쓰지 않는다: 모든 요청이 실제 HTTP 로 앞단을 지난다. 브라우저 문맥을 계정마다 따로 연다(쿠키가 문맥마다 다르다).
// 화면으로 한 것: 로그인 이동, 묶음 게시 화면(후보 · 미리보기 · 게시), 규칙 사용 범위 화면(바꿀 묶음 고르기 · 적용), 키오스크 화면(치료 C 계산). 선행 단계(병원 관리자의 검토 요청 → 검토 담당자의 매핑 초안·제출 → 다른 검토 담당자의 승인)는
//   매핑 검토 시험(mapping-review.admin-mapping.spec.ts)이 화면으로 이미 확인했으므로 여기서는 로그인한 세션의 실제 관리자 API 로 한다.
// 증명하려는 것:
//   - 게시만으로는 아무 병원도 바뀌지 않는다: 게시 직후 병원 1·2 의 카탈로그·보험 선택지·계산 응답이 게시 전과 글자 그대로 같다.
//   - 지정한 병원만 바뀐다: 병원 1 에 지정한 뒤 병원 1 의 보험 선택지가 새 묶음을 가리키고 치료 C 가 보류(MAPPING_ABSENT)에서 계산(ESTIMATED)으로 바뀐다. 병원 2 의 응답은 글자 그대로 같고, 규칙 사용 범위 화면의 병원 2 줄도 그대로다.
//   - 이전 묶음을 본 계산 요청은 병원 1 에서만 409 VERSION_MISMATCH(최신 묶음 = 새 묶음, ruleChanged), 병원 2 에서는 그대로 통한다.
//   - 감사 기록은 이 흐름이 BUNDLE_PUBLISH 한 건 · CLINIC_SCOPE_ASSIGN 한 건만 더했음을 보인다(대상 · 이전/이후 버전 · 행위자 역할).
//   - 미리보기 우회는 막혀 있다: 화면 미리보기가 저장소에 남기는 것은 확인값 기록(bundleConfirmations) 하나뿐이고, 미리보기 없이 보낸 확인값 · 다른 관리자가 받은 확인값은 409 PREVIEW_REQUIRED 이며,
//     화면이 보낸 게시 요청을 글자 그대로 다시 보내도 409 PREVIEW_REQUIRED 다(확인값은 일회용이라 새 묶음은 하나뿐이다).
// 한 파일 안에서 순서대로 돈다: 앞 단계가 만든 매핑·묶음을 뒤 단계가 이어받는다. 사진은 .moai/state/shots/m7-bundle/ 에 남고(육안 검토용 자료이며 시험 결과가 아니다), 실행 기록(bundle-flow-log.txt)은 환경 변수 KIOSK_E2E_EVIDENCE_DIR 을 정했을 때만 그 폴더에 쌓인다(helpers/evidence.ts).

test.describe.configure({ mode: 'serial' });

const C_PATTERN = /시험 치료 C/;

let baseId = '';
let mapping: MappingRef = { id: '', version: '' };
let newBundleId = '';
let before: { c1: PublicSnapshot; ab1: PublicSnapshot; c2: PublicSnapshot };
let auditBaseline = 0;
let stateAfterApproval = '';

async function sessions(browser: Browser): Promise<{ ha: Session; rv1: Session; rv2: Session }> {
  return { ha: await openAs(browser, 'ha-clinic-1'), rv1: await openAs(browser, 'rv-1'), rv2: await openAs(browser, 'rv-2') };
}

const snapshotAll = async (session: Session): Promise<{ c1: PublicSnapshot; ab1: PublicSnapshot; c2: PublicSnapshot }> => ({
  c1: await publicSnapshot(session.context.request, SLUG_1, [TREATMENT_C]),
  ab1: await publicSnapshot(session.context.request, SLUG_1, [TREATMENT_A, TREATMENT_B]),
  c2: await publicSnapshot(session.context.request, SLUG_2, [OTHER_TREATMENT]),
});

/** 세 가지 공개 응답(카탈로그 · 보험 선택지 · 계산)이 글자 그대로 같다. */
function expectSamePublic(actual: PublicSnapshot, expected: PublicSnapshot, label: string): void {
  expect(actual.catalog.text, `${label} 카탈로그`).toBe(expected.catalog.text);
  expect(actual.options.text, `${label} 보험 선택지`).toBe(expected.options.text);
  expect(actual.estimate.text, `${label} 계산`).toBe(expected.estimate.text);
}

test('S0 기준선: 로그인 이동(PO → 규칙 사용 범위, RV → 검토 대기열)과 시험 로그인 계정, 두 병원이 같은 기준 묶음을 쓰고 치료 C 는 매핑이 없어 계산 보류다', async ({ browser, request }) => {
  await resetWorld(request);
  resetNote();
  note('# M7 묶음 구성 브라우저 시험(admin-bundle) 흐름 기록 — 실제 Chrome, 실제 HTTP(요청 가로채기 없음), 묶음 시연 세계(--bundle-demo). 응답 본문은 앞부분만 남긴다.');
  note('# 선행 단계(검토 요청 → 매핑 초안 → 제출 → 승인)는 mapping-review.admin-mapping.spec.ts 가 화면으로 이미 확인했으므로, 이 시험에서는 로그인한 세션의 실제 관리자 API 로 한다.');

  const anonymous = await openAs(browser, null);
  await anonymous.page.goto('/__harness/login');
  for (const account of ['ha-clinic-1', 'ha-clinic-2', 'rv-1', 'rv-2', 'rv-clinic-1', 'po-1']) {
    await expect(anonymous.page.locator(`[data-test-account="${account}"]`), `로그인 화면의 ${account}`).toBeVisible();
  }
  await closeAll(anonymous);

  // openAs 가 로그인 직후의 주소를 확인한다: PO → /admin/rule-scope, 플랫폼 RV → /admin/review-queue, HA → 소속 병원 가격 관리.
  const po = await openAs(browser, 'po-1');
  const rv2 = await openAs(browser, 'rv-2');
  const ha = await openAs(browser, 'ha-clinic-1');
  try {
    await expect(po.page.locator('[data-admin-page="rule-scope"]')).toBeVisible();
    await expect(po.page.locator('[data-admin-user]')).toHaveText(USERS['po-1']);
    await expect(rv2.page.locator('[data-admin-page="review-queue"]')).toBeVisible();
    note('로그인 이동: po-1 → /admin/rule-scope, rv-2 → /admin/review-queue, ha-clinic-1 → /admin/TEST_FIXTURE_CLINIC_1/treatments (확인)');

    const bases = (await bundleOverview(rv2))['bases'] as Json[];
    expect(bases).toHaveLength(1);
    baseId = bases[0]!['bundleId'] as string;
    expect(bases[0]).toMatchObject({ status: 'ACTIVE', itemCounts: { profiles: 1, mappings: 3, documentRuleSets: 1 } });
    expect((bases[0]!['clinics'] as Json[]).map((clinic) => clinic['clinicId']).sort()).toEqual([CLINIC_1, CLINIC_2]);
    expect(await newestBaseId(rv2)).toBe(baseId);
    expect((await bundleOverview(rv2))['candidates']).toEqual([]);

    const scope = await scopeOverview(po);
    expect((scope['clinics'] as Json[]).map((clinic) => [clinic['clinicId'], (clinic['current'] as Json | null)?.['bundleId']])).toEqual([
      [CLINIC_1, baseId],
      [CLINIC_2, baseId],
    ]);
    expect((scope['bundles'] as Json[]).map((bundle) => bundle['bundleId'])).toEqual([baseId]);

    before = await snapshotAll(ha);
    expect(before.c1.options.body['ruleBundleVersion']).toBe(baseId);
    expect(before.c2.options.body['ruleBundleVersion']).toBe(baseId);
    // 치료 C 는 기준 묶음에 매핑이 없어 계산이 보류(MAPPING_ABSENT)다. 치료 A·B 는 정상이다.
    expect(before.c1.estimate.status).toBe(200);
    expect(lineOf(before.c1.estimate, TREATMENT_C)).toMatchObject({ state: 'ON_HOLD', holdReason: 'MAPPING_ABSENT' });
    expect(lineOf(before.ab1.estimate, TREATMENT_A).state).toBe('ESTIMATED');
    expect(lineOf(before.ab1.estimate, TREATMENT_B).state).toBe('ESTIMATED');
    expect(before.c2.estimate.status).toBe(200);
    note(`기준 묶음 = ${baseId} (ACTIVE, 프로필 1 · 매핑 3 · 서류 규칙 묶음 1), 병원 1·2 모두 이 묶음을 쓴다`);
    note(`BEFORE 병원 1 보험 선택지(앞부분): ${excerpt(before.c1.options.text, 160)}`);
    note(`BEFORE 병원 1 계산 [치료 C] → state=${String((before.c1.estimate.body['result'] as Json)['state'])}, C 줄=${JSON.stringify(lineOf(before.c1.estimate, TREATMENT_C))}`);
    note(`BEFORE 병원 1 계산 [치료 A·B] → A=${String(lineOf(before.ab1.estimate, TREATMENT_A)['state'])}, B=${String(lineOf(before.ab1.estimate, TREATMENT_B)['state'])}`);
    note(`BEFORE 병원 2 보험 선택지(앞부분): ${excerpt(before.c2.options.text, 160)}`);
    note(`BEFORE 병원 2 계산 응답(앞부분): ${excerpt(before.c2.estimate.text, 400)}`);
  } finally {
    await closeAll(po, rv2, ha);
  }
});

test('S1 선행 단계(실제 관리자 API): 병원 1 관리자가 C 에 검토 요청 → rv-1 이 매핑 초안·제출 → rv-2 가 승인. 승인은 검토 기록일 뿐이라 공개 자료가 게시 전과 같고, 승인된 매핑이 후보로 보인다', async ({ browser }) => {
  const roles = await sessions(browser);
  try {
    const approved = await approvedMapping(roles, TREATMENT_C);
    mapping = { id: approved.id, version: approved.version };
    note(`선행: 검토 요청 ${approved.reviewRequestId} → 매핑 ${mapping.id} v${mapping.version} 초안(rv-1) → 제출(rv-1) → 승인(rv-2) [API]`);

    // 승인은 검토 기록: 공개 자료는 기준선과 글자 그대로 같다.
    const after = await snapshotAll(roles.ha);
    expectSamePublic(after.c1, before.c1, '승인 뒤 병원 1[C]');
    expectSamePublic(after.ab1, before.ab1, '승인 뒤 병원 1[A,B]');
    expectSamePublic(after.c2, before.c2, '승인 뒤 병원 2');

    const overview = await bundleOverview(roles.rv2);
    expect((overview['bases'] as Json[]).map((base) => base['bundleId'])).toEqual([baseId]);
    expect(overview['candidates']).toHaveLength(1);
    expect((overview['candidates'] as Json[])[0]).toMatchObject({ mappingRef: { id: mapping.id, version: mapping.version }, treatmentId: TREATMENT_C, approvedFingerprint: 'CURRENT', decision: 'COVERED' });
    auditBaseline = (await auditLog(roles.ha.context.request)).length;
    stateAfterApproval = await stateText(roles.ha.context.request);
    note(`선행 직후 감사 기록 ${String(auditBaseline)}건 (이후 이 흐름이 더한 것만 센다)`);
  } finally {
    await closeAll(roles.ha, roles.rv1, roles.rv2);
  }
});

test('S2 묶음 게시 화면(rv-2): 후보에 승인된 매핑 C → 고르면 미리보기 단추가 열리고 게시는 닫혀 있다 → 미리보기(기준 묶음 항목 + 추가 1건) → 선택을 바꾸면 게시가 다시 닫힘 → 다시 미리보기 → 게시', async ({ browser }) => {
  const rv2 = await openAs(browser, 'rv-2');
  try {
    const page = rv2.page;
    await gotoBundles(rv2);
    await expect(page.locator('[data-admin-user]')).toHaveText(USERS['rv-2']);

    // 기준 묶음: 사용 가능한 가장 최신 묶음이 골라져 있고 두 병원이 쓰는 중이다.
    const base = page.locator(`[data-admin-base="${baseId}"]`);
    await expect(base).toHaveAttribute('data-admin-base-status', 'ACTIVE');
    await expect(base).toHaveAttribute('data-selected', 'true');
    await expect(page.locator(`[data-admin-base-radio="${baseId}"]`)).toBeChecked();
    await expect(base.locator('[data-admin-base-clinics]')).toContainText(SLUG_1);
    await expect(base.locator('[data-admin-base-clinics]')).toContainText(SLUG_2);

    // 후보: 승인된 매핑 하나. 치료 이름 · 보장함 · 승인 뒤 바뀐 점 없음.
    const row = candidateRow(page, mapping);
    await expect(page.locator('[data-admin-candidate]')).toHaveCount(1);
    await expect(row.locator('[data-admin-candidate-treatment]')).toHaveText(NAME_C);
    await expect(row.locator('[data-admin-candidate-decision]')).toHaveText('보장함');
    await expect(row).toHaveAttribute('data-admin-candidate-fingerprint', 'CURRENT');
    await expect(row.locator('[data-admin-candidate-warning]')).toHaveCount(0);
    await expect(row).toHaveAttribute('data-selected', 'false');

    // 아무것도 고르지 않았으면 미리보기도 게시도 닫혀 있다.
    await expect(previewButton(page)).toBeDisabled();
    await expect(publishButton(page)).toBeDisabled();
    await expect(page.locator('[data-admin-preview-hint]')).toHaveText('더할 매핑을 하나 이상 골라 주세요.');
    await shoot(page, 'bundle-1-rv-candidates');

    // 고르면 미리보기가 열린다. 게시는 미리보기를 본 뒤에만 열린다.
    await row.locator('[data-admin-candidate-check]').check();
    await expect(page.locator('[data-admin-selected-count]')).toHaveText('고른 매핑 1건');
    await expect(previewButton(page)).toBeEnabled();
    await expect(publishButton(page)).toBeDisabled();
    await expect(page.locator('[data-admin-publish-hint]')).toHaveText('미리보기를 확인한 뒤에 게시할 수 있습니다.');

    // 미리보기: 읽기만 한다. 요청은 POST /preview 하나이고 게시(POST /bundle-publish)는 나가지 않는다.
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    const previewed = page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith('/api/admin/bundle-publish/preview'));
    await previewButton(page).click();
    const previewResponse = await previewed;
    expect(previewResponse.status()).toBe(200);
    const previewBody = (await previewResponse.json()) as Json;
    expect(previewBody['publishConfirmation']).toMatch(/^[0-9a-f]{64}$/);
    expect(previewBody['defects']).toEqual([]);
    expect(previewBody['conflicts']).toEqual([]);

    // 미리보기가 저장소에 남긴 것은 서버의 확인값 기록 하나뿐이다: 묶음 · 가용성 · 항목 상태 · 범위 이력 · 감사는 그대로다.
    const afterPreview = JSON.parse(await stateText(rv2.context.request)) as Record<string, unknown>;
    const beforePreview = JSON.parse(stateAfterApproval) as Record<string, unknown>;
    expect(Object.keys(afterPreview).filter((key) => JSON.stringify(afterPreview[key]) !== JSON.stringify(beforePreview[key])).sort()).toEqual(['bundleConfirmations']);
    note(`화면 미리보기 직후: 저장소에서 달라진 영역 = bundleConfirmations 하나 (확인값 기록 ${String((afterPreview['bundleConfirmations'] as unknown[]).length)}건)`);

    // 우회 시도 (API, rv-2 세션): 미리보기를 받지 않은 확인값 · 다른 관리자가 받은 확인값은 같은 409 PREVIEW_REQUIRED 이고 저장소는 그대로다.
    const stateBeforeGuess = await stateText(rv2.context.request);
    const guess = await rv2.context.request.post(PUBLISH_PATH, { data: { baseBundleId: baseId, mappings: [refBody(mapping)], publishConfirmation: 'a'.repeat(64) } });
    expect([guess.status(), await json(guess)]).toEqual([409, { error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' }]);
    expect(await stateText(rv2.context.request)).toBe(stateBeforeGuess);
    const rv1 =await openAs(browser, 'rv-1');
    try {
      const othersToken = await previewConfirmation(rv1, baseId, [mapping]);
      const stateBeforeStolen = await stateText(rv2.context.request);
      const stolen = await rv2.context.request.post(PUBLISH_PATH, { data: { baseBundleId: baseId, mappings: [refBody(mapping)], publishConfirmation: othersToken } });
      expect([stolen.status(), await json(stolen)]).toEqual([409, { error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' }]);
      expect(await stateText(rv2.context.request)).toBe(stateBeforeStolen);
      note(`우회 시도(API): 발급된 적 없는 확인값 → ${String(guess.status())} PREVIEW_REQUIRED, rv-1 이 받은 확인값을 rv-2 가 사용 → ${String(stolen.status())} PREVIEW_REQUIRED (저장소 그대로)`);
    } finally {
      await closeAll(rv1);
    }
    // rv-1 의 미리보기가 확인값 기록을 하나 더했을 뿐 그 밖의 영역은 그대로다.
    const afterBypass = JSON.parse(await stateText(rv2.context.request)) as Record<string, unknown>;
    expect(Object.keys(afterBypass).filter((key) => JSON.stringify(afterBypass[key]) !== JSON.stringify(beforePreview[key])).sort()).toEqual(['bundleConfirmations']);

    const preview = page.locator('[data-admin-preview]');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('data-admin-preview-publishable', 'true');
    // 기준 묶음의 항목 5건(프로필 1 · 매핑 3 · 서류 규칙 묶음 1)은 "기준 묶음", 더한 매핑 1건은 "추가".
    await expect(preview.locator('[data-admin-preview-item][data-admin-preview-source="BASE"]')).toHaveCount(5);
    const added = preview.locator('[data-admin-preview-item][data-admin-preview-source="ADDED"]');
    await expect(added).toHaveCount(1);
    await expect(added).toHaveAttribute('data-admin-preview-id', mapping.id);
    await expect(added.locator('[data-admin-preview-source-text]')).toHaveText('추가');
    await expect(preview.locator('[data-admin-preview-item][data-admin-preview-source="BASE"] [data-admin-preview-source-text]').first()).toHaveText('기준 묶음');
    await expect(preview.locator('[data-admin-preview-group="PROFILE"] [data-admin-preview-item]')).toHaveCount(1);
    await expect(preview.locator('[data-admin-preview-group="MAPPING"] [data-admin-preview-item]')).toHaveCount(4);
    await expect(preview.locator('[data-admin-preview-group="DOCUMENT_RULE_SET"] [data-admin-preview-item]')).toHaveCount(1);
    await expect(preview.locator('[data-admin-preview-summary]')).toContainText('기준 묶음에서 5건, 새로 더한 매핑 1건');
    await expect(preview.locator('[data-admin-preview-clean]')).toBeVisible();
    await expect(publishButton(page)).toBeEnabled();
    await expect(page.locator('[data-admin-publish-hint]')).toContainText('어느 병원에도 바로 적용되지는 않습니다');
    expect(writes).toEqual(['POST /api/admin/bundle-publish/preview']);
    await shoot(page, 'bundle-2-preview');

    // 선택을 바꾸면(해제) 미리보기가 지워지고 게시가 다시 닫힌다. 다시 고르면 미리보기를 새로 해야 게시가 열린다.
    await row.locator('[data-admin-candidate-check]').uncheck();
    await expect(preview).toHaveCount(0);
    await expect(publishButton(page)).toBeDisabled();
    await row.locator('[data-admin-candidate-check]').check();
    await expect(preview).toHaveCount(0);
    await expect(publishButton(page)).toBeDisabled();
    await expect(page.locator('[data-admin-publish-hint]')).toHaveText('미리보기를 확인한 뒤에 게시할 수 있습니다.');
    await previewButton(page).click();
    await expect(page.locator('[data-admin-preview][data-admin-preview-publishable="true"]')).toBeVisible();
    await expect(publishButton(page)).toBeEnabled();

    // 게시: 새 묶음이 만들어졌다는 문장과 함께 "아직 어느 병원에도 적용되지 않았습니다"라고 말한다.
    const published = page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith('/api/admin/bundle-publish'));
    await publishButton(page).click();
    const publishResponse = await published;
    expect(publishResponse.status()).toBe(200);
    const publishBody = (await publishResponse.json()) as Json;
    expect(publishBody['assignedClinics']).toEqual([]);
    newBundleId = publishBody['bundle']['id'] as string;
    expect(newBundleId).not.toBe(baseId);
    const publishRequestBody = publishResponse.request().postDataJSON() as Json;
    const message = page.locator('[data-admin-message="ok"]');
    await expect(message).toHaveAttribute('data-admin-message-code', 'PUBLISHED');
    await expect(message).toHaveAttribute('data-admin-published', newBundleId);
    await expect(message).toContainText('아직 어느 병원에도 적용되지 않았습니다');
    await expect(message).toContainText('플랫폼 운영자가 규칙 사용 범위에서 병원별로 지정해야 합니다');
    await expect(publishButton(page)).toBeDisabled();
    await expect(page.locator('[data-admin-preview]')).toHaveCount(0);
    await shoot(page, 'bundle-3-published-not-applied');
    note(`게시(rv-2, 화면): 새 묶음 ${newBundleId}, assignedClinics=[] — 문장: ${(await message.innerText()).trim()}`);
    note(`게시 응답(앞부분): ${excerpt(JSON.stringify(publishBody), 500)}`);

    // 확인값은 일회용이다: 화면이 보낸 게시 요청을 글자 그대로 다시 보내면 409 PREVIEW_REQUIRED 이고, 새 묶음은 여전히 하나뿐이며 저장소는 그대로다.
    const stateBeforeResend = await stateText(rv2.context.request);
    const resent = await rv2.context.request.post(PUBLISH_PATH, { data: publishRequestBody });
    expect([resent.status(), await json(resent)]).toEqual([409, { error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' }]);
    expect(await stateText(rv2.context.request)).toBe(stateBeforeResend);
    expect(((await bundleOverview(rv2))['bases'] as Json[]).map((base) => base['bundleId']).sort()).toEqual([baseId, newBundleId].sort());
    note(`같은 게시 요청을 다시 보냄 → ${String(resent.status())} PREVIEW_REQUIRED, 새 묶음은 ${newBundleId} 하나뿐(저장소 그대로)`);
  } finally {
    await closeAll(rv2);
  }
});

test('S3 게시만으로는 아무 병원도 바뀌지 않는다: 병원 1·2 의 카탈로그 · 보험 선택지 · 계산 응답이 게시 전과 글자 그대로 같고, 새 묶음은 존재하며 범위 이력은 그대로, 감사 기록은 게시가 더한 두 건(ITEM_PUBLISH · BUNDLE_PUBLISH 한 건)만 늘었다', async ({ browser }) => {
  const roles = await sessions(browser);
  const po = await openAs(browser, 'po-1');
  try {
    const after = await snapshotAll(roles.ha);
    expectSamePublic(after.c1, before.c1, '게시 뒤 병원 1[C]');
    expectSamePublic(after.ab1, before.ab1, '게시 뒤 병원 1[A,B]');
    expectSamePublic(after.c2, before.c2, '게시 뒤 병원 2');
    expect(lineOf(after.c1.estimate, TREATMENT_C)).toMatchObject({ state: 'ON_HOLD', holdReason: 'MAPPING_ABSENT' });

    // 새 묶음은 있다: 항목 6건, ACTIVE, 아직 어느 병원도 쓰지 않는다. 기준 묶음은 두 병원이 그대로 쓴다.
    const bases = (await bundleOverview(roles.rv2))['bases'] as Json[];
    const created = bases.find((base) => base['bundleId'] === newBundleId) as Json;
    expect(created).toMatchObject({ status: 'ACTIVE', itemCounts: { profiles: 1, mappings: 4, documentRuleSets: 1 }, clinics: [] });
    expect((bases.find((base) => base['bundleId'] === baseId) as Json)['clinics']).toHaveLength(2);
    const scope = await scopeOverview(po);
    expect((scope['clinics'] as Json[]).map((clinic) => [clinic['clinicId'], (clinic['current'] as Json)['bundleId']])).toEqual([
      [CLINIC_1, baseId],
      [CLINIC_2, baseId],
    ]);
    expect((scope['bundles'] as Json[]).map((bundle) => bundle['bundleId']).sort()).toEqual([baseId, newBundleId].sort());

    // 감사 기록: 선행 단계 뒤로 더해진 것은 게시가 더한 두 건뿐이다 — 더해진 매핑의 상태 전이(ITEM_PUBLISH: APPROVED → PUBLISHED)와 BUNDLE_PUBLISH 한 건. 병원 지정(CLINIC_SCOPE_ASSIGN)은 없다.
    const added = (await auditLog(roles.ha.context.request)).slice(auditBaseline);
    expect(added.map((entry) => entry['action'])).toEqual(['ITEM_PUBLISH', 'BUNDLE_PUBLISH']);
    expect(added[0]).toMatchObject({ beforeVersion: 'APPROVED', afterVersion: 'PUBLISHED', actorId: USERS['rv-2'], role: 'RV' });
    expect(String(added[0]!['target'])).toContain(mapping.id);
    expect(added[1]).toMatchObject({ target: `BUNDLE/${newBundleId}`, afterVersion: newBundleId, actorId: USERS['rv-2'], role: 'RV' });
    expect(added.filter((entry) => entry['action'] === 'CLINIC_SCOPE_ASSIGN')).toEqual([]);
    // 저장소 전체 사본은 선행 직후와 달라졌고, 그 차이는 게시 한 번(묶음 · 가용성 기록 · 항목 상태 · 감사)이다: 범위 이력 · 병원 · 카탈로그는 그대로.
    const now = JSON.parse(await stateText(roles.ha.context.request)) as Record<string, unknown>;
    const old = JSON.parse(stateAfterApproval) as Record<string, unknown>;
    const changed = Object.keys(now).filter((key) => JSON.stringify(now[key]) !== JSON.stringify(old[key])).sort();
    // 확인값 기록(bundleConfirmations)이 미리보기마다 늘고 게시가 하나를 소비하므로 이 목록에 들어간다(이전 목록에는 없던 키).
    expect(changed).toEqual(['auditLog', 'bundleConfirmations', 'bundleEvents', 'bundles', 'itemStates']);
    const records = now['bundleConfirmations'] as Array<[string, Json]>;
    expect(records.filter(([, record]) => record['consumedAt'] !== null)).toHaveLength(1);
    expect(records.filter(([, record]) => record['consumedAt'] !== null).map(([, record]) => record['resultBundleId'])).toEqual([newBundleId]);
    note(`게시 직후(지정 전): 병원 1·2 의 카탈로그·보험 선택지·계산 응답이 BEFORE 와 글자 그대로 같다. 저장소에서 달라진 영역: ${changed.join(', ')} (scopeHistory·clinics·catalogs 는 그대로; 확인값 기록 ${String(records.length)}건 중 소비된 것은 새 묶음 ${newBundleId} 로 간 1건)`);
    note(`감사 기록 추가분: ${JSON.stringify(added.map((entry) => ({ action: entry['action'], target: entry['target'], before: entry['beforeVersion'], after: entry['afterVersion'], actor: entry['actorId'], role: entry['role'] })))}`);

    // 키오스크 화면도 그대로다: 치료 C 만 골라 계산하면 아직 보류다(정상 결과가 아니다).
    const hold = await kioskCalculate(browser, SLUG_1, C_PATTERN, 'bundle-6-kiosk-before-hold-c');
    expect(hold.kind).not.toBe('normal');
    expect(hold.state).toBe('ON_HOLD');
    note(`키오스크 병원 1 (지정 전): 치료 C → 화면 data-result=${String(hold.kind)}, 서버 state=${hold.state}`);
  } finally {
    await closeAll(roles.ha, roles.rv1, roles.rv2, po);
  }
});

test('S4 규칙 사용 범위 화면(po-1): 병원 1 현재 적용본(기준 묶음)과 바꿀 묶음(새 묶음)이 다른 자리에 보이고 "현재 → 바꿀" 줄이 나온다. 모든 병원에 한꺼번에 적용하는 조작은 없다. 병원 1 한 곳만 적용한다', async ({ browser }) => {
  const po = await openAs(browser, 'po-1');
  try {
    const page = po.page;
    await expect(page.locator('[data-admin-page="rule-scope"]')).toBeVisible();
    await expect(page.locator('[data-admin-user]')).toHaveText(USERS['po-1']);
    const row1 = scopeRow(page, CLINIC_1);
    const row2 = scopeRow(page, CLINIC_2);

    // 두 병원 줄, 둘 다 현재 적용본 = 기준 묶음. 적용 단추는 병원마다 하나씩이고 닫혀 있다. 한꺼번에 적용하는 단추는 없다.
    await expect(page.locator('[data-admin-scope-row]')).toHaveCount(2);
    await expect(row1).toHaveAttribute('data-admin-scope-current', baseId);
    await expect(row2).toHaveAttribute('data-admin-scope-current', baseId);
    await expect(page.getByRole('button')).toHaveCount(2);
    await expect(page.locator('button:not([data-admin-scope-confirm])')).toHaveCount(0);
    await expect(page.locator(`button[data-admin-scope-confirm="${CLINIC_1}"]`)).toBeDisabled();
    await expect(page.locator(`button[data-admin-scope-confirm="${CLINIC_2}"]`)).toBeDisabled();
    await expect(page.locator('select')).toHaveCount(2);
    const options = page.locator(`select[data-admin-scope-select="${CLINIC_1}"] option`);
    await expect(options).toHaveCount(3); // 바꾸지 않음 + 기준 묶음 + 새 묶음
    await expect(row1.locator('[data-admin-scope-change]')).toHaveCount(0);

    // 병원 1 에서 새 묶음을 고른다: 현재 적용본 칸은 그대로 기준 묶음이고, "바꿀 묶음" 칸에 새 묶음이 있고, 둘을 잇는 줄이 나온다.
    const select = page.locator(`select[data-admin-scope-select="${CLINIC_1}"]`);
    await select.selectOption(newBundleId);
    await expect(select).toHaveValue(newBundleId);
    await expect(row1.locator(`[data-admin-scope-current-bundle="${baseId}"]`)).toBeVisible();
    const changeLine = row1.locator('[data-admin-scope-change]');
    await expect(changeLine).toContainText('현재');
    await expect(changeLine).toContainText('→');
    await expect(changeLine).toContainText('바꿀');
    const lineText = (await changeLine.innerText()).trim();
    const selectedLabel = await select.locator('option:checked').innerText();
    expect(selectedLabel).toContain('사용 가능');
    await expect(page.locator(`button[data-admin-scope-confirm="${CLINIC_1}"]`)).toBeEnabled();
    // 병원 2 는 건드리지 않았으므로 그대로 닫혀 있다.
    await expect(page.locator(`button[data-admin-scope-confirm="${CLINIC_2}"]`)).toBeDisabled();
    await expect(row2.locator('[data-admin-scope-change]')).toHaveCount(0);
    await shoot(page, 'bundle-4-po-before-after');
    note(`규칙 사용 범위 화면(po-1): 병원 1 현재 적용본=${baseId}, 바꿀 묶음 선택=${newBundleId}, 줄: ${lineText}`);

    // 적용: 병원 1 한 곳만. 요청은 POST /api/admin/rule-scope/clinics/<병원 1> 하나이고 본문에는 화면이 본 현재 적용본(기준 묶음)이 실린다.
    const assigned = page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith(`/api/admin/rule-scope/clinics/${CLINIC_1}`));
    await page.locator(`button[data-admin-scope-confirm="${CLINIC_1}"]`).click();
    const response = await assigned;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({ ruleBundleVersionId: newBundleId, expectedCurrentBundleId: baseId });
    const body = (await response.json()) as Json;
    expect(body['scope']).toMatchObject({ clinicId: CLINIC_1, ruleBundleVersionId: newBundleId, assignedBy: USERS['po-1'] });
    await expect(row1).toHaveAttribute('data-admin-scope-current', newBundleId);
    await expect(row1.locator(`[data-admin-scope-current-bundle="${newBundleId}"]`)).toBeVisible();
    const message = row1.locator('[data-admin-message="ok"]');
    await expect(message).toHaveAttribute('data-admin-message-code', 'ASSIGNED');
    await expect(message).toContainText('다른 병원은 바뀌지 않았습니다');
    // 병원 2 줄은 그대로다.
    await expect(row2).toHaveAttribute('data-admin-scope-current', baseId);
    await expect(row2.locator(`[data-admin-scope-current-bundle="${baseId}"]`)).toBeVisible();
    await expect(page.locator(`button[data-admin-scope-confirm="${CLINIC_2}"]`)).toBeDisabled();
    await shoot(page, 'bundle-5-po-assigned');
    note(`지정(po-1, 화면): 요청 본문 ${JSON.stringify(response.request().postDataJSON())} → 200, 병원 1 줄 현재 적용본=${newBundleId}, 병원 2 줄 현재 적용본=${baseId}(그대로)`);

    // 서버에서도 병원 1 만 바뀌었다.
    const scope = await scopeOverview(po);
    expect((scope['clinics'] as Json[]).map((clinic) => [clinic['clinicId'], (clinic['current'] as Json)['bundleId']])).toEqual([
      [CLINIC_1, newBundleId],
      [CLINIC_2, baseId],
    ]);
  } finally {
    await closeAll(po);
  }
});

test('S5 지정 뒤: 병원 1 의 보험 선택지가 새 묶음을 가리키고 치료 C 가 보류에서 계산으로 바뀐다. 병원 2 는 글자 그대로 같다. 이전 묶음을 본 요청은 병원 1 에서만 409 VERSION_MISMATCH 다. 감사 기록에는 CLINIC_SCOPE_ASSIGN 한 건이 더해진다', async ({ browser }) => {
  const roles = await sessions(browser);
  try {
    const request = roles.ha.context.request;
    const after = await snapshotAll(roles.ha);

    // 병원 1: 보험 선택지의 묶음 id 가 새 묶음이다.
    expect(after.c1.options.body['ruleBundleVersion']).toBe(newBundleId);
    expect(after.c1.options.body['ruleBundleStatus']).toBe('ACTIVE');
    expect(after.c1.options.text).not.toBe(before.c1.options.text);
    expect(after.c1.catalog.text).toBe(before.c1.catalog.text);
    // 치료 C: 보류(MAPPING_ABSENT) → 계산(ESTIMATED).
    expect(after.c1.estimate.status).toBe(200);
    const lineC = lineOf(after.c1.estimate, TREATMENT_C);
    expect(lineC['state']).toBe('ESTIMATED');
    expect(lineC['holdReason']).toBeUndefined();
    expect((after.c1.estimate.body['versions'] as Json)['ruleBundleVersion']).toBe(newBundleId);
    expect((after.c1.estimate.body['result'] as Json)['state']).toBe('ESTIMATED');
    // 치료 A·B 는 여전히 정상이다(새 묶음은 기준 묶음의 항목을 모두 담는다).
    expect(lineOf(after.ab1.estimate, TREATMENT_A).state).toBe('ESTIMATED');
    expect(lineOf(after.ab1.estimate, TREATMENT_B).state).toBe('ESTIMATED');
    note(`AFTER 병원 1 보험 선택지: ruleBundleVersion=${String(after.c1.options.body['ruleBundleVersion'])} (BEFORE ${String(before.c1.options.body['ruleBundleVersion'])})`);
    note(`AFTER 병원 1 계산 [치료 C] → state=${String((after.c1.estimate.body['result'] as Json)['state'])}, C 줄=${JSON.stringify(lineC)}, amounts=${JSON.stringify((after.c1.estimate.body['result'] as Json)['amounts'])}`);

    // 병원 2: 카탈로그 · 보험 선택지 · 계산이 지정 전 응답과 글자 그대로 같다.
    expectSamePublic(after.c2, before.c2, '지정 뒤 병원 2');
    note('AFTER 병원 2: 카탈로그·보험 선택지·계산 응답이 BEFORE 와 글자 그대로 같다');

    // 이전 묶음(기준 묶음)을 본 요청: 병원 1 은 409, 병원 2 는 그대로 통한다.
    const catalogVersion1 = after.c1.catalog.body['catalogVersion'] as string;
    const stale = await estimateWith(request, SLUG_1, catalogVersion1, baseId, [TREATMENT_C]);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: 'VERSION_MISMATCH', latest: { ruleBundleVersion: newBundleId, ruleBundleStatus: 'ACTIVE' }, changes: { ruleChanged: true } });
    const catalogVersion2 = after.c2.catalog.body['catalogVersion'] as string;
    const sameForTwo = await estimateWith(request, SLUG_2, catalogVersion2, baseId, [OTHER_TREATMENT]);
    expect(sameForTwo.status).toBe(200);
    expect(sameForTwo.text).toBe(before.c2.estimate.text);
    note(`병원 1 에 기준 묶음 id 로 계산 요청 → ${String(stale.status)} ${excerpt(stale.text, 400)}`);
    note('병원 2 에 같은 기준 묶음 id 로 계산 요청 → 200, 본문이 BEFORE 와 글자 그대로 같다');

    // 감사 기록: 게시 한 건 + 지정 한 건, 그 밖의 변화 없음.
    const added = (await auditLog(request)).slice(auditBaseline);
    expect(added.map((entry) => entry['action'])).toEqual(['ITEM_PUBLISH', 'BUNDLE_PUBLISH', 'CLINIC_SCOPE_ASSIGN']);
    expect(added.filter((entry) => entry['action'] === 'BUNDLE_PUBLISH')).toHaveLength(1);
    expect(added.filter((entry) => entry['action'] === 'CLINIC_SCOPE_ASSIGN')).toHaveLength(1);
    expect(added[1]).toMatchObject({ target: `BUNDLE/${newBundleId}`, afterVersion: newBundleId, actorId: USERS['rv-2'], role: 'RV' });
    expect(added[2]).toMatchObject({ target: `CLINIC/${CLINIC_1}`, beforeVersion: baseId, afterVersion: newBundleId, actorId: USERS['po-1'], role: 'PO' });
    expect(added.filter((entry) => String(entry['target']).startsWith(`CLINIC/${CLINIC_2}`))).toEqual([]);
    note(`감사 기록 추가분(선행 단계 뒤): ${JSON.stringify(added.map((entry) => ({ action: entry['action'], target: entry['target'], before: entry['beforeVersion'], after: entry['afterVersion'], actor: entry['actorId'], role: entry['role'] })))}`);

    // 저장소: 선행 직후와 비교하면 게시(묶음·가용성·항목 상태)와 지정(범위 이력)과 감사만 달라졌다.
    const now = JSON.parse(await stateText(request)) as Record<string, unknown>;
    const old = JSON.parse(stateAfterApproval) as Record<string, unknown>;
    expect(Object.keys(now).filter((key) => JSON.stringify(now[key]) !== JSON.stringify(old[key])).sort()).toEqual(['auditLog', 'bundleConfirmations', 'bundleEvents', 'bundles', 'itemStates', 'scopeHistory']);
  } finally {
    await closeAll(roles.ha, roles.rv1, roles.rv2);
  }
});

test('S6 키오스크 화면(병원 1): 지정 뒤 치료 C 를 고르면 정상 결과가 나온다. 병원 2 의 키오스크 선택지는 그대로다', async ({ browser }) => {
  const outcome = await kioskCalculate(browser, SLUG_1, C_PATTERN, 'bundle-6-kiosk-result-c');
  expect(outcome.state).toBe('ESTIMATED');
  expect(outcome.kind).toBe('normal');
  const amounts = (outcome.body['result'] as Json)['amounts'] as Json;
  // 화면의 병원 결제액 글자가 서버가 계산한 값과 같다(치료 C 11,000원 + 공통 기본비용 5,000원).
  expect(outcome.hospitalPaymentText).toBe(`${(amounts['hospitalPayment'] as number).toLocaleString('en-US')}원`);
  expect(amounts['hospitalPayment']).toBe(16_000);
  expect((outcome.body['versions'] as Json)['ruleBundleVersion']).toBe(newBundleId);
  note(`키오스크 병원 1 (지정 뒤): 치료 C → 화면 data-result=${String(outcome.kind)}, 병원 결제액 글자=${String(outcome.hospitalPaymentText)}, 서버 state=${outcome.state}, 계산에 쓴 묶음=${newBundleId}`);

  // 병원 2 키오스크: 선택지와 계산은 지정 전과 같다(병원 2 에는 치료 C 가 없다).
  const other = await kioskCalculate(browser, SLUG_2, /병원2 치료/);
  expect(other.state).toBe((before.c2.estimate.body['result'] as Json)['state']);
  expect((other.body['versions'] as Json)['ruleBundleVersion']).toBe(baseId);
  note(`키오스크 병원 2: 계산에 쓴 묶음=${baseId}(그대로), state=${other.state}`);
});
