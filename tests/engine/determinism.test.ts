import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EstimateInput } from '../../src/engine/types';
import { buildCorpus, serializeOutcome } from '../fixtures/engine/corpus.fixture';

// AC-001a 결정성: 같은 EstimateInput(같은 버전·같은 주입 시각)을 여러 번, 그리고 새 프로세스에서 다시 실행해도
// 직렬화한 결과가 바이트 단위로 같다. 같은 의미의 입력에서 배열 순서만 바꿔도 같다(전체 순열 시험은 order-independence.test.ts, AC-008k).
// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다.

const SEED = 20261015; // 고정 시드. 아래 시행 수와 함께 시험 제목에 기록한다.
const REPEATS = 25;
const SHUFFLE_TRIALS = 20;

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CORPUS = buildCorpus();
const BASELINE = new Map(CORPUS.map((entry) => [entry.name, serializeOutcome(entry.input)]));

function baselineOf(name: string): string {
  const text = BASELINE.get(name);
  if (text === undefined) throw new Error(`기준 결과가 없다: ${name}`);
  return text;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let state = seed >>> 0;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('입력 묶음 확인 (빈 시험 방지)', () => {
  it('상태 종류를 고루 담고 있고 서로 다른 결과를 낸다', () => {
    const parsed = CORPUS.map((entry) => JSON.parse(baselineOf(entry.name)) as { ok: boolean; result?: { state: string; referenceGroups?: unknown[]; groups: Array<{ P: number | null; P_pooled: number | null; holdReason?: string | null }> }; rejection?: unknown });
    const states = new Set(parsed.filter((outcome) => outcome.ok).map((outcome) => outcome.result?.state));
    expect(states).toEqual(new Set(['ESTIMATED', 'ESTIMATED_WITH_EXCLUSIONS', 'ON_HOLD']));
    expect(parsed.filter((outcome) => !outcome.ok).length).toBeGreaterThanOrEqual(2);
    expect(parsed.some((outcome) => (outcome.result?.referenceGroups?.length ?? 0) > 0)).toBe(true);
    expect(parsed.some((outcome) => outcome.result?.groups.some((entry) => entry.P !== null && entry.P_pooled !== null && entry.P_pooled < entry.P))).toBe(true);
    expect(CORPUS.some((entry) => baselineOf(entry.name).includes('CALC_RANGE_EXCEEDED'))).toBe(true);
    expect(new Set(BASELINE.values()).size).toBe(CORPUS.length);
  });

  it('직렬화 결과에는 undefined·소수·NaN·-0 이 없다 (모든 숫자는 안전 정수)', () => {
    const visit = (value: unknown, path: string): void => {
      if (typeof value === 'number') {
        expect(Number.isSafeInteger(value) && !Object.is(value, -0), `${path} = ${value}`).toBe(true);
      } else if (Array.isArray(value)) {
        value.forEach((child, index) => visit(child, `${path}[${index}]`));
      } else if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
      }
    };
    for (const entry of CORPUS) {
      const text = baselineOf(entry.name);
      visit(JSON.parse(text), entry.name);
      // 값 -> 문자열 -> 값 -> 문자열이 같다: 직렬화가 정보를 잃거나 바꾸지 않는다.
      expect(JSON.stringify(JSON.parse(text))).toBe(text);
    }
  });
});

describe(`AC-001a 같은 프로세스에서 반복 실행 (${REPEATS}회)`, () => {
  it('같은 입력은 매번 바이트 단위로 같은 결과를 낸다', () => {
    for (const entry of CORPUS) {
      for (let run = 0; run < REPEATS; run += 1) {
        expect(serializeOutcome(entry.input), `${entry.name} #${run}`).toBe(baselineOf(entry.name));
      }
    }
  });

  it('호출 순서·이전 호출과 무관하다: 정방향·역방향·섞은 순서로 돌려도 입력별 결과가 같다', () => {
    const order = CORPUS.map((_entry, index) => index);
    for (const sequence of [order, [...order].reverse(), seededShuffle(order, SEED)]) {
      for (const index of sequence) {
        const entry = CORPUS[index];
        if (entry === undefined) throw new Error('입력 묶음 인덱스 오류');
        expect(serializeOutcome(entry.input), entry.name).toBe(baselineOf(entry.name));
      }
    }
  });

  it('입력을 바꾸지 않는다: 깊게 얼린 입력을 줘도 같은 결과가 나오고 계산 뒤 입력이 그대로다', () => {
    for (const entry of CORPUS) {
      const before = structuredClone(entry.input);
      const frozen = deepFreeze(structuredClone(entry.input));
      expect(serializeOutcome(frozen), `${entry.name} (얼린 입력)`).toBe(baselineOf(entry.name));
      expect(serializeOutcome(entry.input)).toBe(baselineOf(entry.name));
      expect(entry.input, `${entry.name} (계산 뒤 입력)`).toEqual(before);
    }
  });

  it('입력 객체의 정체성과 무관하다: 복제한 입력도 같은 결과를 낸다', () => {
    for (const entry of CORPUS) {
      expect(serializeOutcome(structuredClone(entry.input)), entry.name).toBe(baselineOf(entry.name));
    }
  });
});

describe('시계·난수와 무관하다 (AC-001b 의 동작 증거)', () => {
  it('Date.now·Math.random·performance.now 를 한 번도 부르지 않는다', () => {
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('엔진이 Date.now 를 불렀다');
    });
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('엔진이 Math.random 을 불렀다');
    });
    const perfNow = vi.spyOn(performance, 'now').mockImplementation(() => {
      throw new Error('엔진이 performance.now 를 불렀다');
    });
    const results = new Map<string, string>();
    try {
      for (const entry of CORPUS) results.set(entry.name, serializeOutcome(entry.input));
    } finally {
      const calls = [dateNow.mock.calls.length, random.mock.calls.length, perfNow.mock.calls.length];
      vi.restoreAllMocks();
      expect(calls).toEqual([0, 0, 0]);
    }
    for (const entry of CORPUS) expect(results.get(entry.name), entry.name).toBe(baselineOf(entry.name));
  });

  it('시스템 시각이 크게 달라도 결과가 같다 (인자 없는 new Date() 같은 숨은 시계가 없다)', () => {
    vi.useFakeTimers();
    for (const instant of ['2000-01-01T00:00:00Z', '2026-10-15T09:30:00Z', '2099-12-31T23:59:59Z']) {
      vi.setSystemTime(new Date(instant));
      for (const entry of CORPUS) {
        expect(serializeOutcome(entry.input), `${entry.name} @ ${instant}`).toBe(baselineOf(entry.name));
      }
    }
  });

  it('시간은 입력 at 으로만 들어온다: at 이 유효 기간 안이면 계산하고 밖이면 보류하며, 어느 쪽이든 반복해도 같다', () => {
    const entry = CORPUS[0];
    if (entry === undefined) throw new Error('입력 묶음이 비어 있다');
    const outcomeAt = (at: string): string => serializeOutcome({ ...entry.input, at });
    const inside = outcomeAt('2026-06-15');
    const insideAgain = outcomeAt('2026-06-15');
    const outside = outcomeAt('2027-06-01');
    expect(insideAgain).toBe(inside);
    expect(outcomeAt('2027-06-01')).toBe(outside);
    expect(inside).not.toBe(outside);
    expect((JSON.parse(inside) as { result: { state: string } }).result.state).toBe('ESTIMATED');
    expect((JSON.parse(outside) as { result: { state: string } }).result.state).toBe('ON_HOLD');
    // 같은 날짜를 가리키는 입력에서 현재 시각(가짜 시계)은 아무 영향이 없다.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    expect(outcomeAt('2026-06-15')).toBe(inside);
  });
});

describe(`배열 순서만 바꾼 입력도 바이트 단위로 같다 (시드 ${SEED}, 시행 ${SHUFFLE_TRIALS})`, () => {
  it('매핑·줄·기본비용 줄·치료 ID 배열을 섞어도 같다', () => {
    for (const entry of CORPUS) {
      for (let trial = 0; trial < SHUFFLE_TRIALS; trial += 1) {
        const input: EstimateInput = {
          ...entry.input,
          lines: seededShuffle(entry.input.lines, SEED + trial),
          baseFeeLines: seededShuffle(entry.input.baseFeeLines, SEED * 2 + trial),
          treatmentIds: seededShuffle(entry.input.treatmentIds, SEED * 3 + trial),
          bundle: entry.input.bundle === null ? null : { ...entry.input.bundle, mappings: seededShuffle(entry.input.bundle.mappings, SEED * 5 + trial) },
        };
        expect(serializeOutcome(input), `${entry.name} #${trial}`).toBe(baselineOf(entry.name));
      }
    }
  });
});

describe('AC-001a 새 프로세스에서 다시 실행 (자식 Node 프로세스, 시간대 4가지)', () => {
  // 자식 프로세스는 동기 실행(spawnSync)이며 시간 제한이 지나면 강제 종료된다. 백그라운드 부하나 남는 프로세스가 없다.
  const REGISTER_URL = pathToFileURL(fileURLToPath(new URL('../fixtures/engine/ts-resolve-register.mjs', import.meta.url))).href;
  const CHILD_PATH = fileURLToPath(new URL('../fixtures/engine/child-run.ts', import.meta.url));
  const ZONES: Array<[string, [number, number]]> = [
    ['UTC', [0, 0]],
    ['Asia/Seoul', [-540, -540]],
    ['America/Los_Angeles', [480, 420]],
    ['Pacific/Auckland', [-780, -720]],
  ];

  interface ChildReport {
    pid: number;
    requested: string;
    offsets: [number, number];
    serialized: Record<string, string>;
  }

  function runChild(zone: string): ChildReport {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: '1' };
    delete env.NODE_OPTIONS;
    delete env.TZ;
    const result = spawnSync(process.execPath, ['--import', REGISTER_URL, CHILD_PATH, zone], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
      timeout: 90_000,
      killSignal: 'SIGKILL',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(result.error, `자식 프로세스 오류 (${zone})`).toBeUndefined();
    expect(result.signal, `자식 프로세스 종료 신호 (${zone})`).toBeNull();
    expect(result.status, `자식 프로세스 종료 코드 (${zone}), stderr: ${result.stderr.slice(0, 600)}`).toBe(0);
    return JSON.parse(result.stdout) as ChildReport;
  }

  it.each(ZONES)('%s: 부모와 다른 프로세스가 같은 입력으로 만든 직렬화 결과가 부모의 결과와 바이트 단위로 같다', (zone, expectedOffsets) => {
    const report = runChild(zone);
    expect(report.pid).not.toBe(process.pid);
    expect(report.requested).toBe(zone);
    // 시간대가 실제로 바뀌었는지 확인한다. 바뀌지 않았다면 이 시험은 시간대 독립성의 증거가 아니다.
    expect(report.offsets).toEqual(expectedOffsets);
    expect(Object.keys(report.serialized).sort()).toEqual([...BASELINE.keys()].sort());
    for (const [name, text] of Object.entries(report.serialized)) {
      expect(text, `${name} @ ${zone}`).toBe(baselineOf(name));
    }
  }, 120_000);
});
