import { describe, expect, it } from 'vitest';
import type { Basis, EstimateResult } from '../../../src/engine/types';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { buildBasisView } from '../../../src/app/kiosk/view/basis-view';
import { POLICY_SOURCE, basisWith, estimatedResponse, holdResponse, notCoveredResponse, resultStateWith } from '../../fixtures/kiosk/estimate.fixture';
import type { EstimateResponseDto } from '../../../src/app/kiosk/state/api-types';

// 계산 근거 화면의 읽기 전용 값 (SPEC-REIMBURSEMENT-001 M6 S3b, design.md DD-22·DD-11, AC-014f, AC-013f, AC-010e).
// 값은 응답(result.lines·result.basis·assumptions·excludedItems)의 값 그대로이고 화면에 보험 계산이 없다. 응답에 없는 값은 지어내지 않고, 값이 없는 금액은 0원이 아니라 "확인 필요"다.

const at = (response: EstimateResponseDto, patch: Partial<KioskState> = {}): KioskState => ({ ...resultStateWith(response, patch), screen: 'K04_Basis_Calculation' });
const withBasis = (response: EstimateResponseDto, basis: Basis): EstimateResponseDto => ({ ...response, result: { ...response.result, basis } });
const withResult = (response: EstimateResponseDto, patch: Partial<EstimateResult>): EstimateResponseDto => ({ ...response, result: { ...response.result, ...patch } });

describe('정상 결과의 계산 근거 (AC-014f)', () => {
  const view = buildBasisView(at(estimatedResponse()));

  it('입력으로 확인한 것: 보험 조건·치료 원인과 치료 표(이름·구분·환자 결제액·보장 대상 여부)와 응답의 병원 결제액 합계', () => {
    expect(view?.variant).toBe('NORMAL');
    expect(view?.conditionRows).toEqual([
      { label: '보험 조건', value: '2세대(C1) · 손해보험사' },
      { label: '치료 원인', value: '상해' },
    ]);
    expect(view?.compactCondition).toBe('2세대(C1) · 손해보험사 · 상해 · 치료 4개');
    expect(view?.treatments.map((row) => [row.name, row.benefitLabel, row.amount, row.coverage])).toEqual([
      ['TEST_FIXTURE X-ray', '급여', '10,000원', '보장 대상'],
      ['TEST_FIXTURE 초음파', '급여', '4,000원', '보장 대상'],
      ['TEST_FIXTURE 신장분사치료', '비급여', '40,000원', '보장 대상'],
      ['TEST_FIXTURE 물리치료', '비급여', '70,000원', '보장 대상'],
    ]);
    expect(view?.hospitalTotal).toBe('124,000원');
  });

  it('가정으로 적용한 것: "(가정)" 이 붙은 공제·한도 줄과 응답의 예상 보험금', () => {
    expect(view?.groups).toHaveLength(1);
    expect(view?.groups[0]?.title).toBeNull();
    expect(view?.groups[0]?.rows.map((row) => [row.label, row.value])).toEqual([
      ['보장 대상 치료비 합계', '124,000원'],
      ['공제(가정)', '- 10,000원'],
      ['지급한도(가정)', '250,000원'],
    ]);
    expect(view?.payoutTotal).toBe('114,000원');
  });

  it('약관 출처: 문서·개정일·조항 또는 쪽만 보이고 확인자·확인일·효력일은 보이지 않는다 (외부 링크 없음)', () => {
    expect(view?.sources).toEqual([{ document: POLICY_SOURCE.insurerDocumentId, revision: '2026.01.01 개정', clause: POLICY_SOURCE.clauseOrPage }]);
    expect(JSON.stringify(view)).not.toMatch(/TEST_FIXTURE_VERIFIER|2026-01-02|http/);
  });

  it('적용한 계산 가정과 확인하지 않은 전제 문장이 있다 (개인 계약을 확인한 값처럼 쓰지 않는다)', () => {
    expect(view?.assumptions).toEqual(['환자에게 묻지 않고 2세대(C1) · 손해보험사 표준 가정값을 적용했습니다.', '선택한 치료가 모두 보장 대상이고 한도가 남아 있다고 가정했습니다.']);
    expect(view?.uncheckedPremise).toBe('개인별 공제·한도·특약·잔여 한도·면책 기간·부담보는 묻거나 조회하지 않았습니다. 실제 계약은 위 가정과 다를 수 있습니다.');
    expect(JSON.stringify(view)).not.toMatch(/환자분의 실손은|만 내면 됩니다/);
  });

  it('운영이 아닌 자료는 테스트 데이터 표시가 켜진다', () => {
    expect(view?.testData).toBe(true);
    expect(buildBasisView(at(estimatedResponse({ origin: 'OPERATING' })))?.testData).toBe(false);
  });

  it('디자인의 자리 표시 문장("디자인 예시")을 어디에도 싣지 않는다', () => {
    expect(JSON.stringify(view)).not.toMatch(/디자인 예시|구현 단계에서|표시되는 자리/);
  });
});

describe('보장 제외 결과의 계산 근거 (AC-014f)', () => {
  const view = buildBasisView(at(notCoveredResponse({ reason: '약관상 보장하지 않는 치료입니다' })));

  it('제외 항목은 "보장 제외"이고 보장 대상 치료비 합계에서 빠진 금액이 근거 줄에 그대로 있다', () => {
    expect(view?.variant).toBe('NOT_COVERED');
    expect(view?.treatments.map((row) => [row.name, row.coverage])).toEqual([
      ['TEST_FIXTURE X-ray', '보장 대상'],
      ['TEST_FIXTURE 초음파', '보장 대상'],
      ['TEST_FIXTURE 신장분사치료', '보장 제외'],
      ['TEST_FIXTURE 물리치료', '보장 대상'],
    ]);
    expect(view?.groups[0]?.rows[0]).toEqual(expect.objectContaining({ label: '보장 대상 치료비 합계', value: '84,000원' }));
    expect(view?.payoutTotal).toBe('74,000원');
  });

  it('제외 항목과 사유(응답의 값)가 있고 가정 문장은 나머지 항목 기준이다', () => {
    expect(view?.exclusions).toEqual([{ name: 'TEST_FIXTURE 신장분사치료', amount: '40,000원', reason: '약관상 보장하지 않는 치료입니다' }]);
    expect(view?.assumptions).toContain('나머지 항목은 보장 대상이고 한도가 남아 있다고 가정합니다.');
    expect(view?.assumptions.join(' ')).not.toContain('선택한 치료가 모두 보장 대상');
  });

  it('정상 결과에는 제외 항목이 없다', () => {
    expect(buildBasisView(at(estimatedResponse()))?.exclusions).toEqual([]);
  });
});

describe('공제·한도 줄: 응답의 값만 쓰고 계산하지 않는다 (DD-22)', () => {
  it('명목 공제와 실제 적용 공제가 다르면 둘 다 보인다', () => {
    const view = buildBasisView(at(withBasis(estimatedResponse(), basisWith({ E: 7_000, D: 10_000, D_applied: 7_000, P: 0 }))));
    expect(view?.groups[0]?.rows.map((row) => [row.label, row.value])).toEqual([
      ['보장 대상 치료비 합계', '7,000원'],
      ['공제(가정)', '10,000원'],
      ['실제 적용 공제', '- 7,000원'],
      ['지급한도(가정)', '250,000원'],
    ]);
  });

  it('한도가 없다고 명시된 그룹은 "한도 없음"이다', () => {
    const view = buildBasisView(at(withBasis(estimatedResponse(), basisWith({ E: 124_000, L: 'UNLIMITED', P: 114_000 }))));
    expect(view?.groups[0]?.rows.at(-1)).toEqual(expect.objectContaining({ label: '지급한도(가정)', value: '한도 없음' }));
  });

  it('그룹이 둘이면 묶음 이름과 그룹별 지급액이 붙고, 공유 한도가 적용되면 적용 후 지급액이 따로 보인다', () => {
    const basis: Basis = {
      ...basisWith({ E: 50_000, P: 40_000 }),
      steps: [
        { groupKey: 'G_A', E: 50_000, D: 10_000, D_applied: 10_000, L: 100_000, P: 40_000, P_pooled: 30_000, poolKey: 'POOL' },
        { groupKey: 'G_B', E: 20_000, D: 5_000, D_applied: 5_000, L: 100_000, P: 15_000, P_pooled: 15_000 },
      ],
    };
    const view = buildBasisView(at(withBasis(estimatedResponse(), basis)));
    expect(view?.groups.map((group) => group.title)).toEqual(['계산 묶음 1', '계산 묶음 2']);
    expect(view?.groups[0]?.rows.map((row) => [row.label, row.value])).toEqual([
      ['보장 대상 치료비 합계', '50,000원'],
      ['공제(가정)', '- 10,000원'],
      ['지급한도(가정)', '100,000원'],
      ['지급액', '40,000원'],
      ['공유 한도 적용 후 지급액', '30,000원'],
    ]);
    expect(view?.groups[1]?.rows.map((row) => row.label)).toEqual(['보장 대상 치료비 합계', '공제(가정)', '지급한도(가정)', '지급액']);
    expect(JSON.stringify(view)).not.toMatch(/G_A|G_B|POOL/);
  });

  it('값이 없는 칸(null)은 0원이 아니라 "확인 필요"다', () => {
    const basis = { ...basisWith({ E: 1, P: 1 }), steps: [{ groupKey: 'G', E: 1_000, D: null, D_applied: null, L: null, P: null, P_pooled: null }] } as unknown as Basis;
    const rows = buildBasisView(at(withBasis(estimatedResponse(), basis)))?.groups[0]?.rows ?? [];
    expect(rows.map((row) => row.value)).toEqual(['1,000원', '확인 필요', '확인 필요']);
    expect(JSON.stringify(rows)).not.toMatch(/(?<![\d,])0원/);
  });

  it('계산 단계가 응답에 없으면 공제·한도 표를 그리지 않고 없는 값을 지어내지 않는다', () => {
    for (const basis of [{ ruleBundleId: 'X', profile: null, steps: [] }, undefined, { steps: 'nope' }] as unknown as Basis[]) {
      const view = buildBasisView(at(withBasis(estimatedResponse(), basis)));
      expect(view?.groups).toEqual([]);
      expect(view?.sources).toEqual([]);
    }
  });

  it('약관 출처가 둘이면 둘 다 보이고, 날짜 형식이 아닌 개정일은 그대로 보인다', () => {
    const basis: Basis = {
      ...basisWith({ E: 1, P: 1 }),
      profile: { id: 'P', version: 'v', origin: 'TEST_FIXTURE', policySources: [{ ...POLICY_SOURCE }, { ...POLICY_SOURCE, insurerDocumentId: '문서 B', revisionDate: '2025 개정', clauseOrPage: '12쪽' }] },
    };
    expect(buildBasisView(at(withBasis(estimatedResponse(), basis)))?.sources).toEqual([
      { document: POLICY_SOURCE.insurerDocumentId, revision: '2026.01.01 개정', clause: POLICY_SOURCE.clauseOrPage },
      { document: '문서 B', revision: '2025 개정', clause: '12쪽' },
    ]);
  });
});

describe('보류·응답 없음: 근거를 지어내지 않는다', () => {
  it('보류 결과에는 계산 근거가 없다 (null)', () => {
    expect(buildBasisView(at(holdResponse()))).toBeNull();
  });

  it('저장된 응답이 없으면 null', () => {
    expect(buildBasisView({ ...at(estimatedResponse()), derived: { estimate: null, documents: null, basis: null, returnContext: null } })).toBeNull();
  });

  it('응답이 알아볼 수 없는 모양이어도 던지지 않는다 (줄·그룹·가정이 없는 정상 결과)', () => {
    const bare = withResult(estimatedResponse(), { lines: undefined as never, assumptions: undefined as never, excludedItems: undefined as never });
    const view = buildBasisView(at(bare));
    expect(view?.treatments).toEqual([]);
    expect(view?.assumptions).toEqual([]);
    expect(view?.hospitalTotal).toBe('124,000원');
  });

  it('알 수 없는 가정 코드는 화면에 나오지 않는다', () => {
    const view = buildBasisView(at(withResult(estimatedResponse(), { assumptions: ['STANDARD_PROFILE_APPLIED', 'BRAND_NEW_CODE' as never] })));
    expect(JSON.stringify(view)).not.toContain('BRAND_NEW_CODE');
  });
});
