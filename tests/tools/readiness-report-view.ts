import type { Cell } from '../../src/engine/resolve';
import type {
  CalculationRow,
  ClinicReadiness,
  DocumentReadyRow,
  PlatformProfileRow,
  ReadinessContext,
  ReadinessReport,
} from '../../src/server/readiness';

// 운영 준비 상태 보고(DD-23)를 사람이 읽는 글과 JSON 으로 옮기는 순수 함수들이다. 저장소·시험 자료를 가져오지 않고 판정도 하지 않는다.
// 판정은 모두 src/server/readiness.ts 의 readReadiness 가 낸 보고에 들어 있고, 여기서는 그 값을 그대로 담아 나눠 보여 줄 뿐이다.
//  - 개별 표(S·P·M·D)의 상태와 최종 판정(계산 가능 여부 15칸, 서류 안내 가능 여부)은 다른 묶음에 담는다. 표 하나가 READY 여도 최종 판정은 아닐 수 있다.
//  - 계산 가능 여부는 세대 × 보험사 유형 칸마다, 서류 안내 가능 여부는 병원마다 따로 낸다. 두 판정을 하나로 합친 값이나 문구는 만들지 않는다.
//  - 막힌 단계(stage)와 코드(code, detail, 줄별 코드)는 보고의 값을 그대로 보존한다.

export type ReportInputKind = 'EMPTY_MEMORY_REPOSITORY' | 'SYNTHETIC_TEST_FIXTURE';

export type StatusCount = { READY: number; NOT_READY: number };

export interface ReportMeta {
  /** 판정 기준일(YYYY-MM-DD). */
  asOf: string;
  /** 기준일이 --at 인자인지, 실행 시점의 시스템 날짜인지. */
  asOfSource: 'ARGUMENT' | 'SYSTEM_CLOCK';
  input: { kind: ReportInputKind; description: string };
  /** 실행 전후 저장소 전체 상태의 정본 해시. 같아야 읽기 전용이었다는 뜻이다. */
  readOnlyCheck: { digestBefore: string; digestAfter: string };
}

export interface ClinicView {
  clinicId: string;
  slug: string;
  /** 개별 표: 표마다 따로 본 상태다. 최종 판정이 아니다. */
  tables: {
    S: ClinicReadiness['scope'];
    P: ClinicReadiness['profiles'];
    M: ClinicReadiness['mappings'];
    D: ClinicReadiness['documents'];
  };
  tableCounts: { S: StatusCount; P: StatusCount; M: StatusCount; D: StatusCount };
  /** 최종 판정: 계산 가능 여부는 15칸(세대 × 보험사 유형), 서류 안내 가능 여부는 병원 하나. 서로 독립이다. */
  verdicts: { calculationReady: CalculationRow[]; documentReady: DocumentReadyRow };
  verdictCounts: { calculationReady: StatusCount; documentReady: StatusCount };
}

export interface ReadinessReportView {
  schema: 'bodam.readiness-report.v1';
  asOf: string;
  asOfSource: ReportMeta['asOfSource'];
  /** 판정에 쓴 구성. 허용 출처를 실제 구성에서 그대로 옮겨 적는다. */
  evaluation: { acceptedOrigins: { rules: string[]; lines: string[] }; digest: string };
  input: { kind: ReportInputKind; description: string; isOperatingData: false };
  readOnlyCheck: ReportMeta['readOnlyCheck'] & { unchanged: boolean };
  platform: { tableP: PlatformProfileRow[]; tableCounts: StatusCount };
  clinics: ClinicView[];
  note: string;
}

const NOTE =
  '최종 판정 두 가지(계산 가능 여부, 서류 안내 가능 여부)는 서로 독립이며 하나로 합치지 않는다. 개별 표의 상태는 최종 판정이 아니다. 이 보고는 입력 자료에 대한 것이며 실제 병원이나 운영 저장소의 상태가 아니다.';

function countStatus(rows: ReadonlyArray<{ status: 'READY' | 'NOT_READY' }>): StatusCount {
  const counts: StatusCount = { READY: 0, NOT_READY: 0 };
  for (const row of rows) {
    counts[row.status] += 1;
  }
  return counts;
}

function clinicView(clinic: ClinicReadiness): ClinicView {
  return {
    clinicId: clinic.clinicId,
    slug: clinic.slug,
    tables: { S: clinic.scope, P: clinic.profiles, M: clinic.mappings, D: clinic.documents },
    tableCounts: {
      S: countStatus([clinic.scope]),
      P: countStatus(clinic.profiles),
      M: countStatus(clinic.mappings),
      D: countStatus([clinic.documents]),
    },
    verdicts: { calculationReady: clinic.calculationReady, documentReady: clinic.documentReady },
    verdictCounts: { calculationReady: countStatus(clinic.calculationReady), documentReady: countStatus([clinic.documentReady]) },
  };
}

/** readReadiness 의 보고와 실행 정보를 JSON 으로 낼 모양으로 옮긴다. 보고를 바꾸지 않는다. */
export function buildReportView(report: ReadinessReport, ctx: ReadinessContext, meta: ReportMeta): ReadinessReportView {
  return {
    schema: 'bodam.readiness-report.v1',
    asOf: meta.asOf,
    asOfSource: meta.asOfSource,
    evaluation: { acceptedOrigins: { rules: [...ctx.acceptedOrigins.rules], lines: [...ctx.acceptedOrigins.lines] }, digest: 'canonicalDigest' },
    input: { kind: meta.input.kind, description: meta.input.description, isOperatingData: false },
    readOnlyCheck: { ...meta.readOnlyCheck, unchanged: meta.readOnlyCheck.digestBefore === meta.readOnlyCheck.digestAfter },
    platform: { tableP: report.platformProfiles, tableCounts: countStatus(report.platformProfiles) },
    clinics: report.clinics.map(clinicView),
    note: NOTE,
  };
}

// ───────────────────────── 사람이 읽는 글 ─────────────────────────

const cellLabel = (cell: Cell): string => `${cell.generation}/${cell.insurerType}`;
const countText = (counts: StatusCount): string => `READY ${counts.READY} / NOT_READY ${counts.NOT_READY}`;
const short = (digest: string): string => digest.slice(0, 12);

function platformLine(row: PlatformProfileRow): string {
  return `  ${cellLabel(row.cell)}  ${row.status === 'READY' ? `READY 묶음=${row.bundleIds.join(',')}` : `NOT_READY 코드=${row.code}`}`;
}

function scopeText(scope: ClinicReadiness['scope']): string {
  return scope.status === 'READY' ? `READY ${scope.value} 묶음=${scope.bundleId}` : `NOT_READY ${scope.value} 코드=${scope.code}`;
}

function documentsText(documents: ClinicReadiness['documents']): string {
  return documents.status === 'READY'
    ? `READY 서류 규칙=${documents.ruleSetId}/${documents.ruleSetVersion}`
    : `NOT_READY 코드=${documents.code} 세부=${documents.detail}`;
}

/** 표 M 에서 NOT_READY 인 행을 코드별로 센다. 행이 많아서 코드와 개수만 보인다(행 전체는 JSON 에 있다). */
function mappingCodesText(mappings: ClinicReadiness['mappings']): string {
  const byCode = new Map<string, number>();
  for (const row of mappings) {
    if (row.status === 'NOT_READY') {
      byCode.set(row.code, (byCode.get(row.code) ?? 0) + 1);
    }
  }
  if (byCode.size === 0) {
    return '';
  }
  return ` — NOT_READY 코드: ${[...byCode.entries()].map(([code, count]) => `${code} ×${count}`).join(', ')}`;
}

function calculationLine(row: CalculationRow): string {
  const head = `    ${cellLabel(row.cell)}  `;
  if (row.status === 'READY') {
    return `${head}READY`;
  }
  if (row.stage === 'M') {
    return `${head}NOT_READY 막힌 단계=M 줄=${row.lines.map((line) => `${line.treatmentId}:${line.code}`).join(',')}`;
  }
  return `${head}NOT_READY 막힌 단계=${row.stage} 코드=${row.code}`;
}

function documentVerdictText(row: DocumentReadyRow): string {
  if (row.status === 'READY') {
    return 'READY';
  }
  return row.stage === 'S' ? `NOT_READY 막힌 단계=S 코드=${row.code}` : `NOT_READY 막힌 단계=D 코드=${row.code} 세부=${row.detail}`;
}

function clinicLines(clinic: ClinicView): string[] {
  const { tables, tableCounts, verdicts, verdictCounts } = clinic;
  return [
    '',
    `병원 ${clinic.clinicId} (${clinic.slug})`,
    '  [개별 표] 표마다 따로 본 상태다. 최종 판정이 아니다.',
    `    표 S 규칙 사용 범위·묶음 상태 : ${scopeText(tables.S)}`,
    `    표 P 프로필 칸(병원 보기)     : ${countText(tableCounts.P)} (세대 5 × 보험사 유형 3 = 15칸)`,
    `    표 M 치료별 매핑              : 행 ${tables.M.length}개 — ${countText(tableCounts.M)}${mappingCodesText(tables.M)}`,
    `    표 D 서류 규칙                : ${documentsText(tables.D)}`,
    `  [최종 판정 1] 계산 가능 여부 — 세대 × 보험사 유형 15칸 : ${countText(verdictCounts.calculationReady)}`,
    ...verdicts.calculationReady.map(calculationLine),
    `  [최종 판정 2] 서류 안내 가능 여부 — 병원 단위 : ${documentVerdictText(verdicts.documentReady)}`,
  ];
}

/** 사람이 읽는 요약. 두 최종 판정은 서로 다른 줄에 따로 나오고 합친 표현은 없다. */
export function renderReportText(view: ReadinessReportView): string {
  const lines: string[] = [
    '보담 운영 준비 상태 보고 (DD-23 · 읽기 전용)',
    `기준일        : ${view.asOf} (${view.asOfSource === 'ARGUMENT' ? '--at 인자' : '실행 시점의 한국 표준시 날짜'})`,
    `평가 기준     : 허용 출처 OPERATING 만 (규칙 ${view.evaluation.acceptedOrigins.rules.join(',')} / 줄 ${view.evaluation.acceptedOrigins.lines.join(',')}). 시험 출처(TEST_FIXTURE·DEMO) 자료는 받지 않는다.`,
    `입력          : ${view.input.description} [${view.input.kind}] — 운영 자료가 아니다. 병원 ${view.clinics.length}곳`,
    `읽기 전용 확인: 저장소 지문 실행 전 ${short(view.readOnlyCheck.digestBefore)} · 실행 후 ${short(view.readOnlyCheck.digestAfter)} → ${view.readOnlyCheck.unchanged ? '같음' : '다름'}`,
    '',
    `플랫폼 표 P (세대 5 × 보험사 유형 3 = 15칸, 모든 묶음 기준) : ${countText(view.platform.tableCounts)} — 개별 표이며 병원의 최종 판정이 아니다`,
    ...view.platform.tableP.map(platformLine),
  ];
  if (view.clinics.length === 0) {
    lines.push('', '병원 보고: 없음 (입력에 병원이 하나도 없다)');
  }
  for (const clinic of view.clinics) {
    lines.push(...clinicLines(clinic));
  }
  lines.push('', `※ ${view.note}`);
  return lines.join('\n');
}
