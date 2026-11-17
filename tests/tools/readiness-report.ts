import { systemToday } from '../../src/app/clock';
import { canonicalDigest } from '../../src/server/digest';
import { operatingReadinessContext, readReadiness } from '../../src/server/readiness';
import type { ReadinessReads } from '../../src/server/readiness';
import { createMemoryRepository } from '../../src/server/repo/memory/memory-repository';
import { buildWorld } from '../fixtures/server/estimate-world.fixture';
import { buildReportView, renderReportText } from './readiness-report-view';
import type { ReportInputKind } from './readiness-report-view';

// 시험 자료(TEST_FIXTURE)를 쓰는 로컬 도구. DD-23 운영 준비 상태 보고를 명령으로 낸다 (SPEC-REIMBURSEMENT-001, pilot-readiness-check.md 의 추천 다음 PR).
// 이 파일은 tests/ 에만 있고 src/ 는 이 파일을 가져오지 않는다: 시험 자료를 가져오므로 src/ 안에 둘 수 없다(tests/boundary/production-no-fixtures.test.ts).
//  - 판정은 src/server/readiness.ts 의 readReadiness 와 operatingReadinessContext 를 그대로 부른다. 판정 함수를 바꾸거나 따로 구현하지 않는다.
//  - 평가 기준은 운영 구성 하나뿐이다: 규칙·줄 모두 허용 출처 OPERATING 만. 다른 허용 출처를 고르는 옵션이 없다.
//  - 입력은 둘로 한정한다: 빈 메모리 저장소(empty), 기존 합성 시험 자료 세계(fixture). 파일·JSON 가져오기, 운영 저장소·DB·네트워크 연결은 없다.
//  - 읽기 전용: 읽기 메서드 열 개만 가진 대리 객체를 넘기고, 실행 전후 저장소 전체 상태의 해시가 같음을 확인한다. 다르면 보고를 내지 않고 실행 오류로 끝낸다.
// 종료 코드: 0 = 보고를 만들었다(보고 내용이 NOT_READY 여도 0이다), 1 = 실행 오류(보고 없음), 2 = 사용법 오류(보고 없음).
// 실행: npm run -s readiness:report -- --input <empty|fixture> [--format text|json] [--at YYYY-MM-DD]

export const USAGE = [
  '사용법: npm run -s readiness:report -- --input <empty|fixture> [--format <text|json>] [--at <YYYY-MM-DD>]',
  '  --input   (필수) empty = 빈 메모리 저장소, fixture = 기존 합성 시험 자료(TEST_FIXTURE) 세계. 이 둘뿐이고 운영 저장소에는 연결하지 않는다',
  '  --format  text(기본) = 사람이 읽는 요약, json = DD-23 의 S·P·M·D 전체와 병원별 계산·서류 판정',
  '  --at      판정 기준일. 생략하면 실행 시점의 한국 표준시(Asia/Seoul) 날짜를 쓰고 보고에 그 사실을 적는다',
  '  종료 코드: 0 보고 생성(NOT_READY 보고 포함) · 1 실행 오류 · 2 사용법 오류',
].join('\n');

export type InputName = 'empty' | 'fixture';
export type FormatName = 'text' | 'json';

/** 보고를 만들 입력. exportState 는 실행 전후 저장소 상태를 맞대어 보는 데만 쓴다. */
export interface ReportInput {
  kind: ReportInputKind;
  description: string;
  repo: ReadinessReads & { exportState(): Record<string, unknown> };
}

export interface RunDeps {
  /** 입력을 여는 함수. 시험이 실행 오류 경로를 만들려고 바꿔 끼운다. 기본값은 openInput. */
  openInput?: (name: InputName) => ReportInput;
  /** 실행 시점의 날짜(YYYY-MM-DD). 시험이 고정한다. 기본값은 시스템 날짜. */
  today?: () => string;
}

export interface CliResult {
  exitCode: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

export function openInput(name: InputName): ReportInput {
  if (name === 'empty') {
    return { kind: 'EMPTY_MEMORY_REPOSITORY', description: '빈 메모리 저장소 (병원·묶음·치료가 하나도 없다)', repo: createMemoryRepository() };
  }
  const { world } = buildWorld();
  return { kind: 'SYNTHETIC_TEST_FIXTURE', description: '기존 합성 시험 자료 세계 (TEST_FIXTURE 출처의 병원 1곳과 게시 자료)', repo: world.repo };
}

// ───────────────────────── 인자 ─────────────────────────

class UsageError extends Error {}

interface ParsedArgs {
  help: boolean;
  input: InputName | null;
  format: FormatName;
  at: string | null;
}

function isRealDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { help: false, input: null, format: 'text', at: null };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new UsageError(`알 수 없는 인자: '${arg}'`);
    }
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (name !== '--input' && name !== '--format' && name !== '--at') {
      throw new UsageError(`알 수 없는 옵션: '${name}'`);
    }
    if (seen.has(name)) {
      throw new UsageError(`옵션이 두 번 나왔다: '${name}'`);
    }
    seen.add(name);
    let value: string | undefined;
    if (equals === -1) {
      index += 1;
      value = argv[index];
    } else {
      value = arg.slice(equals + 1);
    }
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new UsageError(`'${name}' 에 값이 없다`);
    }
    if (name === '--input') {
      if (value !== 'empty' && value !== 'fixture') {
        throw new UsageError(`--input 은 empty 또는 fixture 만 받는다 (받은 값: '${value}')`);
      }
      parsed.input = value;
    } else if (name === '--format') {
      if (value !== 'text' && value !== 'json') {
        throw new UsageError(`--format 은 text 또는 json 만 받는다 (받은 값: '${value}')`);
      }
      parsed.format = value;
    } else {
      if (!isRealDate(value)) {
        throw new UsageError(`--at 은 실제 날짜 YYYY-MM-DD 여야 한다 (받은 값: '${value}')`);
      }
      parsed.at = value;
    }
  }
  if (!parsed.help && parsed.input === null) {
    throw new UsageError('--input 이 없다 (empty 또는 fixture 를 고른다)');
  }
  return parsed;
}

// ───────────────────────── 실행 ─────────────────────────

/** ReadinessReads 의 읽기 메서드 열 개. 이 밖의 속성(쓰기 메서드 포함)은 판정 코드에 넘기지 않는다. */
const READ_METHODS: readonly (keyof ReadinessReads)[] = [
  'listClinics',
  'getClinicRuleScope',
  'getClinicCurrentCatalogVersion',
  'getTreatmentVersion',
  'getTreatment',
  'getCommonBaseFee',
  'listRuleBundleVersions',
  'getBundleStatus',
  'getItemVersion',
  'readItemStates',
];

export function readOnlyView(repo: ReadinessReads): ReadinessReads {
  const view: Record<string, unknown> = {};
  for (const name of READ_METHODS) {
    view[name] = (repo[name] as (...args: unknown[]) => unknown).bind(repo);
  }
  return view as unknown as ReadinessReads;
}

function produce(parsed: ParsedArgs, deps: RunDeps): string {
  const input = (deps.openInput ?? openInput)(parsed.input as InputName);
  const asOf = parsed.at ?? (deps.today ?? systemToday)();
  const ctx = operatingReadinessContext(asOf);

  const digestBefore = canonicalDigest(input.repo.exportState());
  const report = readReadiness(readOnlyView(input.repo), ctx);
  const digestAfter = canonicalDigest(input.repo.exportState());
  if (digestBefore !== digestAfter) {
    throw new Error('읽기 전용 확인에 실패했다: 보고를 만드는 동안 저장소 상태가 바뀌었다. 보고를 내지 않는다');
  }

  const view = buildReportView(report, ctx, {
    asOf,
    asOfSource: parsed.at === null ? 'SYSTEM_CLOCK' : 'ARGUMENT',
    input: { kind: input.kind, description: input.description },
    readOnlyCheck: { digestBefore, digestAfter },
  });
  return parsed.format === 'json' ? `${JSON.stringify(view, null, 2)}\n` : `${renderReportText(view)}\n`;
}

/** 명령 하나를 실행해 종료 코드와 출력을 돌려준다. 프로세스를 끝내거나 직접 쓰지 않는다(진입점 readiness-report-main.ts 가 쓴다). */
export function runReadinessReport(argv: readonly string[], deps: RunDeps = {}): CliResult {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      return { exitCode: 2, stdout: '', stderr: `사용법 오류: ${error.message}\n${USAGE}\n` };
    }
    throw error;
  }
  if (parsed.help) {
    return { exitCode: 0, stdout: `${USAGE}\n`, stderr: '' };
  }
  try {
    return { exitCode: 0, stdout: produce(parsed, deps), stderr: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: '', stderr: `실행 오류: ${message}\n` };
  }
}
