import { estimate } from '../../../src/engine/estimate';
import type { EstimateInput } from '../../../src/engine/types';
import {
  CASE_A,
  CASE_B,
  CASE_C,
  CASE_D,
  CASE_D_ASSIGN,
  CASE_E,
  G_ONE,
  UNLIMITED,
  caseInput,
  group,
  perVisit,
} from './cases.fixture';
import { T_INJECT, T_PHYSIO, T_ULTRA, T_XRAY, exampleBaseFeeLine, makeLine } from './lines.fixture';
import { makeMapping } from './mappings.fixture';
import { testDigest } from './profiles.fixture';

// 시험 자료(TEST_FIXTURE). 결정성 시험(determinism.test.ts)과 새 프로세스 시험(child-run.ts)이 같은 입력 묶음을 쓴다.
// 공제·한도 숫자는 모두 시험용 가짜 값이며 실제 보험 값이 아니다. 이 파일은 Node 가 직접 읽을 수 있도록
// 지울 수 있는 TypeScript 문법(형식 표기)만 쓴다.

export interface CorpusEntry {
  name: string;
  input: EstimateInput;
}

const G_POOL_A = 'TEST_GROUP_POOL_A';
const G_POOL_B = 'TEST_GROUP_POOL_B';

/** 상태 종류(추정, 제외 포함, 보류, 거절, 범위 초과, 공유 한도 풀)를 고루 담은 입력 묶음. */
export function buildCorpus(): CorpusEntry[] {
  const base = caseInput({ groups: CASE_A });
  const partialMappings = [makeMapping(T_XRAY, { groupKey: G_ONE }), makeMapping(T_PHYSIO, { groupKey: G_ONE })];
  const bigLines = Array.from({ length: 901 }, (_unused, index) => makeLine(`T-BIG-${index}`, 1_000_000_000));

  return [
    { name: 'AC-002a 사례 A', input: base },
    { name: 'AC-002b 사례 B', input: caseInput({ groups: CASE_B }) },
    { name: 'AC-002c 사례 C', input: caseInput({ groups: CASE_C }) },
    { name: 'AC-002d 사례 D', input: caseInput({ groups: CASE_D, assign: CASE_D_ASSIGN }) },
    { name: 'AC-002e 사례 E (제외 항목)', input: caseInput({ groups: CASE_E, excluded: [T_INJECT] }) },
    { name: '공통 기본비용 포함', input: caseInput({ groups: CASE_A, baseFeeLines: [exampleBaseFeeLine()] }) },
    {
      name: '공유 한도 풀 (한도가 실제로 줄임) + ROUND_HALF_UP',
      input: caseInput({
        groups: [
          group(G_POOL_A, { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 1_000, rate: 1_500, rounding: 'TRUNCATE' }, perVisit(90_000), 'TEST_POOL'),
          group(
            G_POOL_B,
            { kind: 'SPLIT_RATE_WITH_FIXED_FLOOR', fixed: 2_000, rateBenefit: 1_000, rateNonBenefit: 2_500, rounding: 'ROUND_HALF_UP' },
            perVisit(80_000),
            'TEST_POOL',
          ),
        ],
        pools: [{ poolKey: 'TEST_POOL', limit: perVisit(60_000) }],
        assign: { [T_XRAY]: G_POOL_A, [T_ULTRA]: G_POOL_B, [T_PHYSIO]: G_POOL_A, [T_INJECT]: G_POOL_B },
      }),
    },
    {
      name: 'ROUND_HALF_UP 분리 공제, 한도 없음',
      input: caseInput({
        groups: [
          group(G_ONE, { kind: 'SPLIT_RATE_WITH_FIXED_FLOOR', fixed: 10_000, rateBenefit: 1_234, rateNonBenefit: 2_345, rounding: 'ROUND_HALF_UP' }, UNLIMITED),
        ],
      }),
    },
    { name: '보류 + 참고 그룹 (매핑 없는 줄)', input: caseInput({ groups: CASE_A, mappings: partialMappings }) },
    { name: '규칙 묶음 중지', input: { ...base, bundle: base.bundle === null ? null : { ...base.bundle, status: 'SUSPENDED' as const } } },
    { name: '유효 기간 밖 시각 (프로필 사용 불가)', input: { ...base, at: '2027-06-01' } },
    { name: '거절: 치료 없음', input: { ...base, treatmentIds: [], lines: [] } },
    { name: '거절: 줄 금액 무효', input: caseInput({ groups: CASE_A, lines: [makeLine('T-BAD', -5)] }) },
    {
      name: '계산 범위 초과 (RATE_PRODUCT)',
      input: caseInput({
        groups: [group(G_ONE, { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 1, rate: 10_000, rounding: 'TRUNCATE' }, UNLIMITED)],
        lines: bigLines,
      }),
    },
    {
      name: '코드 포인트 순서가 로케일 순서와 다른 치료 ID',
      input: caseInput({
        groups: CASE_B,
        lines: [makeLine('b', 5_000), makeLine('B', 7_000), makeLine('10', 12_000), makeLine('2', 8_000), makeLine('가', 3_000)],
      }),
    },
  ];
}

/** 주입된 시험용 해시와 함께 계산한 결과(거절 포함)를 JSON 문자열로 만든다. 바이트 비교의 대상이다. */
export function serializeOutcome(input: EstimateInput): string {
  return JSON.stringify(estimate(input, { digest: testDigest }));
}
