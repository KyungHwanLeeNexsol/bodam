import { expect, test } from '../helpers/test';
import type { Locator, Page } from '@playwright/test';
import { mockClinicApi } from '../helpers/api';
import { MARKER_PREFIX, findUuids, installMarkerIds } from '../helpers/ids';
import { dumpStorage } from '../helpers/storage';
import { KIOSK_PATH, dialog, expectK01, expectStartScreen, generationRadio, startButton, underlayHome } from '../helpers/kiosk';

// 가로채기 층 (BRIEF D13, AC-016a·AC-016m 의 시작 단계 몫): 시작부터 선택·확인창·초기화까지 진행한 뒤 영속 저장소 전체 덤프가 흐름 전과 같고, 표지 식별자가 어디에도 없다.
// 덤프 대상: localStorage·sessionStorage·IndexedDB(모든 데이터베이스)·쿠키(document.cookie 와 브라우저 쿠키 저장소)·Cache Storage·서비스워커 등록.
// 계산 요청·갱신이 오가는 전체 흐름(AC-016m 의 나머지)은 해당 화면이 생기는 S2·S3·S4 에서 같은 도구로 닫는다.

const generation = (page: Page): Locator => generationRadio(page);
const homeButton = (page: Page): Locator => underlayHome(page);

async function flow(page: Page): Promise<void> {
  await startButton(page).click();
  await expectK01(page);
  await generation(page).check();
  await page.getByRole('button', { name: '큰 글자 보기' }).click();
  await homeButton(page).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: '계속 이용' }).click();
  await homeButton(page).click();
  await dialog(page).getByRole('button', { name: '처음으로' }).click();
  await expectStartScreen(page);
}

test.describe('영속 저장소 (AC-016a·AC-016m)', () => {
  test('표지 식별자 발급기: 흐름 전후 덤프가 같고 덤프·주소·문서 어디에도 표지 값이 없다. 식별자는 메모리 안에서만 쓰였다', async ({ page }) => {
    await installMarkerIds(page);
    await mockClinicApi(page);
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);

    // 대조군: 발급기가 실제로 쓰였다 (세션 식별자가 발급기에서 나온다). 시작하기는 새 세션을 만들어 발급기를 부른다.
    const used = await page.evaluate(() => crypto.randomUUID());
    expect(used).toMatch(new RegExp(`^${MARKER_PREFIX}-\\d{4}$`));

    const before = await dumpStorage(page);
    await flow(page);
    const after = await dumpStorage(page);

    expect(after).toEqual(before);
    expect(before.localStorage).toEqual({});
    expect(before.sessionStorage).toEqual({});
    expect(before.indexedDb).toEqual({});
    expect(before.cacheStorage).toEqual({});
    expect(before.serviceWorkers).toEqual([]);
    expect(before.cookie).toBe('');
    expect(before.contextCookies).toEqual([]);
    expect(JSON.stringify(after)).not.toContain(MARKER_PREFIX);
    expect(page.url()).not.toContain(MARKER_PREFIX);
    expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain('ID-TEST');
    // 표지 값이 요청 어디에도 가지 않았다: 병원 자료 GET 두 건이 전부이고 주소에 식별자가 없다.
    const url = new URL(page.url());
    expect(url.pathname).toBe(KIOSK_PATH);
    expect(url.search + url.hash).toBe('');
  });

  test('실제 발급기(crypto.randomUUID)로도 같은 흐름 뒤 저장소 덤프에 UUID 형식 문자열이 새로 생기지 않는다', async ({ page }) => {
    const api = await mockClinicApi(page);
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    const before = await dumpStorage(page);
    await flow(page);
    const after = await dumpStorage(page);
    expect(after).toEqual(before);
    expect(findUuids(JSON.stringify(after))).toEqual([]);
    expect(findUuids(page.url())).toEqual([]);
    for (const call of api.calls) expect(findUuids(call.url + JSON.stringify(call.headers) + (call.postData ?? ''))).toEqual([]);
  });

  test('저장소 쓰기 감시: 흐름 동안 localStorage·sessionStorage·document.cookie·indexedDB·caches·serviceWorker 에 쓰려는 호출이 한 번도 없다', async ({ page }) => {
    await page.addInitScript(() => {
      const writes: string[] = [];
      (window as unknown as { __writes: string[] }).__writes = writes;
      for (const name of ['setItem', 'removeItem', 'clear'] as const) {
        const original = Storage.prototype[name] as (...args: unknown[]) => unknown;
        Storage.prototype[name] = function (this: Storage, ...args: unknown[]) {
          writes.push(`Storage.${name}`);
          return original.apply(this, args);
        } as never;
      }
      const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
      if (cookie?.set !== undefined) {
        Object.defineProperty(document, 'cookie', {
          configurable: true,
          get: () => cookie.get?.call(document) as string,
          set: (value: string) => {
            writes.push('document.cookie');
            cookie.set?.call(document, value);
          },
        });
      }
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = ((...args: Parameters<IDBFactory['open']>) => {
        writes.push('indexedDB.open');
        return open(...args);
      }) as IDBFactory['open'];
      const cachesOpen = caches.open.bind(caches);
      caches.open = ((name: string) => {
        writes.push('caches.open');
        return cachesOpen(name);
      }) as CacheStorage['open'];
      const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = ((...args: Parameters<ServiceWorkerContainer['register']>) => {
        writes.push('serviceWorker.register');
        return register(...args);
      }) as ServiceWorkerContainer['register'];
    });
    await mockClinicApi(page);
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    await flow(page);
    expect(await page.evaluate(() => (window as unknown as { __writes: string[] }).__writes)).toEqual([]);
  });
});
