import { handleCatalog } from '../src/server/api/catalog';
import { handleEstimate } from '../src/server/api/estimate';
import { handleOptions } from '../src/server/api/options';
import type { ApiServices } from '../src/server/api/services';
import type { BetaScenario } from './world';

// 시작 점검 (베타). 서버가 열리기 전에 두 시나리오를 실제 공개 API 핸들러로 한 번씩 계산해 기대한 상태가 나오는지 본다.
//  - 정상 시나리오가 ESTIMATED 가 아니거나 보류 시나리오가 ON_HOLD 가 아니면 던진다: 서버는 시작하지 않는다(깨진 베타를 조용히 열지 않는다).
//    가장 흔한 원인은 판정 기준일이 합성 규칙의 유효 기간(2026-01-01 ~ 2026-12-31)을 벗어난 것이다. BODAM_BETA_TODAY 로 기준일을 고정할 수 있다.
//  - 요청은 키오스크가 보내는 것과 같은 여섯 필드다(4세대 · 손해보험사 · 원인 모름 · 병원의 첫 치료). 이 점검은 읽기만 한다.

export interface SelfCheckEntry {
  slug: string;
  expected: BetaScenario['expectedState'];
  state: string;
  ok: boolean;
}

interface CatalogBody {
  catalogVersion: string;
  treatments: Array<{ treatmentId: string }>;
}
interface OptionsBody {
  ruleBundleVersion: string | null;
}
interface EstimateBody {
  result: { state: string };
}

export async function runSelfCheck(services: ApiServices, scenarios: readonly BetaScenario[]): Promise<SelfCheckEntry[]> {
  const entries: SelfCheckEntry[] = [];
  for (const scenario of scenarios) {
    const catalogResponse = await handleCatalog(services, scenario.slug);
    if (catalogResponse.status !== 200) throw new Error(`SELF_CHECK_FAILED ${scenario.slug}: catalog ${catalogResponse.status}`);
    const catalog = (await catalogResponse.json()) as CatalogBody;
    const options = (await (await handleOptions(services, scenario.slug)).json()) as OptionsBody;
    const first = catalog.treatments[0];
    if (first === undefined) throw new Error(`SELF_CHECK_FAILED ${scenario.slug}: 치료가 없다`);
    const estimateResponse = await handleEstimate(services, scenario.slug, () =>
      Promise.resolve({
        catalogVersion: catalog.catalogVersion,
        ruleBundleVersion: options.ruleBundleVersion,
        generation: 'GEN4_C4',
        insurerType: 'NON_LIFE',
        cause: 'UNKNOWN',
        treatmentIds: [first.treatmentId],
      }),
    );
    if (estimateResponse.status !== 200) throw new Error(`SELF_CHECK_FAILED ${scenario.slug}: estimate ${estimateResponse.status}`);
    const state = ((await estimateResponse.json()) as EstimateBody).result.state;
    entries.push({ slug: scenario.slug, expected: scenario.expectedState, state, ok: state === scenario.expectedState });
  }
  const bad = entries.filter((entry) => !entry.ok);
  if (bad.length > 0) {
    throw new Error(`SELF_CHECK_FAILED ${bad.map((entry) => `${entry.slug}: 기대 ${entry.expected} 실제 ${entry.state}`).join('; ')}`);
  }
  return entries;
}
