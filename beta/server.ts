import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { systemToday } from '../src/app/clock';
import { silentLog } from '../src/server/api/log';
import { BetaConfigError, parseConfig } from './config';
import { createGate } from './gate';
import { createBetaHandler } from './handler';
import { runSelfCheck } from './selfcheck';
import { BETA_SCENARIOS, createBetaServices, loadBetaRepository } from './world';

// 베타 서버 (손해사정사 1인용 비공개 키오스크 베타). 사용: 먼저 `npm run beta:build`, 그다음 환경 변수를 정하고 `npm run beta:start`.
//   필수: BODAM_BETA_PUBLIC_ORIGIN · BODAM_BETA_INVITE_TOKENS   선택: BODAM_BETA_HOST · PORT(또는 BODAM_BETA_PORT) · BODAM_BETA_SESSION_HOURS · BODAM_BETA_TODAY
//  - 키오스크 화면은 beta/build.mjs 가 만든 "키오스크 전용" Next 빌드(.beta-build)를 같은 프로세스에서 구동한다(프록시 없음). 관리자 화면·관리자 API·쓰기 API 는 빌드에도 처리기에도 없다.
//  - 계산 API 는 실제 핸들러(handleCatalog·handleOptions·handleEstimate)가 합성 자료(TEST_FIXTURE) 스냅샷 위에서 받는다. 저장소는 읽기 전용이다.
//  - 시작 점검이 두 시나리오(정상 1·보류 1)를 실제 핸들러로 계산해 기대한 상태가 아니면 시작하지 않는다(종료 코드 6).
//  - 종료 코드: 2 설정 오류 · 3 스냅샷 열기 실패 · 4 빌드 없음 · 6 시작 점검 실패.

const BUILD_DIR = fileURLToPath(new URL('../.beta-build', import.meta.url));

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

let config: ReturnType<typeof parseConfig>;
try {
  config = parseConfig(process.env);
} catch (error) {
  fail(`CONFIG_ERROR ${error instanceof BetaConfigError ? error.message : String(error)}`, 2);
}

let repo: ReturnType<typeof loadBetaRepository>;
try {
  repo = loadBetaRepository();
} catch (error) {
  fail(`SNAPSHOT_OPEN_FAILED ${error instanceof Error ? error.message : String(error)}`, 3);
}

const today = config.todayOverride === null ? systemToday : (): string => config.todayOverride as string;
const services = createBetaServices({ repo, log: silentLog, today });

try {
  const entries = await runSelfCheck(services, BETA_SCENARIOS);
  for (const entry of entries) process.stdout.write(`self-check ${entry.slug}: ${entry.state} (기대 ${entry.expected})\n`);
} catch (error) {
  fail(`${error instanceof Error ? error.message : String(error)} (기준일 ${today()})`, 6);
}

if (!existsSync(`${BUILD_DIR}/.next`)) {
  fail('BUILD_MISSING .beta-build/.next 가 없다. 먼저 `npm run beta:build` 를 실행해 달라', 4);
}

// Next 는 NODE_ENV 가 정해진 뒤에 읽어야 해서 동적으로 가져온다.
Object.assign(process.env, { NODE_ENV: 'production' });
const { default: next } = await import('next');
const app = next({ dev: false, dir: BUILD_DIR, hostname: config.host, port: config.port });
await app.prepare();
const nextHandler = app.getRequestHandler();

const gate = createGate({ tokens: config.inviteTokens, ttlMs: config.sessionTtlMs, secure: config.secureCookie, now: () => Date.now() });
const handler = createBetaHandler({
  config,
  now: () => Date.now(),
  gate,
  services,
  scenarios: BETA_SCENARIOS,
  nextHandler: async (request, response) => {
    await nextHandler(request, response);
  },
  log: (line) => process.stdout.write(`${new Date().toISOString()} ${line}\n`),
});

const server = createServer((request, response) => {
  void handler(request, response);
});
// 느린 요청이 연결을 오래 잡지 못하게 한다(요청 본문은 2KiB·64KiB 로 작다).
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(config.port, config.host, () => {
  process.stdout.write(
    [
      `beta kiosk server listening on ${config.host}:${config.port}`,
      `  public origin    : ${config.publicOrigin}`,
      `  invites          : ${config.inviteTokens.length}명 (토큰은 출력하지 않는다) · 세션 ${config.sessionTtlMs / 3_600_000}시간 · 메모리 세션`,
      `  today            : ${today()}`,
      `  expires          : ${config.expiresOn === null ? '기한 없음' : `${config.expiresOn} 한국 시간 23:59:59 까지 (이후 /healthz 말고 모두 410)`}`,
      `  scenarios        : ${BETA_SCENARIOS.map((scenario) => `${scenario.slug}=${scenario.expectedState}`).join(', ')}`,
      `  exposed          : 키오스크 화면 + 공개 계산 API 세 경로 (관리자·자료 쓰기 경로 없음. /beta/enter·/beta/leave 는 세션만 바꾼다)`,
      '',
    ].join('\n'),
  );
});

function stop(): void {
  server.close(() => process.exit(0));
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
