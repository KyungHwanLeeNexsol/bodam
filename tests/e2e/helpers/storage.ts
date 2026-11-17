import type { Page } from '@playwright/test';

// 시험 자료(TEST_FIXTURE). 브라우저 시험의 저장소 덤프 도구 (BRIEF D13, AC-016a·AC-016m). 환자 상태가 어떤 영속 저장소에도 남지 않음을 흐름 전후의 전체 덤프로 비교한다.
// 덤프 대상: localStorage·sessionStorage·IndexedDB(모든 데이터베이스와 저장소의 전체 내용)·document.cookie·브라우저 쿠키 저장소·Cache Storage(이름과 항목 주소)·서비스워커 등록.

export interface StorageDump {
  readonly localStorage: Record<string, string>;
  readonly sessionStorage: Record<string, string>;
  readonly cookie: string;
  readonly contextCookies: readonly unknown[];
  readonly indexedDb: Record<string, Record<string, unknown[]>>;
  readonly cacheStorage: Record<string, string[]>;
  readonly serviceWorkers: readonly string[];
}

export async function dumpStorage(page: Page): Promise<StorageDump> {
  const inPage = await page.evaluate(async () => {
    const entries = (storage: Storage): Record<string, string> => Object.fromEntries(Object.keys(storage).map((key) => [key, storage.getItem(key) ?? '']));

    const indexedDb: Record<string, Record<string, unknown[]>> = {};
    for (const info of await indexedDB.databases()) {
      if (info.name === undefined) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(info.name as string);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const stores: Record<string, unknown[]> = {};
      for (const name of Array.from(db.objectStoreNames)) {
        stores[name] = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(name, 'readonly').objectStore(name).getAll();
          request.onsuccess = () => resolve(request.result as unknown[]);
          request.onerror = () => reject(request.error);
        });
      }
      db.close();
      indexedDb[info.name] = stores;
    }

    const cacheStorage: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      cacheStorage[name] = (await (await caches.open(name)).keys()).map((request) => request.url);
    }

    const registrations = await navigator.serviceWorker.getRegistrations();
    return {
      localStorage: entries(localStorage),
      sessionStorage: entries(sessionStorage),
      cookie: document.cookie,
      indexedDb,
      cacheStorage,
      serviceWorkers: registrations.map((registration) => registration.scope),
    };
  });
  return { ...inPage, contextCookies: await page.context().cookies() };
}
