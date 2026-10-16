import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '../../src/server/digest';
import { COVERAGE_JUDGMENT_FIELDS, coverageFingerprint, coverageFingerprintOf } from '../../src/server/fingerprint';
import { makeTreatmentVersion } from '../fixtures/server/entities.fixture';

// DD-15 지문 방어 / DD-16 보장 판단 필드. 지문 = 해시(치료 코드, 행위 코드 목록, 급여 구분, 계산 분류).
// 가격·표시 이름은 지문에 들어가지 않는다.

const BASE = makeTreatmentVersion();

describe('지문 값 (known-answer)', () => {
  it('치료 코드·행위 코드·급여 구분·계산 분류의 정본 해시다', () => {
    // 구현과 별개로 규칙을 다시 풀어 쓴 스크립트로 한 번 계산해 굳힌 값이다 (digest.test.ts 와 같은 방식).
    expect(coverageFingerprintOf(BASE)).toBe('3c4de670a855c1dddf9ed0a90610ba59ef40a1724242932e222ab40f6032de0f');
  });

  it('canonicalDigest 로 만든 같은 내용 객체의 해시와 같다 (두 번째 해시 구현이 없다)', () => {
    expect(coverageFingerprint({ treatmentCode: 'TEST_FIXTURE_TC_1', procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_B'], benefitType: 'BENEFIT', calcClass: 'GENERAL_BENEFIT' })).toBe(
      canonicalDigest({
        treatmentCode: 'TEST_FIXTURE_TC_1',
        procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_B'],
        benefitType: 'BENEFIT',
        calcClass: 'GENERAL_BENEFIT',
      }),
    );
  });
});

describe('보장 판단 필드 목록 (DD-16, 닫힌 목록)', () => {
  it('정확히 네 개이고 순서가 고정이다', () => {
    expect([...COVERAGE_JUDGMENT_FIELDS]).toEqual(['treatmentCode', 'procedureCodes', 'benefitType', 'calcClass']);
  });

  it('치료 버전의 실제 필드 이름이다', () => {
    for (const field of COVERAGE_JUDGMENT_FIELDS) {
      expect(Object.keys(BASE)).toContain(field);
    }
  });

  it('가격·표시 필드는 목록에 없다', () => {
    for (const field of ['patientAmount', 'displayName', 'description', 'amountCondition', 'documentFlags', 'effectiveDate', 'origin']) {
      expect(COVERAGE_JUDGMENT_FIELDS as readonly string[]).not.toContain(field);
    }
  });
});

describe('지문에 들지 않는 필드는 지문을 바꾸지 않는다', () => {
  const unaffected: Array<[string, Partial<typeof BASE>]> = [
    ['환자 예상 결제액', { patientAmount: 999_000 }],
    ['표시 이름', { displayName: 'TEST_FIXTURE 다른 이름' }],
    ['설명', { description: 'TEST_FIXTURE 다른 설명' }],
    ['금액 적용 조건', { amountCondition: { patientType: 'X', assumption: 'Y', referenceDate: '2030-01-01' } }],
    ['서류 표시', { documentFlags: { imaging: true, biopsy: true, opinionRequired: true } }],
    ['적용일', { effectiveDate: '2030-01-01' }],
    ['출처 구분', { origin: 'DEMO' }],
    ['식별자·치료 id', { id: 'TEST_FIXTURE_TV_OTHER', treatmentId: 'TEST_FIXTURE_TREATMENT_OTHER' }],
  ];

  it.each(unaffected)('%s', (_label, change) => {
    expect(coverageFingerprintOf(makeTreatmentVersion(change))).toBe(coverageFingerprintOf(BASE));
  });
});

describe('보장 판단 네 필드는 각각 지문을 바꾼다', () => {
  const affecting: Array<[string, Partial<typeof BASE>]> = [
    ['치료 코드', { treatmentCode: 'TEST_FIXTURE_TC_2' }],
    ['행위 코드 하나 바뀜', { procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_C'] }],
    ['행위 코드 추가', { procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_B', 'TEST_FIXTURE_PROC_C'] }],
    ['행위 코드 제거', { procedureCodes: ['TEST_FIXTURE_PROC_A'] }],
    ['행위 코드 모두 제거', { procedureCodes: [] }],
    ['급여 구분', { benefitType: 'NON_BENEFIT' }],
    ['계산 분류 GENERAL_NON_BENEFIT', { calcClass: 'GENERAL_NON_BENEFIT' }],
    ['계산 분류 MAJOR_THREE_NON_BENEFIT', { calcClass: 'MAJOR_THREE_NON_BENEFIT' }],
    ['계산 분류 NEEDS_REVIEW', { calcClass: 'NEEDS_REVIEW' }],
  ];

  it.each(affecting)('%s', (_label, change) => {
    expect(coverageFingerprintOf(makeTreatmentVersion(change))).not.toBe(coverageFingerprintOf(BASE));
  });

  it('위 변경들은 서로 다른 지문을 낸다 (필드 사이에 값이 새지 않는다)', () => {
    const digests = affecting.map(([, change]) => coverageFingerprintOf(makeTreatmentVersion(change)));
    expect(new Set(digests).size).toBe(affecting.length);
  });

  it('같은 값을 다른 필드에 옮겨 넣어도 구분한다', () => {
    const swapped = coverageFingerprint({ treatmentCode: 'BENEFIT', procedureCodes: ['TEST_FIXTURE_PROC_A'], benefitType: 'BENEFIT', calcClass: 'GENERAL_BENEFIT' });
    const other = coverageFingerprint({ treatmentCode: 'TEST_FIXTURE_PROC_A', procedureCodes: ['BENEFIT'], benefitType: 'BENEFIT', calcClass: 'GENERAL_BENEFIT' });
    expect(swapped).not.toBe(other);
  });
});

describe('행위 코드는 목록이고 순서는 의미가 없다 [문서에 없음]', () => {
  it('순서만 다른 행위 코드는 같은 지문이다', () => {
    const forward = makeTreatmentVersion({ procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_B', 'TEST_FIXTURE_PROC_C'] });
    const shuffled = makeTreatmentVersion({ procedureCodes: ['TEST_FIXTURE_PROC_C', 'TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_B'] });
    expect(coverageFingerprintOf(shuffled)).toBe(coverageFingerprintOf(forward));
  });

  it('중복은 합치지 않는다: [A] 와 [A, A] 는 다른 지문이다', () => {
    const single = makeTreatmentVersion({ procedureCodes: ['TEST_FIXTURE_PROC_A'] });
    const doubled = makeTreatmentVersion({ procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_A'] });
    expect(coverageFingerprintOf(doubled)).not.toBe(coverageFingerprintOf(single));
  });

  it('코드 포인트 순으로 정렬한 사본을 해시한다 (보충 평면 문자가 앞서는 위치가 UTF-16 순서와 다른 경우)', () => {
    // U+FF5E(BMP 끝쪽)와 U+1F600(보충 평면)은 코드 포인트 순과 UTF-16 코드 단위 순이 서로 반대다.
    const bmp = '～';
    const astral = '\u{1f600}';
    const left = makeTreatmentVersion({ procedureCodes: [astral, bmp] });
    const right = makeTreatmentVersion({ procedureCodes: [bmp, astral] });
    expect(coverageFingerprintOf(left)).toBe(coverageFingerprintOf(right));
    expect(coverageFingerprint({ treatmentCode: 'T', procedureCodes: [bmp, astral], benefitType: 'BENEFIT', calcClass: 'GENERAL_BENEFIT' })).toBe(
      canonicalDigest({ treatmentCode: 'T', procedureCodes: [bmp, astral], benefitType: 'BENEFIT', calcClass: 'GENERAL_BENEFIT' }),
    );
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const codes = ['TEST_FIXTURE_PROC_C', 'TEST_FIXTURE_PROC_A'];
    const version = makeTreatmentVersion({ procedureCodes: codes });
    coverageFingerprintOf(version);
    expect(codes).toEqual(['TEST_FIXTURE_PROC_C', 'TEST_FIXTURE_PROC_A']);
    expect(version.procedureCodes).toEqual(['TEST_FIXTURE_PROC_C', 'TEST_FIXTURE_PROC_A']);
  });
});

describe('결정성', () => {
  it('같은 치료 버전은 언제나 같은 지문이다', () => {
    const first = coverageFingerprintOf(BASE);
    for (let i = 0; i < 10; i += 1) {
      expect(coverageFingerprintOf(structuredClone(BASE))).toBe(first);
    }
  });
});
