import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBundleContentCache } from '../src/server/api/bundle-content-cache';
import type { ServerLog } from '../src/server/api/log';
import type { AcceptedOrigins, ApiServices } from '../src/server/api/services';
import type { Repository } from '../src/server/repo/interfaces';
import { MemoryRepository } from '../src/server/repo/memory/memory-repository';
import { readOnly } from './readonly-repo';

// 베타 세계 (런타임). 합성 세계(TEST_FIXTURE)를 미리 만들어 굳힌 스냅샷(beta/data/world-snapshot.json)을 읽어 읽기 전용 저장소로 쓴다.
//  - 런타임은 세계를 만드는 서비스(게시·승인)도, tests/ 의 자료 빌더도 가져오지 않는다. 다만 공개 API 핸들러가 읽기 함수를 쓰려고 가져오는 파일(idle-policy·rule-scope·audit)에는
//    쓰기 함수도 함께 들어 있어 "쓰기 코드가 전혀 없다"고는 말할 수 없다. 그 함수를 부르는 길은 없고(요청 처리기 허용 목록), 불러도 저장소가 읽기 전용이라 던진다.
//  - 스냅샷은 개발 브랜치(feature/pilot-private-kiosk-beta)의 beta/tools/make-snapshot.ts 가 V0 의 합성 세계(validation/world.ts)에서 만든다(이 배포 브랜치에는 없다). 병원 1·2 의 시나리오는 아래 BETA_SCENARIOS 다.
//  - 허용 출처는 규칙·줄 모두 TEST_FIXTURE 하나(V0 검증 구성과 같은 값): 합성이 아닌 출처의 자료는 이 서버에서 정상 계산이 되지 않는다.

export const BETA_ACCEPTED_ORIGINS: AcceptedOrigins = Object.freeze({
  rules: Object.freeze(['TEST_FIXTURE'] as const),
  lines: Object.freeze(['TEST_FIXTURE'] as const),
});

export interface BetaScenario {
  slug: string;
  title: string;
  description: string;
  /** 검증이 기대하는 계산 상태. */
  expectedState: 'ESTIMATED' | 'ON_HOLD';
}

/** 검토자에게 보이는 두 시나리오. 이 밖의 병원 주소는 서버가 거절한다. */
export const BETA_SCENARIOS: readonly BetaScenario[] = Object.freeze([
  {
    slug: 'bodam-clinic-1',
    title: '시나리오 1 · 정상 계산',
    description: '4세대 · 손해보험사 · 합성 치료 1개를 고르면 예상 금액과 근거, 서류가 나옵니다.',
    expectedState: 'ESTIMATED',
  },
  {
    slug: 'bodam-clinic-2',
    title: '시나리오 2 · 산출 보류',
    description: '규칙 사용 범위가 없는 병원입니다. 같은 순서로 고르면 금액 대신 "산출 보류" 안내가 나옵니다.',
    expectedState: 'ON_HOLD',
  },
]);

export const SNAPSHOT_PATH = fileURLToPath(new URL('./data/world-snapshot.json', import.meta.url));

/** 스냅샷 파일 본문을 읽어 읽기 전용 저장소를 만든다. 본문이 저장소 상태로 복원되지 않으면 던진다. */
export function repositoryFromSnapshot(text: string): Repository {
  return readOnly(new MemoryRepository(JSON.parse(text) as unknown));
}

export function loadBetaRepository(path: string = SNAPSHOT_PATH): Repository {
  return repositoryFromSnapshot(readFileSync(path, 'utf8'));
}

export interface BetaServicesDeps {
  repo: Repository;
  log: ServerLog;
  today: () => string;
}

export function createBetaServices(deps: BetaServicesDeps): ApiServices {
  return Object.freeze({ repo: deps.repo, log: deps.log, acceptedOrigins: BETA_ACCEPTED_ORIGINS, today: deps.today, bundleCache: createBundleContentCache() });
}
