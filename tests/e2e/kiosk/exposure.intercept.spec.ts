import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import { mockClinicApi, reply } from '../helpers/api';
import type { ApiMock } from '../helpers/api';
import { estimatedResponse, holdResponse, notCoveredResponse, singleCauseDocuments } from '../../fixtures/kiosk/estimate-response.fixture';
import { installMarkerIds } from '../helpers/ids';
import { KIOSK_PATH, expectStartScreen } from '../helpers/kiosk';
import { TREATMENT_ID, actionsOf, networkError, resultRoot, submitEstimate, toFilledK03 } from '../helpers/results';
import { completeScreen, normalWith, openBasis, openDocuments, reachResult, sheetBack, sheetComplete } from '../helpers/sheets';
import { dumpStorage } from '../helpers/storage';
import { expectDomClean, expectEmptyDump, verifyExposure, watchExposure, writeEvidence } from '../helpers/exposure';

// 가로채기 층 (S4 C, AC-016a·b·m·k·l 의 브라우저 쪽): 시작 → 결과 → 근거 → 서류 → 이용 완료 → 시작의 전체 흐름(정상·보장 제외·보류·오류·오류 뒤 재시도)을 표지 식별자 발급기로 돌리고,
// 영속 저장소 전체 덤프(전·중·후)가 같고 비어 있으며, 주소·머리글·콘솔·DOM·바깥으로 나간 요청 어디에도 환자 선택·결과 값·식별자가 없음을 본다.
// 모든 덤프·요청 목록·콘솔은 환경 변수 KIOSK_E2E_EVIDENCE_DIR 이 있을 때만 그 폴더의 exposure/ 에 원본으로 남는다(없으면 아무것도 쓰지 않는다). 이것은 가로챈 응답으로 화면을 시험한 것이다(운영 자료·실제 핸들러가 아니다).

interface Variant {
  readonly name: string;
  /** 시작 화면에서 출발해 시작 화면으로 돌아온다. `mid` 는 결과·오류 화면에 있을 때 부른다(중간 덤프). */
  readonly run: (page: Page, api: ApiMock, mid: () => Promise<void>) => Promise<void>;
}

async function finishToStart(page: Page): Promise<void> {
  await expect(completeScreen(page)).toBeVisible();
  await page.getByRole('button', { name: '처음 화면으로' }).click();
  await expectStartScreen(page);
}

const VARIANTS: readonly Variant[] = [
  {
    name: 'normal',
    run: async (page, api, mid) => {
      await reachResult(page, api, normalWith(singleCauseDocuments()));
      await mid();
      await openBasis(page);
      await sheetBack(page).click();
      await openDocuments(page, 'documents');
      await sheetComplete(page).click();
      await finishToStart(page);
    },
  },
  {
    name: 'excluded',
    run: async (page, api, mid) => {
      await reachResult(page, api, notCoveredResponse({ documents: singleCauseDocuments() }));
      await mid();
      await openBasis(page);
      await sheetBack(page).click();
      await openDocuments(page, 'documents');
      await sheetComplete(page).click();
      await finishToStart(page);
    },
  },
  {
    name: 'hold',
    run: async (page, api, mid) => {
      await reachResult(
        page,
        api,
        holdResponse([
          [TREATMENT_ID.xray, 'MAPPING_ABSENT'],
          [TREATMENT_ID.ultrasound, 'PROFILE_VALUE_MISSING'],
        ]),
      );
      await mid();
      await actionsOf(page).filter({ hasText: '이용 완료' }).click();
      await finishToStart(page);
    },
  },
  {
    name: 'error',
    run: async (page, api, mid) => {
      await toFilledK03(page);
      await submitEstimate(page, api, reply(500, { error: 'INTERNAL_ERROR' }));
      await expect(networkError(page)).toBeVisible();
      await mid();
      await page.getByRole('button', { name: '이용 종료' }).click();
      await finishToStart(page);
    },
  },
  {
    // 오류 → 다시 시도(새 계산 시도 식별자) → 결과: 시도마다 식별자가 새로 만들어져도 메모리 밖으로 나가지 않는다.
    name: 'retry-after-error',
    run: async (page, api, mid) => {
      await toFilledK03(page);
      await submitEstimate(page, api, reply(500, { error: 'INTERNAL_ERROR' }));
      await expect(networkError(page)).toBeVisible();
      api.queue('estimate', reply(200, estimatedResponse()));
      await page.getByRole('button', { name: '다시 시도' }).click();
      await expect(resultRoot(page)).toBeVisible();
      await mid();
      await actionsOf(page).filter({ hasText: '이용 완료' }).click();
      await finishToStart(page);
    },
  },
];

for (const variant of VARIANTS) {
  test(`${variant.name}: 시작에서 이용 완료·다시 시작까지 저장소 덤프(전·중·후)가 같고 비어 있으며 주소·콘솔·요청·DOM 에 환자 값과 식별자가 없다`, async ({ page }, testInfo) => {
    await installMarkerIds(page);
    const exposure = await watchExposure(page);
    const tag = `intercept-${testInfo.project.name.replace('intercept-', '')}-${variant.name}`;
    const api = await mockClinicApi(page);
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    const before = await dumpStorage(page);

    let during: Awaited<ReturnType<typeof dumpStorage>> | null = null;
    await variant.run(page, api, async () => {
      during = await dumpStorage(page);
      await expectDomClean(page, `${tag} 중간(결과·오류 화면)`);
    });
    const after = await dumpStorage(page);
    await expectDomClean(page, `${tag} 끝(시작 화면)`);
    const verdict = await verifyExposure(page, exposure, new URL(page.url()).origin, tag);

    expect(during, `${tag}: 중간 덤프를 찍지 못했다`).not.toBeNull();
    expectEmptyDump(before, `${tag} 전`);
    expectEmptyDump(during as unknown as typeof before, `${tag} 중간`);
    expectEmptyDump(after, `${tag} 후`);
    expect(during).toEqual(before);
    expect(after).toEqual(before);

    writeEvidence(`${tag}.json`, {
      storage: { before, during, after },
      verdict,
      requests: exposure.requests.map(({ method, url, resourceType }) => ({ method, url, resourceType })),
      console: exposure.console,
    });
  });
}
