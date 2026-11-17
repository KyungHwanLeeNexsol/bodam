import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../src/app/api/clinics/[slug]/estimate/route';
import { CONTRACT_FIELDS, parseEstimateRequest } from '../../src/server/api/estimate-request';
import { CLINIC_1_SLUG, useTestServices } from '../fixtures/server/api-composition.fixture';
import { buildWorld, requestBody } from '../fixtures/server/estimate-world.fixture';
import { estimateBody, serve } from './estimate-helpers';
import { callPost, callPostWithJson } from './post-helpers';

// AC-019a (integration): 요청 본문에 가격·비율·병원 ID를 바꾼 필드를 덧붙여도 결과는 서버 게시 데이터로 계산한 값과 같고,
// 그 필드를 읽는 코드 경로가 없다 (필드 접근 감시). 본문 읽기는 계약의 여섯 이름만 읽는다 (DD-19 REQ-API-002).
// 감시 방법: 본문을 Proxy 로 감싸 모든 접근(get·has·ownKeys·getOwnPropertyDescriptor·set·delete·define)을 기록하고,
// 읽힌 이름이 여섯 개의 부분집합인지, 객체 전체를 훑는 접근(ownKeys 등)이 없는지 확인한다.
// 실제 route.ts 의 POST 로도 같은 확인을 한다: 요청의 json() 이 감시용 객체를 돌려준다.

vi.mock('../../src/app/services', async () => {
  const { activeTestServices } = await import('../fixtures/server/api-composition.fixture');
  return { getApiServices: () => activeTestServices() };
});

beforeEach(() => {
  useTestServices(null);
});

const CONTRACT = CONTRACT_FIELDS;

/** 계약 밖에 덧붙이는 필드: 가격·비율·병원 ID·줄·결과·지문·분류·수량·식별자 등. 값은 일부러 결과를 바꿀 만한 것이다. */
const FOREIGN_FIELDS: Record<string, unknown> = {
  patientAmount: 1,
  price: 1,
  amount: 1,
  rate: 9_999,
  ratio: 0.5,
  deductionRate: 0,
  clinicId: 'TEST_FIXTURE_CLINIC_2',
  clinicSlug: 'test-fixture-clinic-2',
  lines: [{ treatmentId: 'X', patientAmount: 1 }],
  baseFeeLines: [{ treatmentId: 'Y', patientAmount: 1, isBaseFee: true }],
  result: { state: 'ESTIMATED' },
  hospitalPayment: 1,
  expectedInsurancePayout: 999_999,
  coverageFingerprint: 'TEST_FIXTURE_FINGERPRINT_FORGED',
  calcClass: 'NEEDS_REVIEW',
  coverageClass: 'GENERAL_BENEFIT',
  quantity: 3,
  quantities: { TEST_FIXTURE_TREATMENT_1: 3 },
  requestId: 'TEST_FIXTURE_REQUEST_ID',
  origin: 'OPERATING',
  acceptedOrigins: { rules: ['DEMO'], lines: ['DEMO'] },
  at: '2000-01-01',
  bundle: { status: 'ACTIVE', profiles: [], mappings: [] },
  state: 'PUBLISHED',
  documents: { state: 'AVAILABLE' },
  constructor: 'x',
  toJSON: 'x',
};

interface Trap {
  trap: string;
  property: string | symbol | undefined;
}

/** 모든 접근을 기록하는 Proxy. 기록은 traps 에 쌓인다. */
function watched(target: object): { proxy: object; traps: Trap[] } {
  const traps: Trap[] = [];
  const record = (trap: string, property?: string | symbol) => traps.push({ trap, property });
  const proxy = new Proxy(target, {
    get(t, property, receiver) {
      // Promise 의 해결 규칙이 thenable 여부를 보려고 'then' 을 읽는다(요청의 json() 이 약속으로 돌려주는 값이면 늘 일어난다). 서버 코드의 접근이 아니므로 기록하지 않는다.
      if (property === 'then') {
        return undefined;
      }
      record('get', property);
      return Reflect.get(t, property, receiver) as unknown;
    },
    has(t, property) {
      record('has', property);
      return Reflect.has(t, property);
    },
    ownKeys(t) {
      record('ownKeys');
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, property) {
      record('getOwnPropertyDescriptor', property);
      return Reflect.getOwnPropertyDescriptor(t, property);
    },
    getPrototypeOf(t) {
      record('getPrototypeOf');
      return Reflect.getPrototypeOf(t);
    },
    set(t, property, value) {
      record('set', property);
      return Reflect.set(t, property, value);
    },
    defineProperty(t, property, descriptor) {
      record('defineProperty', property);
      return Reflect.defineProperty(t, property, descriptor);
    },
    deleteProperty(t, property) {
      record('deleteProperty', property);
      return Reflect.deleteProperty(t, property);
    },
  });
  return { proxy, traps };
}

const VALID = { catalogVersion: 'C1', ruleBundleVersion: 'B1', generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds: ['T1', 'T2'] };

describe('AC-019a 본문 읽기 함수: 계약의 여섯 이름만 읽는다', () => {
  it('덧붙인 필드가 가득한 본문에서 읽힌 이름은 여섯 계약 이름의 부분집합이고, 객체 전체를 훑는 접근이 없다', () => {
    const { proxy, traps } = watched({ ...VALID, ...FOREIGN_FIELDS });
    const parsed = parseEstimateRequest(proxy);
    expect(parsed).toEqual({ ok: true, request: VALID });
    const accessed = traps.map((entry) => entry.property).filter((property): property is string => typeof property === 'string');
    expect(accessed.filter((name) => !(CONTRACT as readonly string[]).includes(name))).toEqual([]);
    expect(traps.filter((entry) => !['get', 'has', 'getOwnPropertyDescriptor'].includes(entry.trap))).toEqual([]);
    expect(new Set(accessed)).toEqual(new Set(CONTRACT));
  });

  it('돌려주는 요청 객체는 여섯 필드뿐이다 (덧붙인 필드를 담아 넘기지 않는다)', () => {
    const parsed = parseEstimateRequest({ ...VALID, ...FOREIGN_FIELDS });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(Object.keys(parsed.request).sort()).toEqual([...CONTRACT].sort());
    }
  });

  it.each([
    ['필수 필드 누락', { ...VALID, cause: undefined }],
    ['열거 밖', { ...VALID, insurerType: 'X' }],
    ['지원 밖 세대', { ...VALID, generation: 'GEN5_C5' }],
    ['빈 치료 목록', { ...VALID, treatmentIds: [] }],
  ])('거절되는 본문에서도 계약 밖의 이름은 읽지 않는다: %s', (_label, body) => {
    const { proxy, traps } = watched({ ...body, ...FOREIGN_FIELDS });
    parseEstimateRequest(proxy);
    const accessed = traps.map((entry) => entry.property).filter((property): property is string => typeof property === 'string');
    expect(accessed.filter((name) => !(CONTRACT as readonly string[]).includes(name))).toEqual([]);
    expect(traps.filter((entry) => entry.trap === 'ownKeys')).toEqual([]);
  });

  it('읽으면 던지는 getter 를 계약 밖 이름에 달아 두어도 던지지 않는다', () => {
    const body: Record<string, unknown> = { ...VALID };
    for (const name of Object.keys(FOREIGN_FIELDS)) {
      Object.defineProperty(body, name, {
        enumerable: true,
        get() {
          throw new Error(`TEST_FIXTURE: 계약 밖 필드 ${name} 를 읽었다`);
        },
      });
    }
    expect(parseEstimateRequest(body)).toEqual({ ok: true, request: VALID });
  });
});

describe('AC-019a 실제 route.ts 의 POST: 계약 밖 필드를 읽는 코드 경로가 없고 결과가 같다', () => {
  it('json() 이 돌려주는 감시용 본문: 읽힌 이름은 계약의 여섯뿐이다', async () => {
    const w = buildWorld();
    serve(w);
    const { proxy, traps } = watched({ ...requestBody(w), ...FOREIGN_FIELDS });
    const result = await callPostWithJson(POST, CLINIC_1_SLUG, () => Promise.resolve(proxy));
    expect(result.status).toBe(200);
    const accessed = traps.map((entry) => entry.property).filter((property): property is string => typeof property === 'string');
    expect(accessed.filter((name) => !(CONTRACT as readonly string[]).includes(name))).toEqual([]);
    expect(traps.filter((entry) => !['get', 'has', 'getOwnPropertyDescriptor'].includes(entry.trap))).toEqual([]);
  });

  it('읽으면 던지는 getter 를 단 본문도 200 이다 (읽는 코드 경로가 없다)', async () => {
    const w = buildWorld();
    serve(w);
    const body = requestBody(w);
    for (const name of Object.keys(FOREIGN_FIELDS)) {
      Object.defineProperty(body, name, {
        enumerable: true,
        get() {
          throw new Error(`TEST_FIXTURE: 계약 밖 필드 ${name} 를 읽었다`);
        },
      });
    }
    const result = await callPostWithJson(POST, CLINIC_1_SLUG, () => Promise.resolve(body));
    expect(result.status).toBe(200);
  });

  it('가격·비율·병원 ID·줄·결과·지문·분류를 바꿔 덧붙인 JSON 본문의 응답은 덧붙이지 않은 본문의 응답과 바이트까지 같다', async () => {
    const w = buildWorld();
    serve(w);
    const clean = await callPost(POST, CLINIC_1_SLUG, requestBody(w));
    expect(clean.status).toBe(200);
    // JSON.stringify 는 __proto__ 를 직렬화에서 빼므로 덧붙일 문자열을 직접 만든다 ("__proto__" 키도 본문에 실린다).
    const polluted = JSON.stringify({ ...requestBody(w), ...FOREIGN_FIELDS }).replace(/^\{/, '{"__proto__":{"admin":true},');
    const withExtras = await callPostWithJson(POST, CLINIC_1_SLUG, () => Promise.resolve(JSON.parse(polluted) as unknown));
    expect(withExtras.status).toBe(200);
    expect(withExtras.text).toBe(clean.text);
  });

  it('덧붙인 필드가 있어도 계산 결과는 서버 게시 데이터의 값이다 (병원 결제액 25,000원, 덧붙인 1원·999,999원이 아니다)', async () => {
    const w = buildWorld();
    serve(w);
    const body = estimateBody(await callPost(POST, CLINIC_1_SLUG, { ...requestBody(w), ...FOREIGN_FIELDS }));
    expect(body.result.amounts.hospitalPayment).toBe(25_000);
    expect(body.result.amounts.expectedInsurancePayout).not.toBe(999_999);
    expect(body.result.lines.map((line) => line.treatmentId).sort()).toEqual(['TEST_FIXTURE_BASE_FEE_A', 'TEST_FIXTURE_TREATMENT_1', 'TEST_FIXTURE_TREATMENT_2']);
  });

  it('요청 본문으로 다른 병원을 가리켜도(clinicId·clinicSlug) 경로의 slug 가 병원을 정한다', async () => {
    const w = buildWorld();
    serve(w);
    const result = await callPost(POST, CLINIC_1_SLUG, { ...requestBody(w), clinicId: 'TEST_FIXTURE_CLINIC_2', clinicSlug: 'nope' });
    expect(result.status).toBe(200);
  });
});
