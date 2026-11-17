import { describe, expect, it } from 'vitest';
import { estimateFront } from '../../src/engine/estimate';
import type { FrontFunctions } from '../../src/engine/estimate';
import { checkProfileStructure } from '../../src/engine/profile-structure';
import { resolveMapping, resolveProfile } from '../../src/engine/resolve';
import { isBundleUsable, isUsable } from '../../src/engine/usability';
import type { EstimateInput, RuleBundleSnapshot } from '../../src/engine/types';
import { makeMapping } from '../fixtures/engine/mappings.fixture';
import { makeProfile, testDigest } from '../fixtures/engine/profiles.fixture';
import { T_INJECT, T_PHYSIO, T_ULTRA, T_XRAY, bundleWith, exampleLines, makeBundle, makeInput } from '../fixtures/engine/lines.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이나 승인 기록이 아니다.
// 묶음 단위 선행 판정과 호출 순서를 호출 감시로 시험한다 (AC-008f, AC-008g, AC-008l).
// 서류(deriveDocuments)는 estimate() 앞단의 일부가 아니므로 "서류는 null" 은 M2 가 맡는다.

/** 실제 함수를 감싸 호출 순서를 기록한다. */
function instrument() {
  const events: string[] = [];
  const functions: FrontFunctions = {
    isBundleUsable: (bundle) => {
      events.push('isBundleUsable');
      return isBundleUsable(bundle);
    },
    resolveProfile: (bundle, cell, ctx, deps) => {
      events.push('resolveProfile');
      return resolveProfile(bundle, cell, ctx, deps);
    },
    isUsable: (item, ctx) => {
      events.push(`isUsable:${item.kind}`);
      return isUsable(item, ctx);
    },
    checkProfileStructure: (profile) => {
      events.push('checkProfileStructure');
      return checkProfileStructure(profile);
    },
    resolveMapping: (line, bundle, cell, ctx, deps) => {
      events.push(`resolveMapping:${line.treatmentId}`);
      return resolveMapping(line, bundle, cell, ctx, deps);
    },
  };
  return { events, functions };
}

function run(input: EstimateInput) {
  const { events, functions } = instrument();
  const result = estimateFront(input, { digest: testDigest, functions });
  if (!result.ok) throw new Error(`거절되었다: ${result.rejection.code}`);
  return { front: result.front, events };
}

/** 사용 불가인 프로필(DRAFT)과 사용 불가인 매핑이 든 묶음. */
function unusableContents(status: RuleBundleSnapshot['status']): RuleBundleSnapshot {
  return bundleWith(
    makeProfile({ state: 'DRAFT' }),
    [T_XRAY, T_ULTRA, T_PHYSIO, T_INJECT].map((id) => makeMapping(id, { state: 'DRAFT' })),
    status,
  );
}

describe('AC-008f 규칙 사용 범위가 없는 입력 (bundle = null)', () => {
  it('모든 줄이 CLINIC_RULE_SCOPE_ABSENT 로 보류되고 항목 판정이 한 번도 일어나지 않는다', () => {
    const { front, events } = run(makeInput({ bundle: null }));
    expect(front.blocked).toBe('CLINIC_RULE_SCOPE_ABSENT');
    expect(front.lines.map((decision) => decision.holdReason)).toEqual(Array(4).fill('CLINIC_RULE_SCOPE_ABSENT'));
    expect(front.hasHold).toBe(true);
    expect(front.validated.hospitalPayment).toBe(124_000);
    expect(events).toEqual(['isBundleUsable']);
  });
});

describe('AC-008g 게시된 뒤 중지된 규칙 묶음', () => {
  it('SUSPENDED 이면 모든 줄이 RULE_BUNDLE_SUSPENDED 이고 병원 결제액은 숫자다 (프로필·매핑이 사용 가능해도)', () => {
    const { front } = run(makeInput({ bundle: makeBundle({ status: 'SUSPENDED' }) }));
    expect(front.blocked).toBe('RULE_BUNDLE_SUSPENDED');
    expect(front.lines.every((decision) => decision.state === 'ON_HOLD' && decision.holdReason === 'RULE_BUNDLE_SUSPENDED')).toBe(true);
    expect(front.hasHold).toBe(true);
    expect(front.validated.hospitalPayment).toBe(124_000);
  });

  it('같은 내용의 ACTIVE 묶음은 정상 판정된다 (중지 전과 같은 버전 id·내용 해시)', () => {
    const active = makeBundle();
    const suspended = makeBundle({ status: 'SUSPENDED' });
    expect(suspended.id).toBe(active.id);
    expect(suspended.contentHash).toBe(active.contentHash);
    const { front } = run(makeInput({ bundle: active }));
    expect(front.blocked).toBeNull();
    expect(front.hasHold).toBe(false);
  });

  it('판정 순서: 묶음이 중지이고 프로필도 사용 불가이면 RULE_BUNDLE_SUSPENDED 가 이긴다', () => {
    const { front } = run(makeInput({ bundle: unusableContents('SUSPENDED') }));
    expect(front.blocked).toBe('RULE_BUNDLE_SUSPENDED');
  });
});

describe('AC-008l 묶음 단위 선행 판정과 호출 순서', () => {
  it('SUSPENDED 이면 사용 불가 프로필·매핑이 든 묶음에서도 isUsable·프로필 칸 조회·구조 검사·resolveMapping 호출이 0회다', () => {
    const { events, front } = run(makeInput({ bundle: unusableContents('SUSPENDED') }));
    expect(events).toEqual(['isBundleUsable']);
    expect(front.blocked).toBe('RULE_BUNDLE_SUSPENDED');
  });

  it('bundle = null 이면 CLINIC_RULE_SCOPE_ABSENT 이고 isUsable 호출이 0회다', () => {
    const { events } = run(makeInput({ bundle: null }));
    expect(events.filter((event) => event.startsWith('isUsable'))).toEqual([]);
  });

  it('묶음 안의 항목(profiles·mappings·documentRuleSet)을 읽으면 던지는 접근자를 단 묶음에서도 중지 결과가 나온다', () => {
    const trap = (name: string) => () => {
      throw new Error(`묶음 안의 ${name} 을 읽었다`);
    };
    const bundle = { id: 'TEST_BUNDLE_TRAP', contentHash: 'TEST_HASH', status: 'SUSPENDED' } as RuleBundleSnapshot;
    for (const key of ['profiles', 'mappings', 'documentRuleSet']) {
      Object.defineProperty(bundle, key, { get: trap(key) });
    }
    const { front, events } = run(makeInput({ bundle }));
    expect(front.blocked).toBe('RULE_BUNDLE_SUSPENDED');
    expect(events).toEqual(['isBundleUsable']);
  });

  it('ACTIVE 이면 호출 순서가 isBundleUsable → 프로필 칸 조회 → 프로필 isUsable → 구조 검사 → 줄마다(resolveMapping → 후보별 isUsable) 이다', () => {
    const { events } = run(makeInput());
    expect(events).toEqual([
      'isBundleUsable',
      'resolveProfile',
      'isUsable:PROFILE',
      'checkProfileStructure',
      `resolveMapping:${T_INJECT}`,
      'isUsable:MAPPING',
      `resolveMapping:${T_PHYSIO}`,
      'isUsable:MAPPING',
      `resolveMapping:${T_ULTRA}`,
      'isUsable:MAPPING',
      `resolveMapping:${T_XRAY}`,
      'isUsable:MAPPING',
    ]);
  });

  it('프로필이 사용 불가이면 구조 검사와 줄 판정으로 넘어가지 않는다', () => {
    const { events } = run(makeInput({ bundle: bundleWith(makeProfile({ state: 'DRAFT' })) }));
    expect(events).toEqual(['isBundleUsable', 'resolveProfile', 'isUsable:PROFILE']);
  });

  it('프로필 구조 결함이면 줄 판정으로 넘어가지 않는다', () => {
    const { events } = run(makeInput({ bundle: bundleWith(makeProfile({ groupOrder: [] })) }));
    expect(events).toEqual(['isBundleUsable', 'resolveProfile', 'isUsable:PROFILE', 'checkProfileStructure']);
  });

  it('줄 출처나 분류에서 이미 보류된 줄은 매핑 조회를 하지 않는다', () => {
    const lines = exampleLines().map((line) => {
      if (line.treatmentId === T_INJECT) return { ...line, origin: 'DEMO' as const };
      if (line.treatmentId === T_ULTRA) return { ...line, calcClass: 'NEEDS_REVIEW' as const };
      return line;
    });
    const { events } = run(
      makeInput({ lines, acceptedOrigins: { rules: ['OPERATING', 'TEST_FIXTURE'], lines: ['OPERATING', 'TEST_FIXTURE'] } }),
    );
    expect(events.filter((event) => event.startsWith('resolveMapping'))).toEqual([
      `resolveMapping:${T_PHYSIO}`,
      `resolveMapping:${T_XRAY}`,
    ]);
  });
});
