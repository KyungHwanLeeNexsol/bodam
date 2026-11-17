import { sumLineAmounts } from '../../../engine/numeric';
import type { CatalogDto, OptionsDto } from '../state/api-types';

// 시작 단계가 받은 catalog·options 응답의 엄격한 읽기 (SPEC-REIMBURSEMENT-001 M6, BRIEF D2).
// 모양이 계약과 다르면 null 이다. 호출하는 쪽은 null 을 "정보를 불러오지 못했어요"로 처리하고, 일부만 맞는 값·빈 값·기본값으로 화면을 열지 않는다.
// 계약에 없는 칸이 더 있는 것은 허용한다(서버가 칸을 더해도 키오스크가 깨지지 않는다). 있어야 할 칸이 없거나 형식이 다른 것은 허용하지 않는다.
// M5 의 갱신 응답 읽기(state/refresh.ts)는 같은 계약의 더 느슨한 읽기이고 이 단계에서는 바꾸지 않는다: 첫 화면은 더 엄격하게 시작한다.

type Fields = Record<string, unknown>;

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isLabel = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const isWon = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const BENEFIT_TYPES: readonly unknown[] = ['BENEFIT', 'NON_BENEFIT'];
const GENERATION_CODES: readonly unknown[] = ['GEN1_AS', 'GEN2_C1', 'GEN2_5_C2', 'GEN3_C3', 'GEN4_C4'];
const INSURER_TYPE_CODES: readonly unknown[] = ['NON_LIFE', 'LIFE', 'MUTUAL_AID'];
const CAUSE_CODES: readonly unknown[] = ['INJURY', 'ILLNESS', 'UNKNOWN'];

/** 배열의 모든 칸이 레코드이고 검사를 통과하며 `key` 값이 서로 다르다(같은 id·코드가 둘이면 선택이 어느 쪽인지 알 수 없다). */
function everyUnique(value: unknown, key: string, check: (entry: Fields) => boolean): value is Fields[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<unknown>();
  for (const entry of value as unknown[]) {
    if (!isRecord(entry) || !check(entry) || seen.has(entry[key])) return false;
    seen.add(entry[key]);
  }
  return true;
}

/** 치료와 기본비용을 모두 골라도 합계가 안전한 정수 범위 안이다(선택 요약이 합산하다 던지지 않는다). */
function sumsSafely(treatments: readonly Fields[], baseFees: readonly Fields[]): boolean {
  return sumLineAmounts([...treatments, ...baseFees].map((entry) => (entry.patientAmount ?? entry.amount) as number)).ok;
}

/** catalog 응답. 키오스크가 읽는 칸이 모두 계약의 모양일 때만 돌려준다. */
export function parseCatalog(body: unknown): CatalogDto | null {
  if (!isRecord(body) || !isRecord(body.clinic) || !isLabel(body.clinic.slug) || !isLabel(body.clinic.displayName) || body.clinic.setting !== 'OUTPATIENT_ONLY') return null;
  if (!isLabel(body.serviceDisplayName)) return null;
  if (!(body.catalogVersion === null || isLabel(body.catalogVersion))) return null;
  if (body.baseFeeIncluded !== 'INCLUDED' && body.baseFeeIncluded !== 'NOT_REGISTERED') return null;
  if (body.idlePolicy !== undefined && !isRecord(body.idlePolicy)) return null;
  const treatment = (entry: Fields): boolean =>
    isLabel(entry.treatmentId) && isLabel(entry.displayName) && isText(entry.description) && isText(entry.priceCondition) && BENEFIT_TYPES.includes(entry.benefitType) && isWon(entry.patientAmount) && typeof entry.order === 'number' && Number.isFinite(entry.order);
  const baseFee = (entry: Fields): boolean => isLabel(entry.baseFeeId) && isLabel(entry.displayName) && BENEFIT_TYPES.includes(entry.benefitType) && isWon(entry.amount);
  if (!everyUnique(body.treatments, 'treatmentId', treatment) || !everyUnique(body.baseFees, 'baseFeeId', baseFee)) return null;
  if (!sumsSafely(body.treatments, body.baseFees)) return null;
  return body as unknown as CatalogDto;
}

/** options 응답. 세 카드 목록은 각각 한 장 이상이고 코드는 계약의 값이며 서로 다르다. */
export function parseOptions(body: unknown): OptionsDto | null {
  if (!isRecord(body) || !(body.ruleBundleVersion === null || isLabel(body.ruleBundleVersion))) return null;
  if (!(body.ruleBundleStatus === null || body.ruleBundleStatus === 'ACTIVE' || body.ruleBundleStatus === 'SUSPENDED')) return null;
  if (!isRecord(body.guidance) || !isText(body.guidance.generationUnknown)) return null;
  const cards = (value: unknown, codes: readonly unknown[], extra: (entry: Fields) => boolean): boolean =>
    everyUnique(value, 'code', (entry) => codes.includes(entry.code) && isLabel(entry.label) && extra(entry)) && (value as unknown[]).length > 0;
  if (!cards(body.generations, GENERATION_CODES, (entry) => isText(entry.period))) return null;
  if (!cards(body.insurerTypes, INSURER_TYPE_CODES, (entry) => isText(entry.help))) return null;
  if (!cards(body.causes, CAUSE_CODES, (entry) => isText(entry.help))) return null;
  return body as unknown as OptionsDto;
}
