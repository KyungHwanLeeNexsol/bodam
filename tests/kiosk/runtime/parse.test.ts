import { describe, expect, it } from 'vitest';
import { parseCatalog, parseOptions } from '../../../src/app/kiosk/runtime/parse';
import { makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';

// 시작 단계의 응답 읽기 (BRIEF D2): 계약의 모양이면 받고, 아니면 null 이다. 일부만 맞는 값을 기본값으로 메우지 않는다.

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const withField = (base: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> => {
  const copy = clone(base);
  let target = copy as Record<string, unknown>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
  const last = path[path.length - 1] as string;
  if (value === undefined) delete target[last];
  else target[last] = value;
  return copy;
};

const CATALOG = makeCatalog() as unknown as Record<string, unknown>;
const OPTIONS = makeOptions() as unknown as Record<string, unknown>;

describe('parseCatalog', () => {
  it('올바른 응답은 그대로 받는다', () => {
    expect(parseCatalog(CATALOG)).toEqual(CATALOG);
  });

  it('서버가 칸을 더 보내도 받는다 (계약에 없는 칸은 허용한다)', () => {
    const extra = { ...clone(CATALOG), extra: 'EXTRA_FIELD', clinic: { ...(CATALOG.clinic as object), motto: 'EXTRA' } };
    expect(parseCatalog(extra)).not.toBeNull();
  });

  it('catalogVersion 이 null 인 응답(게시한 적 없음)과 치료가 없는 응답은 모양으로는 올바르다 (치료 없음 판정은 읽은 뒤의 일이다)', () => {
    expect(parseCatalog(withField(CATALOG, ['catalogVersion'], null))).not.toBeNull();
    expect(parseCatalog({ ...clone(CATALOG), treatments: [] })).not.toBeNull();
  });

  const bad: Array<[string, unknown]> = [
    ['객체가 아님(null)', null],
    ['객체가 아님(문자열)', 'catalog'],
    ['배열', []],
    ['clinic 없음', withField(CATALOG, ['clinic'], undefined)],
    ['clinic.slug 없음', withField(CATALOG, ['clinic', 'slug'], undefined)],
    ['clinic.slug 가 빈 글자', withField(CATALOG, ['clinic', 'slug'], '  ')],
    ['clinic.displayName 이 숫자', withField(CATALOG, ['clinic', 'displayName'], 7)],
    ['clinic.setting 이 계약 밖', withField(CATALOG, ['clinic', 'setting'], 'INPATIENT')],
    ['serviceDisplayName 없음', withField(CATALOG, ['serviceDisplayName'], undefined)],
    ['serviceDisplayName 이 빈 글자', withField(CATALOG, ['serviceDisplayName'], '')],
    ['catalogVersion 이 숫자', withField(CATALOG, ['catalogVersion'], 3)],
    ['catalogVersion 칸 자체가 없음', withField(CATALOG, ['catalogVersion'], undefined)],
    ['baseFeeIncluded 가 계약 밖', withField(CATALOG, ['baseFeeIncluded'], 'YES')],
    ['idlePolicy 가 객체가 아님', withField(CATALOG, ['idlePolicy'], 'DD10')],
    ['treatments 가 배열이 아님', withField(CATALOG, ['treatments'], {})],
    ['treatments 없음', withField(CATALOG, ['treatments'], undefined)],
    ['baseFees 없음', withField(CATALOG, ['baseFees'], undefined)],
    ['치료 하나의 patientAmount 가 문자열', withField(CATALOG, ['treatments', '0', 'patientAmount'], '10000')],
    ['치료 하나의 patientAmount 가 음수', withField(CATALOG, ['treatments', '0', 'patientAmount'], -1)],
    ['치료 하나의 patientAmount 가 소수', withField(CATALOG, ['treatments', '0', 'patientAmount'], 10.5)],
    ['치료 하나의 benefitType 이 계약 밖', withField(CATALOG, ['treatments', '0', 'benefitType'], 'COVERED')],
    ['치료 하나의 treatmentId 없음', withField(CATALOG, ['treatments', '0', 'treatmentId'], undefined)],
    ['치료 하나의 displayName 이 빈 글자', withField(CATALOG, ['treatments', '0', 'displayName'], '')],
    ['치료 하나의 order 가 문자열', withField(CATALOG, ['treatments', '0', 'order'], '1')],
    ['치료 목록 안에 객체가 아닌 칸', { ...clone(CATALOG), treatments: [...(CATALOG.treatments as unknown[]), 'TEST_FIXTURE'] }],
    ['치료 id 가 서로 같음 (선택이 어느 쪽인지 알 수 없다)', { ...clone(CATALOG), treatments: [(CATALOG.treatments as unknown[])[0], (CATALOG.treatments as unknown[])[0]] }],
    ['기본비용 amount 가 문자열', { ...clone(CATALOG), baseFees: [{ baseFeeId: 'F1', displayName: '기본비용', benefitType: 'BENEFIT', amount: '5000' }] }],
    ['기본비용 id 가 서로 같음', { ...clone(CATALOG), baseFees: [1, 2].map(() => ({ baseFeeId: 'F1', displayName: '기본비용', benefitType: 'BENEFIT', amount: 5000 })) }],
    ['치료와 기본비용을 모두 고르면 합계가 안전한 범위를 넘는다', { ...clone(CATALOG), treatments: [{ ...(CATALOG.treatments as Array<Record<string, unknown>>)[0], patientAmount: Number.MAX_SAFE_INTEGER }, { ...(CATALOG.treatments as Array<Record<string, unknown>>)[1], patientAmount: 1 }] }],
  ];
  it.each(bad)('읽을 수 없는 응답: %s → null', (_name, body) => {
    expect(parseCatalog(body)).toBeNull();
  });
});

describe('parseOptions', () => {
  it('올바른 응답은 그대로 받는다', () => {
    expect(parseOptions(OPTIONS)).toEqual(OPTIONS);
  });

  it('서버가 칸을 더 보내도 받는다', () => {
    const generations = (OPTIONS.generations as Array<Record<string, unknown>>).map((card) => ({ ...card, note: 'EXTRA' }));
    expect(parseOptions({ ...clone(OPTIONS), generations, extra: true })).not.toBeNull();
  });

  it('규칙 묶음이 중지(SUSPENDED)이거나 없어도(null) 받는다: 시작 실패가 아니라 계산이 보류로 끝나는 일이다', () => {
    expect(parseOptions(withField(OPTIONS, ['ruleBundleStatus'], 'SUSPENDED'))).not.toBeNull();
    expect(parseOptions({ ...clone(OPTIONS), ruleBundleStatus: null, ruleBundleVersion: null })).not.toBeNull();
  });

  const bad: Array<[string, unknown]> = [
    ['객체가 아님', null],
    ['ruleBundleVersion 이 숫자', withField(OPTIONS, ['ruleBundleVersion'], 1)],
    ['ruleBundleVersion 칸 없음', withField(OPTIONS, ['ruleBundleVersion'], undefined)],
    ['ruleBundleStatus 가 계약 밖', withField(OPTIONS, ['ruleBundleStatus'], 'PAUSED')],
    ['guidance 없음', withField(OPTIONS, ['guidance'], undefined)],
    ['guidance.generationUnknown 이 숫자', withField(OPTIONS, ['guidance', 'generationUnknown'], 5)],
    ['generations 없음', withField(OPTIONS, ['generations'], undefined)],
    ['generations 가 빈 목록', withField(OPTIONS, ['generations'], [])],
    ['insurerTypes 가 빈 목록', withField(OPTIONS, ['insurerTypes'], [])],
    ['causes 가 빈 목록', withField(OPTIONS, ['causes'], [])],
    ['세대 코드가 계약 밖 (5번째 세대 카드를 만들지 않는다)', withField(OPTIONS, ['generations', '0', 'code'], 'GEN5_C5')],
    ['세대 label 이 빈 글자', withField(OPTIONS, ['generations', '0', 'label'], ' ')],
    ['세대 period 없음', withField(OPTIONS, ['generations', '0', 'period'], undefined)],
    ['보험사 형태 코드가 계약 밖', withField(OPTIONS, ['insurerTypes', '0', 'code'], 'BANK')],
    ['보험사 형태 help 가 숫자', withField(OPTIONS, ['insurerTypes', '0', 'help'], 0)],
    ['원인 코드가 계약 밖', withField(OPTIONS, ['causes', '0', 'code'], 'ACCIDENT')],
    ['세대 코드가 서로 같음', { ...clone(OPTIONS), generations: [(OPTIONS.generations as unknown[])[0], (OPTIONS.generations as unknown[])[0]] }],
    ['카드 목록 안에 객체가 아닌 칸', { ...clone(OPTIONS), causes: [...(OPTIONS.causes as unknown[]), 3] }],
  ];
  it.each(bad)('읽을 수 없는 응답: %s → null', (_name, body) => {
    expect(parseOptions(body)).toBeNull();
  });
});
