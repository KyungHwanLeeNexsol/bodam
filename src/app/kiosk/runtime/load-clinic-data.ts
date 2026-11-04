import { timerDelay } from '../state/deps';
import type { KioskDeps } from '../state/deps';
import type { CatalogDto, OptionsDto } from '../state/api-types';
import { parseCatalog, parseOptions } from './parse';

// 키오스크가 처음 켜질 때 병원 자료를 받는 일 (SPEC-REIMBURSEMENT-001 M6, BRIEF D2).
// catalog 와 options 두 GET 을 deps.transport(M5 의 기본 전송: 익명·no-store)로 보내고, 둘 다 200 이고 계약의 모양일 때만 READY 다.
// 이것은 M5 의 자료 갱신 생명주기(state/refresh*.ts)가 아니다: 컨트롤러가 아직 없고 환자 상태도 없다. 그래서 새로 fetch 를 부르지 않고 같은 전송을 다시 쓴다.
// 결과는 다섯 가지뿐이다. 읽을 수 없는 응답·일부만 온 응답을 기본값으로 메우지 않는다.

export type ClinicLoadOutcome =
  | { readonly kind: 'READY'; readonly catalog: CatalogDto; readonly options: OptionsDto }
  /** 병원은 있으나 안내할 치료가 없다(게시한 카탈로그 없음 또는 치료 0개). 시작할 수 없다. */
  | { readonly kind: 'NO_TREATMENTS'; readonly catalog: CatalogDto }
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'FAILED' };

/** 시작 단계의 두 GET 주소. 병원 slug 외에 환자·시도 식별자가 들어갈 길이 없다. */
export function clinicUrls(slug: string): { readonly catalog: string; readonly options: string } {
  const base = `/api/clinics/${encodeURIComponent(slug)}`;
  return { catalog: `${base}/catalog`, options: `${base}/insurance/options` };
}

/** 첫 실패가 곧바로 결말을 정한다(다른 쪽 응답을 기다리지 않는다). */
class Stop extends Error {
  readonly outcome: 'NOT_FOUND' | 'FAILED';

  constructor(outcome: 'NOT_FOUND' | 'FAILED') {
    super(outcome);
    this.outcome = outcome;
  }
}

/**
 * 병원 자료를 받는다. `signal` 이 취소되면(화면이 사라지거나 병원이 바뀜) 전송을 취소하고 FAILED 를 돌려주지만, 호출하는 쪽이 취소한 시도의 결과는 쓰지 않는다.
 * 시간 제한은 deps.refreshTimeoutMs(두 GET 전체)이고 타이머는 deps 의 것이다. 취소 신호를 무시하는 전송이 끝내 응답하지 않아도 시간 제한이 FAILED 로 끝낸다.
 */
export async function loadClinicData(deps: KioskDeps, slug: string, signal: AbortSignal): Promise<ClinicLoadOutcome> {
  const abort = new AbortController();
  const forward = (): void => abort.abort();
  if (signal.aborted) return { kind: 'FAILED' };
  // "." 와 ".." 만으로 된 slug 는 encodeURIComponent 가 그대로 두어 주소 해석기가 다른 경로로 바꾼다: 요청을 만들지 않고 알 수 없는 병원과 같은 결말로 끝낸다.
  if (/^\.+$/.test(slug)) return { kind: 'NOT_FOUND' };
  signal.addEventListener('abort', forward, { once: true });
  const urls = clinicUrls(slug);

  async function get(url: string): Promise<unknown> {
    const response = await deps.transport(url, { method: 'GET', headers: { accept: 'application/json' }, signal: abort.signal });
    if (response.status === 404) throw new Stop('NOT_FOUND');
    if (response.status !== 200) throw new Stop('FAILED');
    return response.json();
  }

  let timer: unknown;
  const expired = new Promise<never>((_, reject) => {
    timer = deps.setTimeout(() => {
      abort.abort();
      reject(new Stop('FAILED'));
    }, timerDelay(deps.refreshTimeoutMs));
  });

  try {
    const [catalogBody, optionsBody] = await Promise.race([Promise.all([get(urls.catalog), get(urls.options)]), expired]);
    const catalog = parseCatalog(catalogBody);
    const options = parseOptions(optionsBody);
    // 응답한 병원이 요청한 병원과 다르면 다른 병원의 가격을 보이게 되므로 쓰지 않는다.
    if (catalog === null || options === null || catalog.clinic.slug !== slug) return { kind: 'FAILED' };
    return catalog.catalogVersion === null || catalog.treatments.length === 0 ? { kind: 'NO_TREATMENTS', catalog } : { kind: 'READY', catalog, options };
  } catch (error) {
    return { kind: error instanceof Stop ? error.outcome : 'FAILED' };
  } finally {
    // 끝나는 순간(성공·실패·시간 제한) 아직 오가는 요청이 있으면 취소한다. 결과는 이미 정해졌고 늦게 오는 응답은 버려진다. 본문은 모두 읽은 뒤라 성공한 결과는 영향이 없다.
    abort.abort();
    deps.clearTimeout(timer);
    signal.removeEventListener('abort', forward);
  }
}
