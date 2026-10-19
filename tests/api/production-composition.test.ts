import { describe, expect, it } from 'vitest';
import { GET as catalogGET } from '../../src/app/api/clinics/[slug]/catalog/route';
import { GET as optionsGET } from '../../src/app/api/clinics/[slug]/insurance/options/route';
import * as servicesModule from '../../src/app/services';
import { getApiServices } from '../../src/app/services';
import { estimate } from '../../src/engine/estimate';
import type { EstimateInput } from '../../src/engine/types';
import * as compositionModule from '../../src/server/composition';
import { OPERATING_ACCEPTED_ORIGINS, createOperatingServices } from '../../src/server/composition';
import { silentLog } from '../../src/server/api/log';
import { createMemoryRepository } from '../../src/server/repo/memory/memory-repository';
import { bundleWith, exampleLines, makeInput } from '../fixtures/engine/lines.fixture';
import { makeMapping } from '../fixtures/engine/mappings.fixture';
import { makeProfile, testDigest } from '../fixtures/engine/profiles.fixture';
import { TEST_ACCEPTED_ORIGINS, TEST_TODAY } from '../fixtures/server/api-composition.fixture';
import { callGet } from './helpers';

/** 판정 기준일 주입값 (M4.B 에서 ApiServices 가 today 를 갖게 되어 구성 시험이 고정 값을 넘긴다). */
const fixedToday = (): string => TEST_TODAY;

// AC-010b (운영 구성 쪽 증거): 운영 구성은 규칙·줄의 허용 출처로 OPERATING 하나만 넘기고, 시험 자료(TEST_FIXTURE)는 그 구성에서 쓸 수 없다.
// 이 파일은 src/app/services.ts 를 vi.mock 하지 않는다: 실제 운영 연결(빈 메모리 저장소)을 실제 route.ts 로 부른다.
// 운영 데이터는 없다. 그래서 어떤 slug 도 404 CLINIC_NOT_FOUND 이고, 이것은 기대한 동작이다(우회하지 않는다).

describe('운영 구성: 허용 출처', () => {
  it('규칙과 줄의 허용 출처는 OPERATING 하나뿐이다', () => {
    const services = createOperatingServices({ repo: createMemoryRepository(), log: silentLog, today: fixedToday });
    expect(services.acceptedOrigins).toEqual({ rules: ['OPERATING'], lines: ['OPERATING'] });
    expect(OPERATING_ACCEPTED_ORIGINS).toEqual({ rules: ['OPERATING'], lines: ['OPERATING'] });
  });

  it('만들어진 구성과 허용 출처 목록은 얼려 있어 고칠 수 없다', () => {
    const services = createOperatingServices({ repo: createMemoryRepository(), log: silentLog, today: fixedToday });
    expect(Object.isFrozen(services)).toBe(true);
    expect(Object.isFrozen(services.acceptedOrigins)).toBe(true);
    expect(Object.isFrozen(services.acceptedOrigins.rules)).toBe(true);
    expect(Object.isFrozen(services.acceptedOrigins.lines)).toBe(true);
    expect(() => (services.acceptedOrigins.rules as string[]).push('TEST_FIXTURE')).toThrow(TypeError);
    expect(() => (services.acceptedOrigins.lines as string[]).push('DEMO')).toThrow(TypeError);
    expect(() => {
      (services as { acceptedOrigins: unknown }).acceptedOrigins = TEST_ACCEPTED_ORIGINS;
    }).toThrow(TypeError);
    expect(services.acceptedOrigins.rules).toEqual(['OPERATING']);
  });

  it('주입한 저장소와 로그 출구를 그대로 쓴다', () => {
    const repo = createMemoryRepository();
    const services = createOperatingServices({ repo, log: silentLog, today: fixedToday });
    expect(services.repo).toBe(repo);
    expect(services.log).toBe(silentLog);
  });

  it('허용 출처를 바꾸는 매개변수나 덮어쓰는 훅이 없다: 모듈이 내보내는 것은 둘뿐이고, 인자로 허용 출처를 넘겨도 쓰이지 않는다', () => {
    expect(Object.keys(compositionModule).sort()).toEqual(['OPERATING_ACCEPTED_ORIGINS', 'createOperatingServices']);
    const services = createOperatingServices({ repo: createMemoryRepository(), log: silentLog, today: fixedToday, acceptedOrigins: TEST_ACCEPTED_ORIGINS } as Parameters<typeof createOperatingServices>[0]);
    expect(services.acceptedOrigins).toEqual({ rules: ['OPERATING'], lines: ['OPERATING'] });
  });
});

describe('운영 구성의 허용 출처로 엔진을 부르면 시험 자료는 쓸 수 없다', () => {
  const operating = createOperatingServices({ repo: createMemoryRepository(), log: silentLog, today: fixedToday });
  const operatingOrigins = { rules: [...operating.acceptedOrigins.rules], lines: [...operating.acceptedOrigins.lines] };
  const IDS = exampleLines().map((line) => line.treatmentId);

  /** 줄·프로필·매핑의 출처를 각각 고른 입력. 값은 모두 시험 자료다. */
  function input(origins: { line: 'OPERATING' | 'TEST_FIXTURE'; rule: 'OPERATING' | 'TEST_FIXTURE' }, acceptedOrigins: EstimateInput['acceptedOrigins']): EstimateInput {
    const lines = exampleLines().map((line) => ({ ...line, origin: origins.line }));
    const mappings = IDS.map((id) => makeMapping(id, { origin: origins.rule }));
    return makeInput({ lines, bundle: bundleWith(makeProfile({ origin: origins.rule }), mappings), acceptedOrigins });
  }
  const run = (candidate: EstimateInput) => {
    const outcome = estimate(candidate, { digest: testDigest });
    if (!outcome.ok) throw new Error(`거절되었다: ${outcome.rejection.code}`);
    return outcome.result;
  };

  it('대조군: 줄·규칙이 모두 OPERATING 이면 운영 구성의 허용 출처로 보류 없이 계산된다', () => {
    const result = run(input({ line: 'OPERATING', rule: 'OPERATING' }, operatingOrigins));
    expect(result.state).not.toBe('ON_HOLD');
    expect(result.holdReasons).toEqual([]);
  });

  it('TEST_FIXTURE 줄은 쓸 수 없다: 모든 줄이 LINE_ORIGIN_NOT_ACCEPTED 로 보류된다', () => {
    const result = run(input({ line: 'TEST_FIXTURE', rule: 'OPERATING' }, operatingOrigins));
    expect(result.state).toBe('ON_HOLD');
    expect(result.holdReasons.map((hold) => hold.code)).toEqual(IDS.map(() => 'LINE_ORIGIN_NOT_ACCEPTED'));
  });

  it('TEST_FIXTURE 프로필·매핑은 쓸 수 없다: 모든 줄이 PROFILE_DEMO 로 보류된다', () => {
    const result = run(input({ line: 'OPERATING', rule: 'TEST_FIXTURE' }, operatingOrigins));
    expect(result.state).toBe('ON_HOLD');
    expect(new Set(result.holdReasons.map((hold) => hold.code))).toEqual(new Set(['PROFILE_DEMO']));
  });

  it('대조군: 같은 TEST_FIXTURE 자료도 시험 구성의 허용 출처로는 보류 없이 계산된다 (위 거절이 허용 출처 때문임을 보인다)', () => {
    const testOrigins = { rules: [...TEST_ACCEPTED_ORIGINS.rules], lines: [...TEST_ACCEPTED_ORIGINS.lines] };
    const result = run(input({ line: 'TEST_FIXTURE', rule: 'TEST_FIXTURE' }, testOrigins));
    expect(result.state).not.toBe('ON_HOLD');
    expect(result.holdReasons).toEqual([]);
  });
});

describe('운영 연결(src/app/services.ts)과 실제 라우트: 운영 데이터가 없으므로 모든 slug 가 404', () => {
  it('getApiServices 는 같은 인스턴스를 돌려주고 허용 출처는 OPERATING 하나다', () => {
    const first = getApiServices();
    expect(getApiServices()).toBe(first);
    expect(first.acceptedOrigins).toEqual({ rules: ['OPERATING'], lines: ['OPERATING'] });
  });

  it('덮어쓰는 훅이 없다: 모듈이 내보내는 것은 getApiServices 하나뿐이다', () => {
    expect(Object.keys(servicesModule)).toEqual(['getApiServices']);
  });

  it('운영 저장소는 비어 있다 (시험 자료가 들어 있지 않다)', () => {
    const repo = getApiServices().repo;
    expect(repo.listClinics()).toEqual([]);
    expect(repo.listRuleBundleVersions()).toEqual([]);
    expect(repo.listAuditLog()).toEqual([]);
  });

  it.each(['test-fixture-clinic-1', 'demo', 'bodam', ''])('catalog: slug %j -> 404 CLINIC_NOT_FOUND, no-store', async (slug) => {
    const result = await callGet(catalogGET, slug, 'catalog');
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'CLINIC_NOT_FOUND' });
    expect(result.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['test-fixture-clinic-1', 'demo', 'bodam', ''])('options: slug %j -> 404 CLINIC_NOT_FOUND, no-store', async (slug) => {
    const result = await callGet(optionsGET, slug, 'insurance/options');
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'CLINIC_NOT_FOUND' });
    expect(result.headers.get('cache-control')).toBe('no-store');
  });

  it('요청을 받은 뒤에도 저장소에 아무것도 쓰이지 않는다', async () => {
    await callGet(catalogGET, 'x', 'catalog');
    await callGet(optionsGET, 'x', 'insurance/options');
    const repo = getApiServices().repo;
    expect(repo.listClinics()).toEqual([]);
    expect(repo.listAuditLog()).toEqual([]);
  });
});
