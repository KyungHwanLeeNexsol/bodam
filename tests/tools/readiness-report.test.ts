import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { seoulDate } from '../../src/app/clock';
import { canonicalDigest } from '../../src/server/digest';
import { READINESS_CELLS, computeReadiness, operatingReadinessContext, readReadiness } from '../../src/server/readiness';
import type { ReadinessContext } from '../../src/server/readiness';
import { createMemoryRepository } from '../../src/server/repo/memory/memory-repository';
import { extractModuleRefs, readSourceFiles, tokenize } from '../boundary/source-scan';
import { TEST_FIXTURE_CLINIC_ID } from '../fixtures/server/actors.fixture';
import { makeClinic } from '../fixtures/server/entities.fixture';
import { TEST_CTX, bundleOf, clinicOf, snapshotOf } from '../fixtures/server/readiness.fixture';
import { openInput, readOnlyView, runReadinessReport } from './readiness-report';
import type { InputName, ReportInput } from './readiness-report';
import { buildReportView, renderReportText } from './readiness-report-view';
import type { ReadinessReportView } from './readiness-report-view';

// 운영 준비 상태 보고 명령(tests/tools/readiness-report*.ts)의 시험. 시험 자료는 전부 TEST_FIXTURE 이며 어떤 운영 자료도 만들지 않는다.
// 기대값은 손으로 적지 않고 같은 저장소를 readReadiness 로 직접 읽은 결과와 맞대어 본다. 명령은 판정을 하지 않고 보고를 옮겨 담을 뿐이다.

const AT = '2026-11-17';
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function jsonOf(input: InputName, extra: string[] = []): ReadinessReportView {
  const result = runReadinessReport(['--input', input, '--format', 'json', '--at', AT, ...extra]);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout) as ReadinessReportView;
}

const textOf = (input: InputName): string => {
  const result = runReadinessReport(['--input', input, '--at', AT]);
  expect(result.exitCode).toBe(0);
  return result.stdout;
};

/** 어떤 속성에 접근했는지 기록하는 입력. 쓰기 메서드 접근을 잡는다. */
function spiedInput(name: InputName): { input: ReportInput; touched: Set<string> } {
  const real = openInput(name);
  const touched = new Set<string>();
  const repo = new Proxy(real.repo, {
    get(target, prop) {
      touched.add(String(prop));
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { input: { ...real, repo }, touched };
}

const READ_METHODS = ['listClinics', 'getClinicRuleScope', 'getClinicCurrentCatalogVersion', 'getTreatmentVersion', 'getTreatment', 'getCommonBaseFee', 'listRuleBundleVersions', 'getBundleStatus', 'getItemVersion', 'readItemStates'];

describe('입력 하나: 빈 메모리 저장소', () => {
  const view = jsonOf('empty');

  it('병원 보고가 비어 있고 플랫폼 15칸이 모두 PROFILE_ABSENT 다 (칸 순서는 READINESS_CELLS)', () => {
    expect(view.clinics).toEqual([]);
    expect(view.platform.tableP).toEqual(READINESS_CELLS.map((cell) => ({ cell, status: 'NOT_READY', code: 'PROFILE_ABSENT' })));
    expect(view.platform.tableCounts).toEqual({ READY: 0, NOT_READY: 15 });
  });

  it('입력이 빈 저장소이고 운영 자료가 아님을 밝히며, 기준일과 그 출처, 허용 출처 OPERATING 만을 기록한다', () => {
    expect(view.input).toMatchObject({ kind: 'EMPTY_MEMORY_REPOSITORY', isOperatingData: false });
    expect(view.asOf).toBe(AT);
    expect(view.asOfSource).toBe('ARGUMENT');
    expect(view.evaluation).toEqual({ acceptedOrigins: { rules: ['OPERATING'], lines: ['OPERATING'] }, digest: 'canonicalDigest' });
  });

  it('글 보고에도 병원 없음, 빈 저장소, 15칸 PROFILE_ABSENT 가 나온다', () => {
    const text = textOf('empty');
    expect(text).toContain('[EMPTY_MEMORY_REPOSITORY]');
    expect(text).toContain('병원 보고: 없음');
    expect(text.match(/NOT_READY 코드=PROFILE_ABSENT/g)).toHaveLength(15);
  });
});

describe('입력 둘: 합성 시험 자료(TEST_FIXTURE)를 운영 기준으로 평가한다', () => {
  const view = jsonOf('fixture');
  const clinic = view.clinics[0]!;

  it('병원 한 곳이 나오고, 입력이 합성 시험 자료이며 운영 자료가 아님을 빈 저장소 입력과 다르게 밝힌다', () => {
    expect(view.clinics).toHaveLength(1);
    expect(clinic.clinicId).toBe(TEST_FIXTURE_CLINIC_ID);
    expect(view.input).toMatchObject({ kind: 'SYNTHETIC_TEST_FIXTURE', isOperatingData: false });
    expect(view.input.kind).not.toBe(jsonOf('empty').input.kind);
  });

  it('최종 판정: 계산 15칸이 모두 NOT_READY 이고 서류 안내도 NOT_READY 다 (READY 가 되지 않는다)', () => {
    expect(clinic.verdicts.calculationReady).toHaveLength(15);
    expect(clinic.verdicts.calculationReady.every((row) => row.status === 'NOT_READY')).toBe(true);
    expect(clinic.verdictCounts.calculationReady).toEqual({ READY: 0, NOT_READY: 15 });
    expect(clinic.verdicts.documentReady.status).toBe('NOT_READY');
    expect(clinic.verdictCounts.documentReady).toEqual({ READY: 0, NOT_READY: 1 });
  });

  it('개별 표와 최종 판정은 다르다: 표 S 는 READY 인데 최종 판정은 모두 NOT_READY 다', () => {
    expect(clinic.tables.S.status).toBe('READY');
    expect(clinic.tableCounts.S).toEqual({ READY: 1, NOT_READY: 0 });
    expect(clinic.verdictCounts.calculationReady.READY).toBe(0);
    expect(clinic.verdicts.documentReady.status).toBe('NOT_READY');
  });

  it('막힌 단계와 코드를 보존한다 (읽은 보고의 값과 같다)', () => {
    const direct = readReadiness(openInput('fixture').repo, { ...TEST_CTX, acceptedOrigins: { rules: ['OPERATING'], lines: ['OPERATING'] }, at: AT, digest: canonicalDigest }).clinics[0]!;
    expect(clinic.tables).toEqual({ S: direct.scope, P: direct.profiles, M: direct.mappings, D: direct.documents });
    expect(clinic.verdicts).toEqual({ calculationReady: direct.calculationReady, documentReady: direct.documentReady });
    const demo = clinic.verdicts.calculationReady.find((row) => row.cell.generation === 'GEN4_C4' && row.cell.insurerType === 'NON_LIFE')!;
    expect(demo).toMatchObject({ status: 'NOT_READY', stage: 'P', code: 'PROFILE_DEMO' });
    expect(clinic.verdicts.documentReady).toMatchObject({ status: 'NOT_READY', stage: 'D', code: 'RULES_UNAVAILABLE', detail: 'ORIGIN_NOT_ACCEPTED' });
    expect(clinic.tables.M.every((row) => row.status === 'NOT_READY' && row.code === 'LINE_ORIGIN_NOT_ACCEPTED')).toBe(true);
  });

  it('S·P·M·D 전체를 담는다: 표 P 15칸, 표 M 줄 × 15칸, 표 D, 표 S', () => {
    expect(Object.keys(clinic.tables)).toEqual(['S', 'P', 'M', 'D']);
    expect(clinic.tables.P).toHaveLength(15);
    expect(clinic.tables.M).toHaveLength(3 * 15);
    expect(new Set(clinic.tables.M.map((row) => row.treatmentId)).size).toBe(3);
    expect(view.platform.tableP).toHaveLength(15);
  });

  it('계산 판정은 세대 × 보험사 유형 칸마다, 서류 판정은 병원 하나에 하나다', () => {
    expect(clinic.verdicts.calculationReady.map((row) => row.cell)).toEqual(READINESS_CELLS);
    expect(Array.isArray(clinic.verdicts.documentReady)).toBe(false);
    expect(clinic.verdicts.documentReady).toHaveProperty('status');
  });

  it('같은 자료가 시험 출처까지 받는 구성에서는 한 칸이 READY 다: 위 NOT_READY 는 출처 때문이다 (자료가 망가진 것이 아니다)', () => {
    const testAccepting: ReadinessContext = { ...TEST_CTX, at: AT, digest: canonicalDigest };
    const report = readReadiness(openInput('fixture').repo, testAccepting).clinics[0]!;
    const ready = report.calculationReady.filter((row) => row.status === 'READY');
    expect(ready.map((row) => row.cell)).toEqual([{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }]);
    expect(report.documentReady).toEqual({ status: 'READY' });
    // 같은 날짜(AT)·같은 자료를 운영 구성으로 읽으면 어느 칸도 READY 가 아니다. 두 읽기가 다른 것은 허용 출처뿐이다.
    const operating = jsonOf('fixture', []).clinics[0]!;
    expect(operating.verdictCounts.calculationReady.READY).toBe(0);
  });
});

describe('두 판정을 합치지 않는다', () => {
  it('JSON 의 키는 고정된 목록뿐이고 계산·서류를 합친 키가 없다', () => {
    const view = jsonOf('fixture');
    expect(Object.keys(view)).toEqual(['schema', 'asOf', 'asOfSource', 'evaluation', 'input', 'readOnlyCheck', 'platform', 'clinics', 'note']);
    expect(Object.keys(view.clinics[0]!)).toEqual(['clinicId', 'slug', 'tables', 'tableCounts', 'verdicts', 'verdictCounts']);
    expect(Object.keys(view.clinics[0]!.verdicts)).toEqual(['calculationReady', 'documentReady']);
  });

  it('글과 JSON 어디에도 합친 완료 문구가 없고, 계산·서류 최종 판정이 서로 다른 줄에 있다', () => {
    for (const input of ['empty', 'fixture'] as const) {
      const text = textOf(input);
      const json = runReadinessReport(['--input', input, '--format', 'json', '--at', AT]).stdout;
      for (const output of [text, json]) {
        expect(output).not.toContain('운영 준비 완료');
        expect(output).not.toMatch(/ready for operation|operatingReady|fullyReady/i);
      }
    }
    const lines = textOf('fixture').split('\n');
    const calculation = lines.findIndex((line) => line.includes('[최종 판정 1] 계산 가능 여부'));
    const documents = lines.findIndex((line) => line.includes('[최종 판정 2] 서류 안내 가능 여부'));
    expect(calculation).toBeGreaterThan(-1);
    expect(documents).toBeGreaterThan(calculation);
    expect(lines.filter((line) => line.includes('[최종 판정'))).toHaveLength(2);
  });

  it('글 보고: 개별 표 줄(표 S 는 READY)과 최종 판정 줄(READY 0 / NOT_READY 15)이 구분되어 나온다', () => {
    const text = textOf('fixture');
    expect(text).toContain('[개별 표] 표마다 따로 본 상태다. 최종 판정이 아니다.');
    expect(text).toMatch(/표 S 규칙 사용 범위·묶음 상태 : READY ACTIVE/);
    expect(text).toContain('[최종 판정 1] 계산 가능 여부 — 세대 × 보험사 유형 15칸 : READY 0 / NOT_READY 15');
    expect(text).toContain('[최종 판정 2] 서류 안내 가능 여부 — 병원 단위 : NOT_READY 막힌 단계=D 코드=RULES_UNAVAILABLE 세부=ORIGIN_NOT_ACCEPTED');
  });
});

describe('글 보고는 막힌 단계와 코드를 단계마다 그대로 쓴다 (S · P · M · TREATMENT · D, READY 포함)', () => {
  // 시험 출처까지 받는 구성(TEST_CTX)으로 계산한 스냅샷 보고를 같은 보기 함수로 옮겨 쓴다. 기대 문구는 보고의 코드를 손으로 옮긴 것이 아니라 단계별로 한 군데만 어긋나게 만든 자료에서 나온다.
  const META = { asOf: TEST_CTX.at, asOfSource: 'ARGUMENT' as const, input: { kind: 'SYNTHETIC_TEST_FIXTURE' as const, description: '스냅샷 시험' }, readOnlyCheck: { digestBefore: 'a', digestAfter: 'a' } };
  const textFor = (clinics: ReturnType<typeof clinicOf>[]): string => renderReportText(buildReportView(computeReadiness(snapshotOf(clinics), TEST_CTX), TEST_CTX, META));

  it('P 단계: 막힌 칸은 코드를 함께 쓴다', () => {
    expect(textOf('fixture')).toContain('GEN4_C4/NON_LIFE  NOT_READY 막힌 단계=P 코드=PROFILE_DEMO');
    expect(textOf('fixture')).toContain('GEN1_AS/LIFE  NOT_READY 막힌 단계=P 코드=PROFILE_ABSENT');
  });

  it('S 단계: 규칙 사용 범위가 없으면 계산 15칸과 서류 판정이 모두 S 단계와 같은 코드로 막힌다', () => {
    const text = textFor([clinicOf(null)]);
    expect(text.match(/NOT_READY 막힌 단계=S 코드=CLINIC_RULE_SCOPE_ABSENT/g)).toHaveLength(16);
    expect(text).toContain('[최종 판정 2] 서류 안내 가능 여부 — 병원 단위 : NOT_READY 막힌 단계=S 코드=CLINIC_RULE_SCOPE_ABSENT');
    expect(text).toMatch(/표 S 규칙 사용 범위·묶음 상태 : NOT_READY SCOPE_ABSENT 코드=CLINIC_RULE_SCOPE_ABSENT/);
  });

  it('TREATMENT 단계: 게시된 치료가 없으면 NO_PUBLISHED_TREATMENT 로 막힌다', () => {
    const text = textFor([clinicOf(bundleOf(), { lines: [] })]);
    expect(text.match(/NOT_READY 막힌 단계=TREATMENT 코드=NO_PUBLISHED_TREATMENT/g)).toHaveLength(15);
  });

  it('M 단계: 매핑이 없으면 막힌 줄과 줄별 코드가 줄 id 순으로 나온다', () => {
    const text = textFor([clinicOf(bundleOf({ mappings: [] }))]);
    expect(text).toContain('NOT_READY 막힌 단계=M 줄=B-FEE:MAPPING_ABSENT,T-A:MAPPING_ABSENT,T-B:MAPPING_ABSENT,T-C:MAPPING_ABSENT');
    expect(text).toContain('NOT_READY 코드: MAPPING_ABSENT ×60');
  });

  it('READY: 모든 표와 판정이 준비된 자료에서는 READY 로 나오고 그래도 두 판정은 따로 있다', () => {
    const text = textFor([clinicOf(bundleOf())]);
    expect(text).toContain('[최종 판정 1] 계산 가능 여부 — 세대 × 보험사 유형 15칸 : READY 15 / NOT_READY 0');
    expect(text).toContain('[최종 판정 2] 서류 안내 가능 여부 — 병원 단위 : READY');
    expect(text).toMatch(/표 D 서류 규칙\s+: READY 서류 규칙=/);
    expect(text).not.toContain('운영 준비 완료');
  });

  it('D 단계: 서류 규칙 묶음이 없으면 계산은 그대로 READY 이고 서류 판정만 D 단계 SET_ABSENT 로 막힌다 (두 판정은 독립)', () => {
    const text = textFor([clinicOf(bundleOf({ documentRuleSet: null }))]);
    expect(text).toContain('[최종 판정 1] 계산 가능 여부 — 세대 × 보험사 유형 15칸 : READY 15 / NOT_READY 0');
    expect(text).toContain('[최종 판정 2] 서류 안내 가능 여부 — 병원 단위 : NOT_READY 막힌 단계=D 코드=RULES_UNAVAILABLE 세부=SET_ABSENT');
  });
});

describe('읽기 전용', () => {
  it('실행 전후 저장소 전체 상태가 같고, 보고에도 같은 해시 두 개가 기록된다', () => {
    for (const name of ['empty', 'fixture'] as const) {
      const input = openInput(name);
      const before = structuredClone(input.repo.exportState());
      const result = runReadinessReport(['--input', name, '--format', 'json', '--at', AT], { openInput: () => input });
      expect(result.exitCode).toBe(0);
      expect(input.repo.exportState()).toEqual(before);
      const check = (JSON.parse(result.stdout) as ReadinessReportView).readOnlyCheck;
      expect(check.unchanged).toBe(true);
      expect(check.digestBefore).toBe(check.digestAfter);
      expect(check.digestBefore).toBe(canonicalDigest(before));
      expect(check.digestBefore).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('판정 코드에 넘기는 객체(readOnlyView)는 읽기 메서드 열 개만 가지고 쓰기 메서드·transaction 이 없다', () => {
    const repo = openInput('fixture').repo;
    const view = readOnlyView(repo) as unknown as Record<string, unknown>;
    expect(Object.keys(view).sort()).toEqual([...READ_METHODS].sort());
    for (const write of ['saveClinic', 'saveTreatment', 'transaction', 'exportState']) {
      expect(view[write], write).toBeUndefined();
    }
    // 그 객체로 낸 보고는 저장소를 직접 읽은 보고와 같다.
    expect(readReadiness(view as never, operatingReadinessContext(AT))).toEqual(readReadiness(repo, operatingReadinessContext(AT)));
  });

  it('명령 실행 중 저장소에 닿은 속성은 읽기 메서드 열 개와 실행 전후 비교용 exportState 뿐이다', () => {
    const { input, touched } = spiedInput('fixture');
    expect(runReadinessReport(['--input', 'fixture', '--at', AT], { openInput: () => input }).exitCode).toBe(0);
    expect([...touched].sort()).toEqual([...READ_METHODS, 'exportState'].sort());
  });

  it('보고를 만드는 동안 저장소가 바뀌면 보고를 내지 않고 실행 오류(1)로 끝낸다 (빈 시험 방지)', () => {
    const base = createMemoryRepository();
    const repo = new Proxy(base, {
      get(target, prop) {
        if (prop === 'listClinics') {
          return () => {
            target.saveClinic(makeClinic());
            return [];
          };
        }
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const result = runReadinessReport(['--input', 'empty', '--at', AT], { openInput: () => ({ kind: 'EMPTY_MEMORY_REPOSITORY', description: '변경 시험', repo }) });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('읽기 전용 확인에 실패했다');
  });
});

describe('종료 코드: 보고 생성(0) · 실행 오류(1) · 사용법 오류(2)', () => {
  it('NOT_READY 보고도 정상 생성이면 종료 코드 0 이고 표준 오류는 비어 있다', () => {
    for (const input of ['empty', 'fixture'] as const) {
      for (const format of ['text', 'json'] as const) {
        const result = runReadinessReport(['--input', input, '--format', format, '--at', AT]);
        expect(result, `${input}/${format}`).toMatchObject({ exitCode: 0, stderr: '' });
        expect(result.stdout.endsWith('\n')).toBe(true);
      }
    }
  });

  const usageErrors: Array<[string, string[]]> = [
    ['인자 없음', []],
    ['--input 없음', ['--format', 'json']],
    ['--input 값이 둘 밖', ['--input', 'operating']],
    ['--input 값 없음', ['--input']],
    ['--input 값 자리에 다른 옵션', ['--input', '--format', 'json']],
    ['--format 값이 둘 밖', ['--input', 'empty', '--format', 'xml']],
    ['--at 형식 오류', ['--input', 'empty', '--at', '2026/11/17']],
    ['--at 없는 날짜', ['--input', 'empty', '--at', '2026-02-30']],
    ['옵션 중복', ['--input', 'empty', '--input', 'fixture']],
    ['알 수 없는 옵션(JSON 가져오기)', ['--input', 'empty', '--json-file', 'data.json']],
    ['알 수 없는 옵션(운영 연결)', ['--input', 'empty', '--connect', 'db']],
    ['알 수 없는 옵션(허용 출처 바꾸기)', ['--input', 'empty', '--origins', 'TEST_FIXTURE']],
    ['위치 인자', ['--input', 'empty', 'data.json']],
  ];

  it.each(usageErrors)('사용법 오류(2): %s -> 보고 없음, 표준 출력 비어 있음', (_label, argv) => {
    const result = runReadinessReport(argv);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('사용법 오류');
    expect(result.stderr).toContain('사용법: npm run -s readiness:report');
  });

  it('--input=값 형태도 받는다', () => {
    expect(runReadinessReport(['--input=fixture', '--format=json', `--at=${AT}`]).exitCode).toBe(0);
  });

  it('실행 오류(1): 저장소가 가리키는 자료가 없는 깨진 저장소는 보고를 내지 않는다', () => {
    const base = createMemoryRepository();
    const repo = new Proxy(base, {
      get(target, prop) {
        if (prop === 'listClinics') return () => [makeClinic()];
        if (prop === 'getClinicRuleScope') return () => ({ clinicId: TEST_FIXTURE_CLINIC_ID, ruleBundleVersionId: 'GONE_BUNDLE' });
        if (prop === 'getClinicCurrentCatalogVersion') return () => null;
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const result = runReadinessReport(['--input', 'fixture', '--at', AT], { openInput: () => ({ kind: 'SYNTHETIC_TEST_FIXTURE', description: '깨진 저장소 시험', repo }) });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('실행 오류');
    expect(result.stderr).toContain('GONE_BUNDLE');
  });

  it('--help 는 사용법을 표준 출력에 쓰고 0 이다', () => {
    const result = runReadinessReport(['--help']);
    expect(result).toMatchObject({ exitCode: 0, stderr: '' });
    expect(result.stdout).toContain('사용법: npm run -s readiness:report');
  });

  it('--at 을 생략하면 한국 표준시 날짜를 쓴다: 시스템 시각이 UTC 로 전날이어도 한국에서는 다음 날이다 (src/app/clock 와 같은 기준)', () => {
    expect(seoulDate(new Date('2026-11-16T16:30:00Z'))).toBe('2026-11-17');
  });

  it('기본 날짜 함수는 src/app/clock 의 systemToday 를 쓴다 (도구 소스가 직접 날짜를 만들지 않는다)', () => {
    const source = readFileSync(`${REPO_ROOT}/tests/tools/readiness-report.ts`, 'utf8');
    expect(source).toContain("import { systemToday } from '../../src/app/clock';");
    expect(source).toContain('(deps.today ?? systemToday)()');
    expect(source).not.toMatch(/getFullYear|getDate\(|getMonth\(|new Date\(\)/);
  });

  it('--at 을 생략하면 실행 시점 날짜를 쓰고 보고에 그 출처를 적는다', () => {
    const result = runReadinessReport(['--input', 'empty', '--format', 'json'], { today: () => '2026-12-01' });
    const view = JSON.parse(result.stdout) as ReadinessReportView;
    expect(view).toMatchObject({ asOf: '2026-12-01', asOfSource: 'SYSTEM_CLOCK' });
    expect(runReadinessReport(['--input', 'empty', '--at', '2026-12-02'], { today: () => '2026-12-01' }).stdout).toContain('2026-12-02 (--at 인자)');
  });
});

describe('실제 명령 (새 프로세스, npm 스크립트와 같은 node 호출)', () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/tools/readiness-report-main.ts', ...args], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 90_000 });

  it('package.json 에 readiness:report 스크립트가 있고 같은 진입점을 가리킨다', () => {
    const scripts = (JSON.parse(readFileSync(`${REPO_ROOT}/package.json`, 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['readiness:report']).toBe('node --import ./tests/fixtures/engine/ts-resolve-register.mjs tests/tools/readiness-report-main.ts');
  });

  it('두 입력 × 두 출력 형식이 모두 종료 코드 0 이고 프로세스 안의 결과와 바이트까지 같다', () => {
    for (const input of ['empty', 'fixture'] as const) {
      for (const format of ['text', 'json'] as const) {
        const child = run('--input', input, '--format', format, '--at', AT);
        expect(child.status, `${input}/${format}: ${child.stderr}`).toBe(0);
        expect(child.stdout).toBe(runReadinessReport(['--input', input, '--format', format, '--at', AT]).stdout);
      }
    }
  }, 120_000);

  it('JSON 출력은 그대로 파싱되고 병원별 계산·서류 판정을 담는다', () => {
    const child = run('--input', 'fixture', '--format', 'json', '--at', AT);
    expect(child.status).toBe(0);
    const view = JSON.parse(child.stdout) as ReadinessReportView;
    expect(view.clinics[0]!.verdicts.calculationReady).toHaveLength(15);
    expect(view.clinics[0]!.verdicts.documentReady.status).toBe('NOT_READY');
  }, 60_000);

  it('사용법 오류는 종료 코드 2, 표준 출력은 비고 표준 오류에 사유가 나온다', () => {
    const child = run('--input', 'empty', '--json-file', 'data.json');
    expect(child.status).toBe(2);
    expect(child.stdout).toBe('');
    expect(child.stderr).toContain('알 수 없는 옵션');
  }, 60_000);
});

describe('명령 자체의 경계: 임의 JSON 가져오기·운영 연결 수단이 없다', () => {
  const files = readSourceFiles(fileURLToPath(new URL('.', import.meta.url)), 'tests/tools').filter((file) => !/\.test\./.test(file.path));
  const FORBIDDEN_IDENTS = new Set(['fetch', 'readFile', 'readFileSync', 'createReadStream', 'createServer', 'connect', 'request', 'spawn', 'spawnSync', 'exec', 'execSync', 'require', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'env']);

  it('도구 소스는 세 파일이다', () => {
    expect(files.map((file) => file.path)).toEqual(['tests/tools/readiness-report-main.ts', 'tests/tools/readiness-report-view.ts', 'tests/tools/readiness-report.ts']);
  });

  it('가져오기는 src 와 tests 안의 상대 경로뿐이다: 파일·네트워크·DB·자식 프로세스 모듈, 패키지, 동적 가져오기가 없다', () => {
    for (const file of files) {
      for (const ref of extractModuleRefs(tokenize(file.text))) {
        expect(ref.kind, `${file.path}:${ref.line}`).not.toBe('dynamic');
        expect(ref.kind, `${file.path}:${ref.line}`).not.toBe('require');
        expect(ref.specifier, `${file.path}:${ref.line}`).toMatch(/^\.\.?\//);
      }
    }
  });

  it('파일 읽기·네트워크·자식 프로세스·환경 변수에 해당하는 이름을 쓰지 않는다', () => {
    for (const file of files) {
      const idents = tokenize(file.text)
        .filter((token) => token.kind === 'ident')
        .map((token) => token.text);
      expect(idents.filter((text) => FORBIDDEN_IDENTS.has(text)), file.path).toEqual([]);
    }
  });

  it('허용 출처는 operatingReadinessContext 하나뿐이다: 시험 출처 이름을 문자열로 쓰지 않는다 (사용법 안내문 제외)', () => {
    for (const file of files) {
      const literals = tokenize(file.text)
        .filter((token) => token.kind === 'string')
        .map((token) => token.text);
      expect(literals.filter((text) => text === "'TEST_FIXTURE'" || text === "'DEMO'" || text === '"TEST_FIXTURE"' || text === '"DEMO"'), file.path).toEqual([]);
    }
  });

  it('src 는 이 도구를 가져오지 않는다', () => {
    const srcFiles = readSourceFiles(fileURLToPath(new URL('../../src', import.meta.url)), 'src');
    expect(srcFiles.length).toBeGreaterThan(50);
    expect(srcFiles.filter((file) => /tests\/tools|readiness-report/.test(file.text))).toEqual([]);
  });
});
