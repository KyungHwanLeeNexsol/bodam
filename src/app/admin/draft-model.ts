import type { BenefitType, DraftView, TreatmentAdditionView, TreatmentRow } from './api-types';

// 관리자 화면의 "원하는 초안 전체"를 다루는 순수 함수 (SPEC-REIMBURSEMENT-001 M7 구조 편집).
// 화면은 가격 글자·숨김·줄 순서·새 치료를 한 덩어리(WorkingState)로 들고 있고, 여기서 PUT 본문을 만들고 서버가 돌려준 초안과 구조로 비교한다.
// 서버가 정한 규칙을 같은 모양으로 따른다(순서의 기본값 = 남는 기존 치료는 지금 순서 그대로 + 새 치료를 적은 순서대로 뒤에, 같은 순서는 null 로 줄임, 현재 가격과 같은 가격 수정은 변경이 아님).
// 서버가 권위다: 여기 검사는 입력 실수를 먼저 알려 주는 용도이고, 보험금·한도·공제·보장 분류는 이 파일에 없다. 시계·무작위·저장소·네트워크를 쓰지 않는다.

export type NewTreatment = TreatmentAdditionView;

/** 화면이 들고 있는 원하는 초안 전체. 줄은 이름표(key)로 가리킨다: 기존 치료는 치료 id, 새 치료는 draftKey. */
export interface WorkingState {
  /** 기존 치료 id → 입력 중인 가격 글자. */
  priceTexts: Record<string, string>;
  /** 숨길 기존 치료 id. */
  hidden: string[];
  /** 새 치료(만든 순서). */
  additions: NewTreatment[];
  /** 화면에 보이는 모든 줄의 순서(숨긴 줄 포함). 서버로 나가는 순서는 이 가운데 숨기지 않은 줄이다. */
  rowOrder: string[];
}

/** PUT /catalog/draft 본문 = 원하는 초안 전체. */
export interface DraftBody {
  priceEdits: Array<{ treatmentId: string; patientAmount: number }>;
  additions: NewTreatment[];
  deactivations: string[];
  order: string[] | null;
}

export function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  const common = Math.min(left.length, right.length);
  for (let index = 0; index < common; index += 1) {
    const difference = (left[index] as string).codePointAt(0)! - (right[index] as string).codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

/** 서버의 Won 검사와 같은 뜻의 첫 걸음: 숫자만(앞뒤 공백 허용)이고 안전한 정수. 범위의 위쪽 한계는 서버가 가린다. */
export const isAmountText = (text: string): boolean => /^\d+$/.test(text.trim()) && Number.isSafeInteger(Number(text.trim()));

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** YYYY-MM-DD 이면서 달력에 실제로 있는 날짜인가(2026-02-30 은 아니다). 시계를 쓰지 않는 계산이다. */
export function isCalendarDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const last = month === 2 && leap ? 29 : (DAYS_IN_MONTH[month - 1] as number);
  return day <= last;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((entry, index) => entry === b[index]);

// ───────────────────────── 서버 응답 → 작업 상태 ─────────────────────────

/**
 * 서버가 준 치료 목록과 초안(없을 수 있다)으로 작업 상태를 다시 세운다. 초안이 있으면 초안의 값, 없으면 게시된 값이다.
 * 숨긴 줄은 초안의 순서에 없으므로, 게시 목록에서 바로 앞이던 줄 뒤에 놓아 화면에서 제자리 가까이에 남게 한다.
 */
export function restoreWorking(rows: readonly TreatmentRow[], draft: DraftView | null): WorkingState {
  const edits = new Map((draft?.priceEdits ?? []).map((edit) => [edit.treatmentId, edit.patientAmount]));
  const publishedIds = rows.map((row) => row.treatmentId);
  const hidden = draft === null ? [] : draft.deactivations.filter((id) => publishedIds.includes(id));
  const additions = draft === null ? [] : draft.additions.map((entry) => structuredClone(entry));
  const survivors = publishedIds.filter((id) => !hidden.includes(id));
  const additionKeys = additions.map((entry) => entry.draftKey);
  const defaultVisible = [...survivors, ...additionKeys];
  let visible = defaultVisible;
  if (draft !== null && draft.order !== null) {
    const known = new Set(defaultVisible);
    const kept = draft.order.filter((key, index) => known.has(key) && draft.order!.indexOf(key) === index);
    visible = [...kept, ...defaultVisible.filter((key) => !kept.includes(key))];
  }
  const rowOrder = [...visible];
  for (const id of publishedIds.filter((entry) => hidden.includes(entry))) {
    const at = publishedIds.indexOf(id);
    let anchor = -1;
    for (let before = at - 1; before >= 0 && anchor === -1; before -= 1) {
      anchor = rowOrder.indexOf(publishedIds[before] as string);
    }
    rowOrder.splice(anchor + 1, 0, id);
  }
  return {
    priceTexts: Object.fromEntries(rows.map((row) => [row.treatmentId, String(edits.get(row.treatmentId) ?? row.patientAmount)])),
    hidden,
    additions,
    rowOrder,
  };
}

// ───────────────────────── 작업 상태 → PUT 본문 ─────────────────────────

const isHidden = (working: WorkingState, key: string): boolean => working.hidden.includes(key);

/** 지금 화면에 보이는(숨기지 않은) 줄의 순서 = 서버로 보낼 순서 후보. */
export const visibleKeys = (working: WorkingState): string[] => working.rowOrder.filter((key) => !isHidden(working, key));

/** 기본 순서: 남는 기존 치료(게시된 순서) 뒤에 새 치료를 만든 순서대로. */
const defaultOrderOf = (rows: readonly TreatmentRow[], working: WorkingState): string[] => [
  ...rows.map((row) => row.treatmentId).filter((id) => !isHidden(working, id)),
  ...working.additions.map((entry) => entry.draftKey),
];

export function draftBodyOf(working: WorkingState, rows: readonly TreatmentRow[]): { body: DraftBody; invalid: boolean } {
  let invalid = false;
  const priceEdits: DraftBody['priceEdits'] = [];
  for (const row of rows) {
    if (isHidden(working, row.treatmentId)) continue;
    const text = working.priceTexts[row.treatmentId] ?? String(row.patientAmount);
    if (!isAmountText(text)) {
      invalid = true;
    } else if (Number(text.trim()) !== row.patientAmount) {
      priceEdits.push({ treatmentId: row.treatmentId, patientAmount: Number(text.trim()) });
    }
  }
  priceEdits.sort((a, b) => compareCodePoints(a.treatmentId, b.treatmentId));
  const finalOrder = visibleKeys(working);
  return {
    invalid,
    body: {
      priceEdits,
      additions: working.additions.map((entry) => structuredClone(entry)),
      deactivations: working.hidden.filter((id) => rows.some((row) => row.treatmentId === id)).sort(compareCodePoints),
      order: sameList(finalOrder, defaultOrderOf(rows, working)) ? null : finalOrder,
    },
  };
}

export const isEmptyBody = (body: DraftBody): boolean => body.priceEdits.length === 0 && body.additions.length === 0 && body.deactivations.length === 0 && body.order === null;

// ───────────────────────── 서버가 돌려준 초안과 구조 비교 ─────────────────────────

/** 키 순서가 고정된 새 치료 복사본: 서버가 돌려준 객체와 키 순서가 달라도 같은 글자열이 되게 한다. */
function normalizedAddition(entry: NewTreatment): NewTreatment {
  return {
    draftKey: entry.draftKey,
    displayName: entry.displayName,
    description: entry.description,
    benefitType: entry.benefitType,
    patientAmount: entry.patientAmount,
    treatmentCode: entry.treatmentCode,
    procedureCodes: [...entry.procedureCodes],
    documentFlags: { imaging: entry.documentFlags.imaging, biopsy: entry.documentFlags.biopsy, opinionRequired: entry.documentFlags.opinionRequired },
    amountCondition: { patientType: entry.amountCondition.patientType, assumption: entry.amountCondition.assumption, referenceDate: entry.amountCondition.referenceDate },
    effectiveDate: entry.effectiveDate,
  };
}

const normalizedBody = (body: DraftBody) =>
  JSON.stringify({
    priceEdits: [...body.priceEdits].sort((a, b) => compareCodePoints(a.treatmentId, b.treatmentId)).map((edit) => ({ treatmentId: edit.treatmentId, patientAmount: edit.patientAmount })),
    additions: body.additions.map(normalizedAddition),
    deactivations: [...body.deactivations].sort(compareCodePoints),
    order: body.order,
  });

/** 서버가 저장해 돌려준 초안을 비교용 본문 모양으로. 서버는 이미 정규형(같은 순서는 null)으로 저장한다. */
export const bodyOfDraft = (draft: DraftView): DraftBody => ({
  priceEdits: draft.priceEdits.map((edit) => ({ treatmentId: edit.treatmentId, patientAmount: edit.patientAmount })),
  additions: draft.additions.map((entry) => structuredClone(entry)),
  deactivations: [...draft.deactivations],
  order: draft.order === null ? null : [...draft.order],
});

export const sameBody = (a: DraftBody, b: DraftBody): boolean => normalizedBody(a) === normalizedBody(b);

// ───────────────────────── 줄 조작 ─────────────────────────

/** 가까운 "보이는" 줄의 자리(rowOrder 안). 숨긴 줄은 순서에 없으니 건너뛴다. 없으면 -1. */
function neighborIndex(working: WorkingState, key: string, direction: -1 | 1): number {
  const at = working.rowOrder.indexOf(key);
  if (at < 0 || isHidden(working, key)) return -1;
  for (let index = at + direction; index >= 0 && index < working.rowOrder.length; index += direction) {
    if (!isHidden(working, working.rowOrder[index] as string)) return index;
  }
  return -1;
}

export const canMove = (working: WorkingState, key: string, direction: -1 | 1): boolean => neighborIndex(working, key, direction) >= 0;

/** 줄을 보이는 이웃 하나 너머로 옮긴다(위: 이웃 앞, 아래: 이웃 뒤). 못 옮기면 같은 객체를 돌려준다. */
export function moveRow(working: WorkingState, key: string, direction: -1 | 1): WorkingState {
  const target = neighborIndex(working, key, direction);
  if (target < 0) return working;
  const rowOrder = [...working.rowOrder];
  rowOrder.splice(rowOrder.indexOf(key), 1);
  rowOrder.splice(target, 0, key);
  return { ...working, rowOrder };
}

export const toggleHidden = (working: WorkingState, treatmentId: string): WorkingState => ({
  ...working,
  hidden: isHidden(working, treatmentId) ? working.hidden.filter((id) => id !== treatmentId) : [...working.hidden, treatmentId],
});

export const appendAddition = (working: WorkingState, entry: NewTreatment): WorkingState => ({
  ...working,
  additions: [...working.additions, entry],
  rowOrder: [...working.rowOrder, entry.draftKey],
});

export const removeAddition = (working: WorkingState, draftKey: string): WorkingState => ({
  ...working,
  additions: working.additions.filter((entry) => entry.draftKey !== draftKey),
  rowOrder: working.rowOrder.filter((key) => key !== draftKey),
});

/** 새 치료의 이름표: new-1, new-2 … 이미 있는 가장 큰 번호 다음부터, 게시된 치료 id 와 겹치면 건너뛴다. 무작위·시계를 쓰지 않는다. */
export function nextDraftKey(working: WorkingState, rows: readonly TreatmentRow[]): string {
  let next = 1 + working.additions.reduce((max, entry) => Math.max(max, Number(/^new-(\d+)$/.exec(entry.draftKey)?.[1] ?? 0)), 0);
  const taken = new Set([...rows.map((row) => row.treatmentId), ...working.additions.map((entry) => entry.draftKey)]);
  while (taken.has(`new-${next}`)) next += 1;
  return `new-${next}`;
}

// ───────────────────────── 줄 보기 ─────────────────────────

export interface RowView {
  key: string;
  isNew: boolean;
  treatmentId: string | null;
  displayName: string;
  benefitType: BenefitType;
  /** 기존 치료의 게시된 가격. 새 치료는 null. */
  currentPrice: number | null;
  /** 기존 치료의 입력 글자. 새 치료는 null. */
  priceText: string | null;
  /** 새 치료의 가격. 기존 치료는 null. */
  newPrice: number | null;
  priceInvalid: boolean;
  priceChanged: boolean;
  hidden: boolean;
  /** 남는 기존 치료끼리의 순위가 달라졌는가(서버가 "순서 변경"으로 세는 것과 같다). */
  moved: boolean;
  /** 게시 뒤의 위치(1부터). 숨긴 줄은 null. */
  position: number | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export function rowViews(working: WorkingState, rows: readonly TreatmentRow[]): RowView[] {
  const byId = new Map(rows.map((row) => [row.treatmentId, row]));
  const byKey = new Map(working.additions.map((entry) => [entry.draftKey, entry]));
  const finalOrder = visibleKeys(working);
  const survivors = rows.map((row) => row.treatmentId).filter((id) => !isHidden(working, id));
  const survivorSet = new Set(survivors);
  const afterSurvivors = finalOrder.filter((key) => survivorSet.has(key));
  return working.rowOrder.flatMap((key): RowView[] => {
    const added = byKey.get(key);
    if (added !== undefined) {
      return [
        {
          key,
          isNew: true,
          treatmentId: null,
          displayName: added.displayName,
          benefitType: added.benefitType,
          currentPrice: null,
          priceText: null,
          newPrice: added.patientAmount,
          priceInvalid: false,
          priceChanged: false,
          hidden: false,
          moved: false,
          position: finalOrder.indexOf(key) + 1,
          canMoveUp: canMove(working, key, -1),
          canMoveDown: canMove(working, key, 1),
        },
      ];
    }
    const row = byId.get(key);
    if (row === undefined) return [];
    const hidden = isHidden(working, key);
    const text = working.priceTexts[key] ?? String(row.patientAmount);
    const valid = isAmountText(text);
    return [
      {
        key,
        isNew: false,
        treatmentId: key,
        displayName: row.displayName,
        benefitType: row.benefitType,
        currentPrice: row.patientAmount,
        priceText: text,
        newPrice: null,
        priceInvalid: !hidden && !valid,
        priceChanged: !hidden && valid && Number(text.trim()) !== row.patientAmount,
        hidden,
        moved: !hidden && survivors.indexOf(key) !== afterSurvivors.indexOf(key),
        position: hidden ? null : finalOrder.indexOf(key) + 1,
        canMoveUp: canMove(working, key, -1),
        canMoveDown: canMove(working, key, 1),
      },
    ];
  });
}

export interface BodySummary {
  priceChanged: number;
  added: number;
  hidden: number;
  reordered: boolean;
}

export const summaryOf = (body: DraftBody): BodySummary => ({ priceChanged: body.priceEdits.length, added: body.additions.length, hidden: body.deactivations.length, reordered: body.order !== null });

// ───────────────────────── 새 치료 입력칸 ─────────────────────────

/** 새 치료 입력칸의 글자들. 서류 표시 셋은 기본이 모두 꺼짐이다. */
export interface AddForm {
  displayName: string;
  description: string;
  benefitType: BenefitType;
  patientAmount: string;
  treatmentCode: string;
  /** 쉼표로 구분한 행위 코드. 비워도 된다. */
  procedureCodes: string;
  imaging: boolean;
  biopsy: boolean;
  opinionRequired: boolean;
  patientType: string;
  assumption: string;
  referenceDate: string;
  effectiveDate: string;
}

export const EMPTY_ADD_FORM: AddForm = {
  displayName: '',
  description: '',
  benefitType: 'BENEFIT',
  patientAmount: '',
  treatmentCode: '',
  procedureCodes: '',
  imaging: false,
  biopsy: false,
  opinionRequired: false,
  patientType: '',
  assumption: '',
  referenceDate: '',
  effectiveDate: '',
};

export type AddField = 'displayName' | 'patientAmount' | 'treatmentCode' | 'patientType' | 'assumption' | 'referenceDate' | 'effectiveDate';
export type AddError = 'REQUIRED' | 'AMOUNT' | 'DATE';

/** 입력칸을 서버 형식의 새 치료로 바꾼다. 서버가 거절하는 것(빈 값·가격 형식·날짜 형식)만 걸러 낸다. 글자는 앞뒤 공백을 다듬어 보낸다. */
export function buildAddition(form: AddForm, draftKey: string): { ok: true; addition: NewTreatment } | { ok: false; errors: Partial<Record<AddField, AddError>> } {
  const errors: Partial<Record<AddField, AddError>> = {};
  const required = (field: AddField, value: string): void => {
    if (value.trim() === '') errors[field] = 'REQUIRED';
  };
  required('displayName', form.displayName);
  required('treatmentCode', form.treatmentCode);
  required('patientType', form.patientType);
  required('assumption', form.assumption);
  if (!isAmountText(form.patientAmount)) errors.patientAmount = 'AMOUNT';
  if (!isCalendarDate(form.referenceDate.trim())) errors.referenceDate = 'DATE';
  if (!isCalendarDate(form.effectiveDate.trim())) errors.effectiveDate = 'DATE';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    addition: {
      draftKey,
      displayName: form.displayName.trim(),
      description: form.description.trim(),
      benefitType: form.benefitType,
      patientAmount: Number(form.patientAmount.trim()),
      treatmentCode: form.treatmentCode.trim(),
      procedureCodes: form.procedureCodes
        .split(',')
        .map((code) => code.trim())
        .filter((code) => code !== ''),
      documentFlags: { imaging: form.imaging, biopsy: form.biopsy, opinionRequired: form.opinionRequired },
      amountCondition: { patientType: form.patientType.trim(), assumption: form.assumption.trim(), referenceDate: form.referenceDate.trim() },
      effectiveDate: form.effectiveDate.trim(),
    },
  };
}

// ───────────────────────── 미리보기에서 계산할 치료 ─────────────────────────

/**
 * 미리보기의 "계산할 치료". 숨길 치료는 제안도 선택도 되지 않는다(서버도 TREATMENT_DEACTIVATED_IN_DRAFT 로 거절한다).
 * 저장된 초안이 가격을 바꾼 치료는 항상 들어간다(required). 나머지는 사용자가 고른 것만. 순서는 게시 목록 순서를 따른다.
 */
export function previewSelection(
  rows: readonly TreatmentRow[],
  draft: DraftView | null,
  picked: Readonly<Record<string, boolean>>,
): { offered: TreatmentRow[]; required: Set<string>; treatmentIds: string[] } {
  const hidden = new Set(draft?.deactivations ?? []);
  const offered = rows.filter((row) => !hidden.has(row.treatmentId));
  const required = new Set((draft?.priceEdits ?? []).map((edit) => edit.treatmentId));
  return {
    offered,
    required,
    treatmentIds: offered.filter((row) => required.has(row.treatmentId) || picked[row.treatmentId] === true).map((row) => row.treatmentId),
  };
}
