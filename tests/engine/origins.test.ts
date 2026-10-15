import { describe, expect, it } from 'vitest';
import { estimateFront } from '../../src/engine/estimate';
import type { EstimateFront } from '../../src/engine/estimate';
import type { EstimateInput, Origin } from '../../src/engine/types';
import { makeMapping } from '../fixtures/engine/mappings.fixture';
import { makeProfile, testDigest } from '../fixtures/engine/profiles.fixture';
import {
  T_BASE,
  T_INJECT,
  T_PHYSIO,
  T_ULTRA,
  T_XRAY,
  TEST_ACCEPTED_ORIGINS,
  bundleWith,
  exampleBaseFeeLine,
  exampleLines,
  makeInput,
} from '../fixtures/engine/lines.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이나 승인 기록이 아니다.
// AC-010a 시험 자료와 운영 데이터의 분리, AC-009b 지문 방어(계산 쪽).

const OPERATING_ONLY: { rules: Origin[]; lines: Origin[] } = { rules: ['OPERATING'], lines: ['OPERATING'] };
const IDS = [T_XRAY, T_ULTRA, T_PHYSIO, T_INJECT];

function front(input: EstimateInput): EstimateFront {
  const result = estimateFront(input, { digest: testDigest });
  if (!result.ok) throw new Error(`거절되었다: ${result.rejection.code}`);
  return result.front;
}

/** 운영 출처로만 이루어진 자료(프로필·매핑·줄이 모두 OPERATING). 값 자체는 시험용 가짜 값이다. */
function operatingInput(overrides: Partial<EstimateInput> = {}): EstimateInput {
  const lines = exampleLines().map((line) => ({ ...line, origin: 'OPERATING' as const }));
  const mappings = IDS.map((id) => makeMapping(id, { origin: 'OPERATING' }));
  return makeInput({
    lines,
    acceptedOrigins: { rules: [...OPERATING_ONLY.rules], lines: [...OPERATING_ONLY.lines] },
    bundle: bundleWith(makeProfile({ origin: 'OPERATING' }), mappings),
    ...overrides,
  });
}

describe('AC-010a 운영 허용 출처(규칙 OPERATING, 줄 OPERATING)', () => {
  it('운영 출처로만 이루어진 자료는 보류 없이 판정된다 (기준선)', () => {
    const result = front(operatingInput());
    expect(result.blocked).toBeNull();
    expect(result.hasHold).toBe(false);
  });

  it('TEST_FIXTURE 프로필 → 모든 줄 PROFILE_DEMO', () => {
    const input = operatingInput({
      bundle: bundleWith(
        makeProfile({ origin: 'TEST_FIXTURE' }),
        IDS.map((id) => makeMapping(id, { origin: 'OPERATING' })),
      ),
    });
    const result = front(input);
    expect(result.blocked).toBe('PROFILE_DEMO');
    expect(result.lines.every((decision) => decision.holdReason === 'PROFILE_DEMO')).toBe(true);
  });

  it('DEMO 프로필도 PROFILE_DEMO 다: 이름은 DEMO 이지만 허용되지 않은 모든 비운영 출처를 덮는다', () => {
    const input = operatingInput({
      bundle: bundleWith(makeProfile({ origin: 'DEMO' }), IDS.map((id) => makeMapping(id, { origin: 'OPERATING' }))),
    });
    expect(front(input).blocked).toBe('PROFILE_DEMO');
  });

  it('TEST_FIXTURE 매핑 → 그 줄만 MAPPING_INVALID', () => {
    const mappings = IDS.map((id) => makeMapping(id, { origin: id === T_INJECT ? 'TEST_FIXTURE' : 'OPERATING' }));
    const result = front(operatingInput({ bundle: bundleWith(makeProfile({ origin: 'OPERATING' }), mappings) }));
    expect(result.blocked).toBeNull();
    for (const decision of result.lines) {
      if (decision.line.treatmentId === T_INJECT) {
        expect(decision).toMatchObject({ state: 'ON_HOLD', holdReason: 'MAPPING_INVALID' });
      } else {
        expect(decision.state).toBe('ESTIMATED');
      }
    }
  });

  it('DEMO 치료 줄 → 그 줄만 LINE_ORIGIN_NOT_ACCEPTED', () => {
    const lines = exampleLines().map((line) => ({
      ...line,
      origin: line.treatmentId === T_INJECT ? ('DEMO' as const) : ('OPERATING' as const),
    }));
    const result = front(operatingInput({ lines }));
    for (const decision of result.lines) {
      if (decision.line.treatmentId === T_INJECT) {
        expect(decision).toMatchObject({ state: 'ON_HOLD', holdReason: 'LINE_ORIGIN_NOT_ACCEPTED' });
      } else {
        expect(decision.state).toBe('ESTIMATED');
      }
    }
  });

  it('TEST_FIXTURE 공통 기본비용 줄 → 그 줄만 LINE_ORIGIN_NOT_ACCEPTED 이고 금액은 병원 결제액에 들어간다', () => {
    const baseFee = exampleBaseFeeLine({ origin: 'TEST_FIXTURE' });
    const base = operatingInput();
    const mappings = [...IDS, T_BASE].map((id) => makeMapping(id, { origin: 'OPERATING' }));
    const result = front({
      ...base,
      baseFeeLines: [baseFee],
      bundle: bundleWith(makeProfile({ origin: 'OPERATING' }), mappings),
    });
    expect(result.validated.hospitalPayment).toBe(129_000);
    const entry = result.lines.find((decision) => decision.line.isBaseFee);
    expect(entry).toMatchObject({ state: 'ON_HOLD', holdReason: 'LINE_ORIGIN_NOT_ACCEPTED' });
    expect(result.lines.filter((decision) => !decision.line.isBaseFee).every((d) => d.state === 'ESTIMATED')).toBe(true);
  });

  it('시험 허용 출처에서는 같은 자료(TEST_FIXTURE 프로필·매핑, DEMO 치료 줄, TEST_FIXTURE 기본비용 줄)가 사용 가능하다', () => {
    const lines = exampleLines().map((line) => (line.treatmentId === T_INJECT ? { ...line, origin: 'DEMO' as const } : line));
    const baseFee = exampleBaseFeeLine({ origin: 'TEST_FIXTURE' });
    const mappings = [...IDS, T_BASE].map((id) => makeMapping(id));
    const result = front(
      makeInput({
        lines,
        baseFeeLines: [baseFee],
        bundle: bundleWith(makeProfile(), mappings),
        acceptedOrigins: { rules: [...TEST_ACCEPTED_ORIGINS.rules], lines: [...TEST_ACCEPTED_ORIGINS.lines] },
      }),
    );
    expect(result.blocked).toBeNull();
    expect(result.hasHold).toBe(false);
    expect(result.lines).toHaveLength(5);
  });
});

describe('AC-009b 지문 방어 — 상태 전환 없이 보장 판단 필드만 바뀐 치료 버전', () => {
  it('줄의 현재 coverageFingerprint 가 매핑의 approvedFingerprint 와 다르면 그 줄만 MAPPING_UNDER_REREVIEW 다', () => {
    const lines = exampleLines().map((line) =>
      line.treatmentId === T_INJECT ? { ...line, coverageFingerprint: 'TEST_FP_CHANGED_AFTER_APPROVAL' } : line,
    );
    const result = front(makeInput({ lines }));
    expect(result.hasHold).toBe(true);
    for (const decision of result.lines) {
      if (decision.line.treatmentId === T_INJECT) {
        expect(decision).toMatchObject({ state: 'ON_HOLD', holdReason: 'MAPPING_UNDER_REREVIEW' });
      } else {
        expect(decision.state).toBe('ESTIMATED');
      }
    }
  });

  it('지문이 같으면 정상이다 (대조)', () => {
    expect(front(makeInput()).hasHold).toBe(false);
  });

  it('가격(patientAmount)만 바뀌면 지문과 무관하게 판정이 바뀌지 않는다 (AC-009c 의 엔진 쪽)', () => {
    const lines = exampleLines().map((line) => (line.treatmentId === T_INJECT ? { ...line, patientAmount: 41_000 } : line));
    const result = front(makeInput({ lines }));
    expect(result.hasHold).toBe(false);
    expect(result.validated.hospitalPayment).toBe(125_000);
  });
});
