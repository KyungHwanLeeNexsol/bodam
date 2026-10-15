import { buildCorpus, serializeOutcome } from './corpus.fixture';

// 새 프로세스 시험(determinism.test.ts)이 `node --import ts-resolve-register.mjs child-run.ts <시간대>` 로 띄우는 자식 프로세스.
// 시간대를 인자로 받아 맨 먼저 바꾸고(엔진 호출 전), 같은 입력 묶음을 계산해 직렬화 결과를 표준 출력에 한 번 쓴다.
// 부모 프로세스가 같은 입력으로 만든 직렬화 결과와 바이트 단위로 비교한다.

const zone = process.argv[2] ?? 'UTC';
process.env.TZ = zone;

const serialized: Record<string, string> = {};
for (const entry of buildCorpus()) {
  serialized[entry.name] = serializeOutcome(entry.input);
}

process.stdout.write(
  JSON.stringify({
    pid: process.pid,
    requested: zone,
    offsets: [new Date(2026, 0, 1).getTimezoneOffset(), new Date(2026, 6, 1).getTimezoneOffset()],
    serialized,
  }),
);
