import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_WON } from '../../src/engine/limits';
import { validateCatalogPublish } from '../../src/server/publish-validate';
import { OPERATING_CATALOG_CONFIG, TEST_CATALOG_CONFIG, validCatalogRequest } from '../fixtures/server/publish.fixture';
import { setAt, unsetAt } from '../fixtures/server/mutate.fixture';

// 카탈로그 게시 검증기 (AC-011h 의 가격·기본비용 범위, AC-010c 의 출처 거절, 엔진 입력 무결성 중복).
// 검증기는 순수하다: 결함 {code, path} 목록만 돌려주고 던지지 않는다. 저장·롤백은 다음 단계(게시 서비스)의 일이다.

const valid = validCatalogRequest();
const TV = 'treatmentVersions';
const FEE = 'commonBaseFees';

describe('올바른 카탈로그 요청', () => {
  it('시험 구성에서는 결함이 없다', () => {
    expect(validateCatalogPublish(valid, TEST_CATALOG_CONFIG)).toEqual([]);
  });

  it('운영 구성에서는 출처가 OPERATING 인 요청에 결함이 없다', () => {
    expect(validateCatalogPublish(validCatalogRequest('OPERATING'), OPERATING_CATALOG_CONFIG)).toEqual([]);
  });

  it('치료 버전도 기본비용도 없는 빈 목록은 결함이 아니다', () => {
    expect(validateCatalogPublish({ treatmentVersions: [], commonBaseFees: [] }, TEST_CATALOG_CONFIG)).toEqual([]);
  });

  it('procedureCodes 가 빈 배열인 치료는 결함이 아니다 [문서에 없음: DD-03·DD-18 이 비어 있는 목록을 막지 않는다]', () => {
    const request = setAt(valid, [TV, 0, 'procedureCodes'], []);
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([]);
  });
});

describe('컨테이너와 항목의 모양', () => {
  it.each([null, undefined, 5, 'x', true, []])('요청 자체가 객체가 아니면(%j) NOT_OBJECT 하나', (request) => {
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([{ code: 'NOT_OBJECT', path: 'catalog' }]);
  });

  it.each([TV, FEE])('%s 가 배열이 아니면 NOT_ARRAY 하나이고 다른 목록은 그대로 검사한다', (field) => {
    for (const garbage of [null, undefined, {}, 'x', 5, true]) {
      const request = setAt(valid, [field], garbage);
      expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([{ code: 'NOT_ARRAY', path: field }]);
    }
  });

  it.each([TV, FEE])('%s 의 항목이 null·undefined·원시값·배열이면 NOT_OBJECT 이고 그 항목은 더 읽지 않는다', (field) => {
    for (const garbage of [null, undefined, 5, 'x', true, []]) {
      const request = setAt(valid, [field, 1], garbage);
      expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([{ code: 'NOT_OBJECT', path: `${field}[1]` }]);
    }
  });

  it('희소 배열의 빈 칸도 항목 결함이다', () => {
    // eslint 없음: 일부러 구멍을 만든다.
    const sparse = new Array(2);
    sparse[0] = valid.treatmentVersions[0];
    const request = { ...valid, treatmentVersions: sparse };
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([{ code: 'NOT_OBJECT', path: 'treatmentVersions[1]' }]);
  });

  it('두 목록이 모두 틀리면 치료 버전 → 기본비용 순으로 둘 다 보고한다', () => {
    const request = { treatmentVersions: null, commonBaseFees: 'x' };
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([
      { code: 'NOT_ARRAY', path: TV },
      { code: 'NOT_ARRAY', path: FEE },
    ]);
  });
});

describe('필수 필드 누락', () => {
  const tvFields = ['id', 'treatmentId', 'displayName', 'benefitType', 'patientAmount', 'treatmentCode', 'procedureCodes', 'calcClass', 'documentFlags', 'origin'];
  const feeFields = ['id', 'clinicId', 'displayName', 'benefitType', 'amount', 'code', 'origin'];

  it.each(tvFields)('치료 버전의 %s 가 없으면 VALUE_MISSING', (field) => {
    expect(validateCatalogPublish(unsetAt(valid, [TV, 0, field]), TEST_CATALOG_CONFIG)).toEqual([{ code: 'VALUE_MISSING', path: `${TV}[0].${field}` }]);
  });

  it.each(tvFields)('치료 버전의 %s 가 null 이어도 VALUE_MISSING (값을 0·기본값으로 채우지 않는다)', (field) => {
    expect(validateCatalogPublish(setAt(valid, [TV, 0, field], null), TEST_CATALOG_CONFIG)).toEqual([{ code: 'VALUE_MISSING', path: `${TV}[0].${field}` }]);
  });

  it.each(feeFields)('공통 기본비용의 %s 가 없으면 VALUE_MISSING', (field) => {
    expect(validateCatalogPublish(unsetAt(valid, [FEE, 1, field]), TEST_CATALOG_CONFIG)).toEqual([{ code: 'VALUE_MISSING', path: `${FEE}[1].${field}` }]);
  });

  it('설명·금액 적용 조건·적용일처럼 엔진이 읽지 않는 서술 필드는 판정하지 않는다 [문서에 없음]', () => {
    let request = unsetAt(valid, [TV, 0, 'description']);
    request = unsetAt(request, [TV, 0, 'amountCondition']);
    request = unsetAt(request, [TV, 0, 'effectiveDate']);
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([]);
  });
});

describe('금액 범위 (DD-24: Won = 0 이상 MAX_AMOUNT_WON 이하의 안전 정수, -0 제외)', () => {
  const invalidAmounts: Array<[string, unknown]> = [
    ['-1', -1],
    ['소수 0.5', 0.5],
    ['소수 10.25', 10.25],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['문자열 "1000"', '1000'],
    ['빈 문자열', ''],
    ['불리언 true', true],
    ['배열 [1]', [1]],
    ['MAX_AMOUNT_WON + 1', MAX_AMOUNT_WON + 1],
    ['안전 정수 초과', Number.MAX_SAFE_INTEGER + 1],
    ['-0', -0],
  ];
  const validAmounts: Array<[string, number]> = [
    ['0', 0],
    ['1', 1],
    ['MAX_AMOUNT_WON', MAX_AMOUNT_WON],
    ['MAX_AMOUNT_WON - 1', MAX_AMOUNT_WON - 1],
  ];

  describe.each([
    ['치료 가격', [TV, 0, 'patientAmount'] as const, `${TV}[0].patientAmount`],
    ['공통 기본비용 금액', [FEE, 0, 'amount'] as const, `${FEE}[0].amount`],
  ])('%s', (_label, path, reported) => {
    it.each(invalidAmounts)('%s 는 VALUE_INVALID 이고 어긋난 필드 경로가 붙는다', (_name, amount) => {
      expect(validateCatalogPublish(setAt(valid, path, amount), TEST_CATALOG_CONFIG)).toEqual([{ code: 'VALUE_INVALID', path: reported }]);
    });

    it.each(validAmounts)('경계값 %s 는 허용한다', (_name, amount) => {
      expect(validateCatalogPublish(setAt(valid, path, amount), TEST_CATALOG_CONFIG)).toEqual([]);
    });
  });
});

describe('닫힌 열거와 표시 필드', () => {
  it.each([TV, FEE])('%s 의 benefitType 은 BENEFIT·NON_BENEFIT 뿐이다', (field) => {
    for (const ok of ['BENEFIT', 'NON_BENEFIT']) {
      expect(validateCatalogPublish(setAt(valid, [field, 0, 'benefitType'], ok), TEST_CATALOG_CONFIG)).toEqual([]);
    }
    for (const bad of ['benefit', 'OTHER', '', 1, true, []]) {
      expect(validateCatalogPublish(setAt(valid, [field, 0, 'benefitType'], bad), TEST_CATALOG_CONFIG)).toEqual([
        { code: 'VALUE_INVALID', path: `${field}[0].benefitType` },
      ]);
    }
  });

  it('calcClass 는 닫힌 네 값뿐이다', () => {
    for (const ok of ['GENERAL_BENEFIT', 'GENERAL_NON_BENEFIT', 'MAJOR_THREE_NON_BENEFIT', 'NEEDS_REVIEW']) {
      expect(validateCatalogPublish(setAt(valid, [TV, 0, 'calcClass'], ok), TEST_CATALOG_CONFIG)).toEqual([]);
    }
    for (const bad of ['general_benefit', 'UNKNOWN', '', 0, false]) {
      expect(validateCatalogPublish(setAt(valid, [TV, 0, 'calcClass'], bad), TEST_CATALOG_CONFIG)).toEqual([
        { code: 'VALUE_INVALID', path: `${TV}[0].calcClass` },
      ]);
    }
  });

  it.each([TV, FEE])('%s 의 origin 은 OPERATING·DEMO·TEST_FIXTURE 뿐이고 그 밖의 값은 허용 출처 검사까지 가지 않는다', (field) => {
    for (const bad of ['PRODUCTION', 'operating', '', 1, []]) {
      expect(validateCatalogPublish(setAt(valid, [field, 0, 'origin'], bad), TEST_CATALOG_CONFIG)).toEqual([{ code: 'VALUE_INVALID', path: `${field}[0].origin` }]);
    }
  });

  it('treatmentCode 는 비어 있지 않은 문자열이다', () => {
    for (const bad of ['', 5, true, [], {}]) {
      expect(validateCatalogPublish(setAt(valid, [TV, 0, 'treatmentCode'], bad), TEST_CATALOG_CONFIG)).toEqual([
        { code: 'VALUE_INVALID', path: `${TV}[0].treatmentCode` },
      ]);
    }
  });

  it('식별자와 이름 필드는 문자열이어야 하고 id·treatmentId 는 비어 있으면 안 된다', () => {
    for (const field of ['id', 'treatmentId']) {
      for (const bad of ['', 5, {}]) {
        expect(validateCatalogPublish(setAt(valid, [TV, 0, field], bad), TEST_CATALOG_CONFIG)).toEqual([{ code: 'VALUE_INVALID', path: `${TV}[0].${field}` }]);
      }
    }
    for (const field of ['id', 'clinicId']) {
      expect(validateCatalogPublish(setAt(valid, [FEE, 0, field], ''), TEST_CATALOG_CONFIG)).toEqual([{ code: 'VALUE_INVALID', path: `${FEE}[0].${field}` }]);
    }
    expect(validateCatalogPublish(setAt(valid, [TV, 0, 'displayName'], 5), TEST_CATALOG_CONFIG)).toEqual([{ code: 'VALUE_INVALID', path: `${TV}[0].displayName` }]);
    expect(validateCatalogPublish(setAt(valid, [FEE, 0, 'code'], 5), TEST_CATALOG_CONFIG)).toEqual([{ code: 'VALUE_INVALID', path: `${FEE}[0].code` }]);
  });

  it('displayName 이 빈 문자열인 것은 판정하지 않는다 [문서에 없음: 형식(문자열)만 본다]', () => {
    expect(validateCatalogPublish(setAt(valid, [TV, 0, 'displayName'], ''), TEST_CATALOG_CONFIG)).toEqual([]);
  });
});

describe('procedureCodes', () => {
  it('배열이 아니면 VALUE_INVALID', () => {
    for (const bad of ['A', {}, 5, true]) {
      expect(validateCatalogPublish(setAt(valid, [TV, 0, 'procedureCodes'], bad), TEST_CATALOG_CONFIG)).toEqual([
        { code: 'VALUE_INVALID', path: `${TV}[0].procedureCodes` },
      ]);
    }
  });

  it('항목이 비어 있는 문자열·비문자열·null 이면 그 항목 경로가 붙는다', () => {
    const request = setAt(valid, [TV, 1, 'procedureCodes'], ['OK', '', 5, null, undefined, 'OK2']);
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([
      { code: 'VALUE_INVALID', path: `${TV}[1].procedureCodes[1]` },
      { code: 'VALUE_INVALID', path: `${TV}[1].procedureCodes[2]` },
      { code: 'VALUE_INVALID', path: `${TV}[1].procedureCodes[3]` },
      { code: 'VALUE_INVALID', path: `${TV}[1].procedureCodes[4]` },
    ]);
  });

  it('희소 배열의 빈 칸은 무효 항목이다', () => {
    const sparse = new Array(2);
    sparse[0] = 'OK';
    expect(validateCatalogPublish(setAt(valid, [TV, 0, 'procedureCodes'], []), TEST_CATALOG_CONFIG)).toEqual([]);
    const request = { ...valid, treatmentVersions: [{ ...valid.treatmentVersions[0], procedureCodes: sparse }, valid.treatmentVersions[1]] };
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([{ code: 'VALUE_INVALID', path: `${TV}[0].procedureCodes[1]` }]);
  });

  it('같은 행위 코드가 반복돼도 결함이 아니다 (지문은 중복을 합치지 않고 남긴다)', () => {
    expect(validateCatalogPublish(setAt(valid, [TV, 0, 'procedureCodes'], ['A', 'A']), TEST_CATALOG_CONFIG)).toEqual([]);
  });
});

describe('documentFlags (엄격한 불리언, 변환 없음)', () => {
  it('객체가 아니면 VALUE_INVALID', () => {
    for (const bad of [5, 'x', true, []]) {
      expect(validateCatalogPublish(setAt(valid, [TV, 0, 'documentFlags'], bad), TEST_CATALOG_CONFIG)).toEqual([
        { code: 'VALUE_INVALID', path: `${TV}[0].documentFlags` },
      ]);
    }
  });

  it.each(['imaging', 'biopsy', 'opinionRequired'])('%s 는 true·false 만 유효하다', (flag) => {
    for (const ok of [true, false]) {
      expect(validateCatalogPublish(setAt(valid, [TV, 0, 'documentFlags', flag], ok), TEST_CATALOG_CONFIG)).toEqual([]);
    }
    for (const bad of ['true', 'false', 1, 0, [], {}]) {
      expect(validateCatalogPublish(setAt(valid, [TV, 0, 'documentFlags', flag], bad), TEST_CATALOG_CONFIG)).toEqual([
        { code: 'VALUE_INVALID', path: `${TV}[0].documentFlags.${flag}` },
      ]);
    }
    expect(validateCatalogPublish(setAt(valid, [TV, 0, 'documentFlags', flag], null), TEST_CATALOG_CONFIG)).toEqual([
      { code: 'VALUE_MISSING', path: `${TV}[0].documentFlags.${flag}` },
    ]);
    expect(validateCatalogPublish(unsetAt(valid, [TV, 0, 'documentFlags', flag]), TEST_CATALOG_CONFIG)).toEqual([
      { code: 'VALUE_MISSING', path: `${TV}[0].documentFlags.${flag}` },
    ]);
  });
});

describe('허용 출처 (AC-010c)', () => {
  it.each(['DEMO', 'TEST_FIXTURE'] as const)('운영 구성은 %s 치료 버전을 ORIGIN_NOT_ACCEPTED 로 거절한다', (origin) => {
    const request = setAt(valid, [TV, 1, 'origin'], origin);
    expect(validateCatalogPublish(request, OPERATING_CATALOG_CONFIG)).toEqual([
      // valid 의 나머지 항목은 TEST_FIXTURE 이므로 그것들도 거절된다.
      { code: 'ORIGIN_NOT_ACCEPTED', path: `${TV}[0].origin` },
      { code: 'ORIGIN_NOT_ACCEPTED', path: `${TV}[1].origin` },
      { code: 'ORIGIN_NOT_ACCEPTED', path: `${FEE}[0].origin` },
      { code: 'ORIGIN_NOT_ACCEPTED', path: `${FEE}[1].origin` },
    ]);
  });

  it.each(['DEMO', 'TEST_FIXTURE'] as const)('운영 구성에서 %s 공통 기본비용 하나만 섞여도 그 항목만 거절한다', (origin) => {
    const request = setAt(validCatalogRequest('OPERATING'), [FEE, 1, 'origin'], origin);
    expect(validateCatalogPublish(request, OPERATING_CATALOG_CONFIG)).toEqual([{ code: 'ORIGIN_NOT_ACCEPTED', path: `${FEE}[1].origin` }]);
  });

  it('운영 구성에서 OPERATING 은 허용한다', () => {
    expect(validateCatalogPublish(validCatalogRequest('OPERATING'), OPERATING_CATALOG_CONFIG)).toEqual([]);
  });

  it.each(['OPERATING', 'DEMO', 'TEST_FIXTURE'] as const)('시험 구성은 %s 를 모두 허용한다', (origin) => {
    expect(validateCatalogPublish(validCatalogRequest(origin), TEST_CATALOG_CONFIG)).toEqual([]);
  });

  it('허용 목록은 설정이 정한다: DEMO 만 허용하는 구성은 TEST_FIXTURE 를 거절하고 DEMO 는 받는다', () => {
    const config = { acceptedLineOrigins: ['DEMO'] } as const;
    expect(validateCatalogPublish(validCatalogRequest('DEMO'), config)).toEqual([]);
    expect(validateCatalogPublish(validCatalogRequest('TEST_FIXTURE'), config)).toHaveLength(4);
  });

  it('허용 목록이 비어 있으면 모든 출처를 거절한다 (허용으로 추정하지 않는다)', () => {
    expect(validateCatalogPublish(validCatalogRequest('OPERATING'), { acceptedLineOrigins: [] })).toHaveLength(4);
  });
});

describe('중복 (엔진이 INPUT_INTEGRITY_VIOLATION 으로 거절할 입력을 게시 때 막는다)', () => {
  it('같은 treatmentId 의 치료 버전이 둘이면 둘 다 DUPLICATE_TREATMENT_ID', () => {
    const request = setAt(valid, [TV, 1, 'treatmentId'], 'TEST_FIXTURE_TREATMENT_1');
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([
      { code: 'DUPLICATE_TREATMENT_ID', path: `${TV}[0].treatmentId` },
      { code: 'DUPLICATE_TREATMENT_ID', path: `${TV}[1].treatmentId` },
    ]);
  });

  it('세 번 나오면 세 항목 모두 보고하고, 따로 있는 다른 치료는 보고하지 않는다', () => {
    const base = validCatalogRequest();
    const request = {
      ...base,
      treatmentVersions: [
        { ...base.treatmentVersions[0] },
        { ...base.treatmentVersions[0], id: 'TEST_FIXTURE_TV_X2' },
        base.treatmentVersions[1],
        { ...base.treatmentVersions[0], id: 'TEST_FIXTURE_TV_X3' },
      ],
    };
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([
      { code: 'DUPLICATE_TREATMENT_ID', path: `${TV}[0].treatmentId` },
      { code: 'DUPLICATE_TREATMENT_ID', path: `${TV}[1].treatmentId` },
      { code: 'DUPLICATE_TREATMENT_ID', path: `${TV}[3].treatmentId` },
    ]);
  });

  it('같은 치료 버전 id 가 둘이면 둘 다 DUPLICATE_ID', () => {
    const request = setAt(valid, [TV, 1, 'id'], 'TEST_FIXTURE_TV_1');
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([
      { code: 'DUPLICATE_ID', path: `${TV}[0].id` },
      { code: 'DUPLICATE_ID', path: `${TV}[1].id` },
    ]);
  });

  it('같은 공통 기본비용 id 가 둘이면 둘 다 DUPLICATE_ID', () => {
    const request = setAt(valid, [FEE, 1, 'id'], 'TEST_FIXTURE_FEE_1');
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([
      { code: 'DUPLICATE_ID', path: `${FEE}[0].id` },
      { code: 'DUPLICATE_ID', path: `${FEE}[1].id` },
    ]);
  });

  it('치료 버전 id 와 기본비용 id 가 같은 것은 중복이 아니다 (서로 다른 엔티티)', () => {
    const request = setAt(valid, [FEE, 0, 'id'], 'TEST_FIXTURE_TV_1');
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([]);
  });

  it('항목 형식이 틀린 항목은 중복 판정에서 빠진다 (읽지 않는다)', () => {
    const request = setAt(valid, [TV, 0], null);
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([{ code: 'NOT_OBJECT', path: `${TV}[0]` }]);
  });

  it('비어 있거나 문자열이 아닌 식별자는 중복으로 세지 않는다 (VALUE_INVALID 만 낸다)', () => {
    let request = setAt(valid, [TV, 0, 'treatmentId'], '');
    request = setAt(request, [TV, 1, 'treatmentId'], '');
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([
      { code: 'VALUE_INVALID', path: `${TV}[0].treatmentId` },
      { code: 'VALUE_INVALID', path: `${TV}[1].treatmentId` },
    ]);
  });
});

describe('결함 보고 순서 (고정)', () => {
  it('치료 버전(항목 순서, 항목 안에서는 id → treatmentId → displayName → benefitType → patientAmount → treatmentCode → procedureCodes → calcClass → documentFlags → origin) → 기본비용 → 중복 순이다', () => {
    let request: unknown = valid;
    request = setAt(request, [TV, 0, 'patientAmount'], -1);
    request = setAt(request, [TV, 0, 'benefitType'], 'X');
    request = setAt(request, [TV, 0, 'origin'], 'Y');
    request = setAt(request, [TV, 0, 'calcClass'], 'Z');
    request = setAt(request, [TV, 1, 'treatmentId'], 'TEST_FIXTURE_TREATMENT_1');
    request = setAt(request, [FEE, 1, 'amount'], 0.5);
    request = setAt(request, [FEE, 0, 'origin'], 'DEMO');
    expect(validateCatalogPublish(request, OPERATING_CATALOG_CONFIG)).toEqual([
      { code: 'VALUE_INVALID', path: `${TV}[0].benefitType` },
      { code: 'VALUE_INVALID', path: `${TV}[0].patientAmount` },
      { code: 'VALUE_INVALID', path: `${TV}[0].calcClass` },
      { code: 'VALUE_INVALID', path: `${TV}[0].origin` },
      { code: 'ORIGIN_NOT_ACCEPTED', path: `${TV}[1].origin` },
      { code: 'ORIGIN_NOT_ACCEPTED', path: `${FEE}[0].origin` },
      { code: 'VALUE_INVALID', path: `${FEE}[1].amount` },
      { code: 'ORIGIN_NOT_ACCEPTED', path: `${FEE}[1].origin` },
      { code: 'DUPLICATE_TREATMENT_ID', path: `${TV}[0].treatmentId` },
      { code: 'DUPLICATE_TREATMENT_ID', path: `${TV}[1].treatmentId` },
    ]);
  });

  it('결함 객체는 code 와 path 두 키만 가진다', () => {
    const [defect] = validateCatalogPublish(setAt(valid, [TV, 0, 'patientAmount'], -1), TEST_CATALOG_CONFIG);
    expect(Object.keys(defect ?? {}).sort()).toEqual(['code', 'path']);
  });
});
