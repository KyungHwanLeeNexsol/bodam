import { DOCUMENT_LINE_KEYS } from '../../../engine/types';
import type { DocumentLineKey } from '../../../engine/types';
import type { DisplayState } from '../state/display';
import type { KioskState } from '../state/session-store';
import { COPY } from './copy';
import { isRecord, list } from './response-read';
import { causeWord, describeSelection } from './selection-view';

// 필요 서류 화면의 읽기 전용 값 (SPEC-REIMBURSEMENT-001 M6 S3b, design.md DD-06·DD-12, AC-007g·h·i, AC-014c·g, AC-010e).
// 순수 함수다. 서류 목록은 응답(documents)의 값 그대로이고 키오스크가 서류를 더하거나 줄이지 않는다.
//  - 고정 9줄: 줄이 정확히 아홉이고 각 줄이 한 번씩이 아니면 목록을 쓰지 않는다(빠지거나 겹친 목록을 일부만 보이지 않는다). 쓸 수 없는 목록은 "안내 문구"가 되고 빈 목록도 지어낸 서류도 그리지 않는다.
//  - 원인 모름(UNKNOWN_CAUSE): 줄은 세 범위(공통·상해 전용·질병 전용) 가운데 한 곳에 한 번만 나온다. 공통 줄의 사유가 여럿이면 모두 보인다.
//  - 쪽 나눔은 위치(offset)로 정한다: 쪽 크기가 바뀌어도(큰 글자 보기) 보던 첫 줄이 보이는 쪽에 머물고, 어떤 쪽 크기에서도 쪽을 이으면 아홉 줄이 한 번씩이다.

export type DocScope = 'COMMON' | 'INJURY_ONLY' | 'ILLNESS_ONLY';

/** 줄 키 → 환자에게 보이는 서류 이름 (디자인 K07_Documents). 영수증과 세부내역서만 한 줄로 묶는다. */
export const DOCUMENT_NAME: Readonly<Record<DocumentLineKey, string>> = {
  DIAGNOSIS_CERT: '진단서',
  OUTPATIENT_CONFIRMATION: '통원확인서',
  TREATMENT_CONFIRMATION: '진료확인서',
  RECEIPT_AND_ITEMIZED: '영수증 · 세부내역서',
  INITIAL_EXAM_RECORD: '초진기록지',
  ADMISSION_DISCHARGE_CONFIRMATION: '입퇴원확인서',
  MEDICAL_OPINION: '소견서',
  IMAGING_READING: '판독지',
  BIOPSY_RESULT: '조직검사결과지',
};

export interface DocLineView {
  readonly key: DocumentLineKey;
  readonly name: string;
  /** 이번 청구에 필요한 줄(체크 표시). */
  readonly required: boolean;
  /** 필요한 줄의 사유(응답의 문장, 우선순위 순). 필요 없는 줄과 사유가 없는 줄은 빈 배열이다. */
  readonly reasons: readonly string[];
}

export interface DocEntry {
  readonly scope: DocScope;
  readonly line: DocLineView;
}

export interface DocumentsView {
  /** 원인 모름 화면(K07_Documents_Unknown)인가. */
  readonly unknownCause: boolean;
  /** false 이면 서류 규칙을 쓸 수 없거나 목록을 믿을 수 없다: 화면은 목록 대신 안내 문구를 그린다(entries 는 비어 있다). */
  readonly available: boolean;
  /** 운영이 아닌 자료(응답 또는 서류의 origin !== OPERATING)로 만든 안내인가 (AC-010e). */
  readonly testData: boolean;
  /** "상해 · 손해보험사 · 통원". */
  readonly claimBasis: string;
  readonly treatmentSummary: string;
  /** 가로형의 한 줄: "상해 · 손해보험사 · 통원 · 치료 4개". */
  readonly compactLine: string;
  /** 읽는 순서의 줄: 단일 원인은 고정 9줄 순서, 원인 모름은 공통(필요한 줄 먼저) → 상해 전용 → 질병 전용. */
  readonly entries: readonly DocEntry[];
  readonly hint: string;
}

const SCOPES: readonly DocScope[] = ['COMMON', 'INJURY_ONLY', 'ILLNESS_ONLY'];

function isLineKey(value: unknown): value is DocumentLineKey {
  return typeof value === 'string' && (DOCUMENT_LINE_KEYS as readonly string[]).includes(value);
}

function isScope(value: unknown): value is DocScope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value);
}

interface ParsedLine {
  readonly key: DocumentLineKey;
  readonly required: boolean;
  readonly reasons: readonly string[];
  readonly scope: DocScope | null;
}

/** 응답 줄 하나를 읽는다. 알 수 없는 줄·불리언이 아닌 필요 여부·문자열이 아닌 사유가 있으면 null (그 목록 전체를 쓰지 않는다). */
function parseLine(value: unknown): ParsedLine | null {
  if (!isRecord(value) || !isLineKey(value.line) || typeof value.required !== 'boolean') return null;
  const rawReasons: unknown = value.reasons;
  if (rawReasons !== undefined && (!Array.isArray(rawReasons) || !rawReasons.every((reason) => typeof reason === 'string'))) return null;
  const reasons = ((rawReasons ?? []) as string[]).filter((reason) => reason.trim() !== '');
  return { key: value.line, required: value.required, reasons, scope: isScope(value.scope) ? value.scope : null };
}

/** 응답의 서류 줄을 읽는다: 고정 아홉 줄이 정확히 한 번씩일 때만 줄을 돌려주고, 아니면 null. */
function parseLines(value: unknown): ParsedLine[] | null {
  const lines = list(value as readonly unknown[] | undefined).map(parseLine);
  if (lines.length !== DOCUMENT_LINE_KEYS.length || lines.some((line) => line === null)) return null;
  const parsed = lines as ParsedLine[];
  return new Set(parsed.map((line) => line.key)).size === DOCUMENT_LINE_KEYS.length ? parsed : null;
}

const toLine = (line: ParsedLine): DocLineView => ({ key: line.key, name: DOCUMENT_NAME[line.key], required: line.required, reasons: line.reasons });
const byFixedOrder = (a: ParsedLine, b: ParsedLine): number => DOCUMENT_LINE_KEYS.indexOf(a.key) - DOCUMENT_LINE_KEYS.indexOf(b.key);

/** 읽는 순서의 줄. 원인 모름의 공통 묶음은 필요한 줄이 먼저다(고정 줄 순서 안에서). */
function orderEntries(lines: readonly ParsedLine[], unknownCause: boolean): DocEntry[] | null {
  if (!unknownCause) return [...lines].sort(byFixedOrder).map((line) => ({ scope: 'COMMON' as const, line: toLine(line) }));
  if (lines.some((line) => line.scope === null)) return null;
  return SCOPES.flatMap((scope) => {
    const inScope = lines.filter((line) => line.scope === scope).sort(byFixedOrder);
    const ordered = scope === 'COMMON' ? [...inScope.filter((line) => line.required), ...inScope.filter((line) => !line.required)] : inScope;
    return ordered.map((line) => ({ scope, line: toLine(line) }));
  });
}

/**
 * 필요 서류 화면의 값. 저장된 응답이 없으면 null (화면은 안내 화면으로 간다). 응답은 있으나 서류가 없거나(RULES_UNAVAILABLE·보류의 null) 모양이 맞지 않으면
 * available=false 이고 줄이 없다: 화면은 서류 목록 대신 안내 문구를 보인다(plan.md §E #18).
 */
export function buildDocumentsView(state: KioskState): DocumentsView | null {
  const response = state.derived.estimate?.response;
  if (response === undefined) return null;
  const unknownCause = state.inputs.cause === 'UNKNOWN';
  const selection = describeSelection(state, response);
  const claimBasis = [causeWord(state.inputs.cause), selection.insurerLabel, COPY.documents.setting].flatMap((part) => part ?? []).join(' · ');

  const documents: unknown = response.documents;
  const raw = isRecord(documents) && documents.state === 'AVAILABLE' && documents.mode === (unknownCause ? 'UNKNOWN_CAUSE' : 'SINGLE_CAUSE') ? documents : null;
  const parsed = raw === null ? null : parseLines(raw.lines);
  const entries = parsed === null ? null : orderEntries(parsed, unknownCause);

  const namesOf = (scope: DocScope): string[] => (entries ?? []).filter((entry) => entry.scope === scope).map((entry) => entry.line.name);
  const documentOrigin = raw === null ? undefined : raw.origin;
  return {
    unknownCause,
    available: entries !== null,
    testData: response.origin !== 'OPERATING' || (raw !== null && documentOrigin !== 'OPERATING'),
    claimBasis,
    treatmentSummary: selection.treatmentSummary,
    compactLine: `${claimBasis} · 치료 ${selection.treatmentNames.length}개`,
    entries: entries ?? [],
    hint: unknownCause && entries !== null ? COPY.documents.hintUnknown(namesOf('INJURY_ONLY'), namesOf('ILLNESS_ONLY')) : COPY.documents.hintBase,
  };
}

// ───────────── 쪽 나눔 ─────────────

/**
 * 한 쪽의 줄 수. 아홉 줄은 일반 글자의 세로·가로에서 한 쪽에 들어간다(디자인 K07_Documents·L_K07_Documents). 큰 글자 보기는 글자·여백이 커져 나눈다(DD-12):
 * 어떤 크기에서도 줄을 빼지 않고 "이전 목록 / 다음 목록" 으로 이어 본다. 줄 수는 레이아웃이 정하는 값이라 이 한 곳에 둔다.
 * 가로형 큰 글자의 원인 모름 목록은 공통 묶음이 두 열이라 같은 줄 수가 더 높아져 한 쪽 줄 수를 줄인다(브라우저 시험이 운영 자료 모양에서 스크롤 없이 들어가는 값을 잰다).
 */
export const DOCUMENT_PAGE_SIZE = {
  portrait: { normal: 9, largeText: 6 },
  landscape: { normal: 9, largeText: 6, largeTextUnknown: 4 },
} as const;

export function pageSizeFor(display: Pick<DisplayState, 'orientation' | 'largeText'>, unknownCause = false): number {
  if (display.orientation === 'LANDSCAPE') {
    const sizes = DOCUMENT_PAGE_SIZE.landscape;
    return display.largeText ? (unknownCause ? sizes.largeTextUnknown : sizes.largeText) : sizes.normal;
  }
  return display.largeText ? DOCUMENT_PAGE_SIZE.portrait.largeText : DOCUMENT_PAGE_SIZE.portrait.normal;
}

export interface DocumentPage {
  readonly items: readonly DocEntry[];
  readonly pageIndex: number;
  readonly pageCount: number;
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
}

/** 위치(offset, 보던 첫 줄의 순번)가 든 쪽: 쪽 크기가 바뀌어도 보던 줄이 보인다. 범위를 벗어난 위치는 마지막 쪽이다(빈 쪽이 없다). */
export function pageOfDocuments(entries: readonly DocEntry[], offset: number, pageSize: number): DocumentPage {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(entries.length / size));
  const pageIndex = Math.min(Math.floor(Math.max(0, offset) / size), pageCount - 1);
  return { items: entries.slice(pageIndex * size, (pageIndex + 1) * size), pageIndex, pageCount, hasPrev: pageIndex > 0, hasNext: pageIndex < pageCount - 1 };
}

export interface DocGroupView {
  readonly scope: DocScope;
  readonly title: string;
  readonly lines: readonly DocLineView[];
}

const GROUP_TITLE: Readonly<Record<DocScope, string>> = { COMMON: COPY.documents.groupCommon, INJURY_ONLY: COPY.documents.groupInjury, ILLNESS_ONLY: COPY.documents.groupIllness };

/** 쪽 안의 줄을 범위별 묶음으로 나눈다(묶음 순서: 공통 → 상해 전용 → 질병 전용, 줄이 없는 묶음은 없다). 쪽이 묶음을 가로질러도 머리글이 그 쪽에 다시 붙는다. */
export function groupOfPage(items: readonly DocEntry[]): DocGroupView[] {
  return SCOPES.flatMap((scope) => {
    const lines = items.filter((entry) => entry.scope === scope).map((entry) => entry.line);
    return lines.length === 0 ? [] : [{ scope, title: GROUP_TITLE[scope], lines }];
  });
}
