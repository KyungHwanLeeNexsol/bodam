import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../src/app/api/clinics/[slug]/estimate/route';
import { deriveDocuments, selectDocumentRuleSet } from '../../src/engine/documents';
import { estimate } from '../../src/engine/estimate';
import type { Cause, EstimateInput, Generation, InsurerType, PublishedLine } from '../../src/engine/types';
import { canonicalDigest } from '../../src/server/digest';
import { assignRuleScope } from '../../src/server/rule-scope';
import { ORIGINS } from '../../src/server/validate/shape';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_PO_1 } from '../fixtures/server/actors.fixture';
import { CLINIC_1_SLUG, CLINIC_2_SLUG, TEST_ACCEPTED_ORIGINS, TEST_TODAY, publishSecondClinicCatalog, suspendBundle, useTestServices } from '../fixtures/server/api-composition.fixture';
import { BASE_FEE_ID, T1, T2, independentClinicInput, lineOfBaseFee, makeBaseFeeVersion, publishFeeCatalog } from '../fixtures/server/base-fee.fixture';
import { makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { FULL_HOSPITAL_PAYMENT, ORIGIN_SLOTS, buildWorld, originWorld, requestBody, specOf } from '../fixtures/server/estimate-world.fixture';
import type { EstimateWorld, OriginSlot } from '../fixtures/server/estimate-world.fixture';
import { validCatalogRequest } from '../fixtures/server/publish.fixture';
import { approveSpec, lineOfVersion, publishRefs } from '../fixtures/server/versioning.fixture';
import { estimateBody, expectNoStoreJson, nonZeroReads, serve } from './estimate-helpers';
import type { EstimateBody } from './estimate-helpers';
import { callPost } from './post-helpers';

// 계산 요청 POST /api/clinics/{slug}/estimate 의 계산 경로 (층 5, design.md DD-19·DD-14·DD-04·DD-06).
//   AC-021b (보류도 200), AC-021c (versions·origin), AC-021e (no-store), AC-010d (origin 요약), AC-011f (중지·복구 시나리오),
//   AC-006g (원인만 다르면 result 가 바이트까지 같다), AC-019d (서류 입력), 엔진·서류 산출에 실제로 넘어간 인자.
// 엔진 함수는 실제 함수를 감싼 통과형 감시로 바꿔 끼워 실제 인자를 본다 (판정을 대신하지 않는다).

vi.mock('../../src/app/services', async () => {
  const { activeTestServices } = await import('../fixtures/server/api-composition.fixture');
  return { getApiServices: () => activeTestServices() };
});

vi.mock('../../src/engine/estimate', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/estimate')>();
  return { ...real, estimate: vi.fn(real.estimate) };
});

vi.mock('../../src/engine/documents', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/documents')>();
  return { ...real, deriveDocuments: vi.fn(real.deriveDocuments) };
});

// 공통 기본비용 줄에 서류 표시를 몰래 붙이는 통과형 감시: AC-019d (b) 의 "기본비용 줄만 imaging 표시를 갖는" 입력을 만든다.
const hooks = vi.hoisted(() => ({ baseFeeLine: null as null | ((line: PublishedLine) => PublishedLine) }));
vi.mock('../../src/server/domain/projection', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/server/domain/projection')>();
  return {
    ...real,
    toEngineBaseFeeLine: (fee: Parameters<typeof real.toEngineBaseFeeLine>[0]) => {
      const line = real.toEngineBaseFeeLine(fee);
      return hooks.baseFeeLine === null ? line : hooks.baseFeeLine(line);
    },
  };
});

const estimateSpy = vi.mocked(estimate);
const deriveSpy = vi.mocked(deriveDocuments);

beforeEach(() => {
  useTestServices(null);
  hooks.baseFeeLine = null;
  estimateSpy.mockClear();
  deriveSpy.mockClear();
});

const post = (body: unknown) => callPost(POST, CLINIC_1_SLUG, body);

function ready(plan?: Parameters<typeof buildWorld>[0]): EstimateWorld {
  const w = buildWorld(plan);
  serve(w);
  return w;
}

/** 서비스와 따로 조립한 입력으로 실제 엔진을 불러 얻은 기대값 (같은 엔진 모듈, 다른 조립 경로). */
function expectedFor(w: EstimateWorld, request: Record<string, unknown>): { result: unknown; documents: unknown } {
  const real = { estimate: (estimateSpy.getMockImplementation() ?? estimate) as typeof estimate, derive: (deriveSpy.getMockImplementation() ?? deriveDocuments) as typeof deriveDocuments };
  const input = independentClinicInput(w.world);
  const selected = new Set(request.treatmentIds as string[]);
  const engineInput: EstimateInput = {
    generation: request.generation as Generation,
    insurerType: request.insurerType as InsurerType,
    treatmentIds: [...selected],
    lines: input.lines.filter((line) => selected.has(line.treatmentId)),
    baseFeeLines: input.baseFeeLines,
    bundle: input.bundle,
    at: TEST_TODAY,
    acceptedOrigins: { rules: [...TEST_ACCEPTED_ORIGINS.rules], lines: [...TEST_ACCEPTED_ORIGINS.lines] },
  };
  const outcome = real.estimate(engineInput, { digest: canonicalDigest });
  if (!outcome.ok) {
    throw new Error('TEST_FIXTURE: 기대값을 만들던 엔진이 거절했다');
  }
  const documents = real.derive({
    overallState: outcome.result.state,
    cause: request.cause as Cause,
    insurerType: engineInput.insurerType,
    treatments: engineInput.lines.map((line) => ({ documentFlags: line.documentFlags })),
    clinicSetting: 'OUTPATIENT_ONLY',
    ruleSet: selectDocumentRuleSet(engineInput.bundle, { at: TEST_TODAY, acceptedOrigins: engineInput.acceptedOrigins.rules, digest: canonicalDigest }),
  });
  return { result: outcome.result, documents };
}

describe('AC-021b · AC-021c · AC-021e 성공 응답 (200)', () => {
  it('올바른 요청은 200 이고 no-store 이며 본문은 versions·origin·result·documents 네 키뿐이다', async () => {
    const w = ready();
    const result = await post(requestBody(w));
    expect(result.status).toBe(200);
    expectNoStoreJson(result);
    expect(Object.keys(result.body as object).sort()).toEqual(['documents', 'origin', 'result', 'versions']);
  });

  it('versions: 실제로 쓴 카탈로그 버전, 묶음 버전과 가용성, 프로필 id·버전·출처 (AC-021c)', async () => {
    const w = ready();
    const body = estimateBody(await post(requestBody(w)));
    expect(body.versions).toEqual({
      catalogVersion: w.catalog.id,
      ruleBundleVersion: w.bundle!.id,
      ruleBundleStatus: 'ACTIVE',
      profile: { id: 'TEST_FIXTURE_PROFILE_1', version: 'v1', origin: 'TEST_FIXTURE' },
    });
    expect(Object.keys(body.versions.profile!).sort()).toEqual(['id', 'origin', 'version']);
  });

  it('result 는 서비스와 따로 조립한 입력으로 부른 실제 엔진의 결과와 같다 (병원 결제액 25,000 = 치료 둘 + 공통 기본비용)', async () => {
    const w = ready();
    const expected = expectedFor(w, requestBody(w));
    const body = estimateBody(await post(requestBody(w)));
    expect(body.result).toEqual(expected.result);
    expect(body.documents).toEqual(expected.documents);
    expect(body.result.state).toBe('ESTIMATED');
    expect(body.result.amounts).toEqual({ hospitalPayment: FULL_HOSPITAL_PAYMENT, baseFeeIncluded: 'INCLUDED', expectedInsurancePayout: 24_000, expectedOutOfPocketAfterPayout: 1_000 });
    expect(body.result.lines.map((line) => [line.treatmentId, line.isBaseFee, line.state])).toEqual([
      [BASE_FEE_ID, true, 'ESTIMATED'],
      [T1, false, 'ESTIMATED'],
      [T2, false, 'ESTIMATED'],
    ]);
  });

  it('documents 는 서류 규칙 묶음으로 산출한 9줄이다 (AVAILABLE)', async () => {
    const w = ready();
    const body = estimateBody(await post(requestBody(w, { cause: 'INJURY' })));
    expect(body.documents).toMatchObject({ state: 'AVAILABLE', mode: 'SINGLE_CAUSE', ruleSetId: 'TEST_FIXTURE_DOCUMENT_RULE_SET_1', origin: 'TEST_FIXTURE' });
    expect(body.documents!.lines).toHaveLength(9);
  });

  it('요청은 저장소를 바꾸지 않는다 (전후 전체 상태가 같다)', async () => {
    const w = ready();
    const before = w.world.repo.exportState();
    await post(requestBody(w));
    await post(requestBody(w, { catalogVersion: 'OLD' }));
    await post(requestBody(w, { treatmentIds: ['NO_SUCH'] }));
    expect(w.world.repo.exportState()).toEqual(before);
  });

  it('치료를 하나만 고르면 그 치료와 공통 기본비용만 계산한다 (병원 결제액 15,000)', async () => {
    const w = ready();
    const body = estimateBody(await post(requestBody(w, { treatmentIds: [T1] })));
    expect(body.result.lines.map((line) => line.treatmentId).sort()).toEqual([BASE_FEE_ID, T1]);
    expect(body.result.amounts.hospitalPayment).toBe(15_000);
  });

  it('판정 기준일은 주입한 today() 가 정한다: 유효 기간 밖의 날짜면 규칙 항목을 쓸 수 없어 보류된다', async () => {
    const w = buildWorld();
    serve(w, { today: () => '2027-06-01' });
    const body = estimateBody(await post(requestBody(w)));
    expect(body.result.state).toBe('ON_HOLD');
    expect(body.result.lines.every((line) => line.holdReason === 'PROFILE_INVALID')).toBe(true);
    expect(body.versions.profile).toBeNull();
  });
});

describe('공통 기본비용과 치료 목록의 처리', () => {
  it('등록된 공통 기본비용이 없으면 NOT_REGISTERED 이고 기본비용 줄이 엔진에 가지 않는다', async () => {
    const w = ready({ fees: [], spec: specOf({ mappings: [{ target: T1, kind: 'COVERED' }, { target: T2, kind: 'COVERED' }] }) });
    const body = estimateBody(await post(requestBody(w)));
    expect(body.result.amounts.baseFeeIncluded).toBe('NOT_REGISTERED');
    expect(body.result.amounts.hospitalPayment).toBe(20_000);
    expect(estimateSpy.mock.calls[0]![0].baseFeeLines).toEqual([]);
  });

  it('기본비용은 항상 병원 결제액에 들어간다: 기본비용 매핑이 없어도 T 는 그대로이고 그 줄만 보류된다', async () => {
    const w = ready({ spec: specOf({ mappings: [{ target: T1, kind: 'COVERED' }, { target: T2, kind: 'COVERED' }] }) });
    const body = estimateBody(await post(requestBody(w)));
    expect(body.result.amounts.hospitalPayment).toBe(FULL_HOSPITAL_PAYMENT);
    expect(body.result.state).toBe('ON_HOLD');
    expect(body.result.lines.find((line) => line.treatmentId === BASE_FEE_ID)).toMatchObject({ state: 'ON_HOLD', holdReason: 'MAPPING_ABSENT', isBaseFee: true });
    expect(body.result.amounts.expectedInsurancePayout).toBeNull();
  });

  it('기본비용 가격만 바뀐 새 카탈로그: 기본비용 매핑이 그대로 쓰이고(baseFeeId 가 같다) 새 가격으로 계산한다', async () => {
    const w = ready();
    const next = publishFeeCatalog(w.world, [makeBaseFeeVersion(2, { amount: 7_000 })]);
    const body = estimateBody(await post(requestBody(w, { catalogVersion: next.id })));
    expect(body.result.state).toBe('ESTIMATED');
    expect(body.result.lines.find((line) => line.treatmentId === BASE_FEE_ID)).toMatchObject({ state: 'ESTIMATED', patientAmount: 7_000 });
    expect(body.result.amounts.hospitalPayment).toBe(27_000);
  });

  it('중복된 치료 id 는 한 번만 센다: 엔진에는 요청에 적힌 순서로 중복 없이 넘어가고 결과는 중복이 없는 요청과 같다', async () => {
    const w = ready();
    const dup = await post(requestBody(w, { treatmentIds: [T2, T1, T2, T1] }));
    expect(estimateSpy.mock.calls[0]![0].treatmentIds).toEqual([T2, T1]);
    const plain = await post(requestBody(w, { treatmentIds: [T2, T1] }));
    expect(estimateBody(dup).result).toEqual(estimateBody(plain).result);
    expect(estimateBody(dup).result.amounts.hospitalPayment).toBe(FULL_HOSPITAL_PAYMENT);
  });

  it('수량이라는 개념이 없다: 같은 치료를 여러 번 보내도 금액은 한 번 분이다', async () => {
    const w = ready();
    const once = estimateBody(await post(requestBody(w, { treatmentIds: [T1] })));
    const many = estimateBody(await post(requestBody(w, { treatmentIds: [T1, T1, T1], quantity: 3 })));
    expect(many.result.amounts.hospitalPayment).toBe(once.result.amounts.hospitalPayment);
  });
});

describe('엔진과 서류 산출에 실제로 넘어간 인자 (통과형 감시)', () => {
  it('estimate(): 입력 키는 정해진 여덟 개뿐이고 원인(cause)은 어디에도 없다', async () => {
    const w = ready();
    await post(requestBody(w, { cause: 'ILLNESS' }));
    expect(estimateSpy).toHaveBeenCalledTimes(1);
    const [input, deps] = estimateSpy.mock.calls[0]!;
    expect(Object.keys(input).sort()).toEqual(['acceptedOrigins', 'at', 'baseFeeLines', 'bundle', 'generation', 'insurerType', 'lines', 'treatmentIds']);
    // 원인은 줄·세대·치료 목록 어디에도 없다 (묶음 안의 서류 규칙 데이터가 'cause' 조건을 담는 것은 규칙 내용이고 요청의 원인이 아니다: 세 원인으로 보낸 입력 전체가 같음은 AC-006g 가 본다).
    const { bundle: _rules, ...withoutRules } = input;
    expect(JSON.stringify(withoutRules)).not.toContain('cause');
    expect(JSON.stringify(withoutRules)).not.toContain('ILLNESS');
    expect(typeof deps.digest).toBe('function');
  });

  it('estimate(): 세대·보험사 형태·기준일·허용 출처는 요청과 구성에서 온다', async () => {
    const w = ready();
    await post(requestBody(w, { generation: 'GEN4_C4', insurerType: 'NON_LIFE' }));
    const [input] = estimateSpy.mock.calls[0]!;
    expect(input.generation).toBe('GEN4_C4');
    expect(input.insurerType).toBe('NON_LIFE');
    expect(input.at).toBe(TEST_TODAY);
    expect(input.acceptedOrigins).toEqual({ rules: ['OPERATING', 'TEST_FIXTURE'], lines: ['OPERATING', 'TEST_FIXTURE', 'DEMO'] });
  });

  it('estimate(): 줄은 병원의 현재 게시 데이터에서 만든 것이다 (고른 치료만, 공통 기본비용은 별도 배열)', async () => {
    const w = ready();
    await post(requestBody(w, { treatmentIds: [T1] }));
    const [input] = estimateSpy.mock.calls[0]!;
    const repo = w.world.repo;
    const expectedT1 = lineOfVersion(repo.getTreatmentVersion('TEST_FIXTURE_TV_1')!);
    expect(input.lines).toEqual([expectedT1]);
    expect(input.baseFeeLines).toEqual([lineOfBaseFee(repo.getCommonBaseFee('TEST_FIXTURE_BASE_FEE_A_V1')!)]);
    expect(input.lines.every((line) => !line.isBaseFee)).toBe(true);
    expect(input.baseFeeLines.every((line) => line.isBaseFee)).toBe(true);
  });

  it('estimate(): 묶음 스냅샷의 상태·승인자·지문은 방금 읽은 현재 값이다', async () => {
    const w = ready();
    await post(requestBody(w));
    const [input] = estimateSpy.mock.calls[0]!;
    expect(input.bundle).not.toBeNull();
    expect(input.bundle!.id).toBe(w.bundle!.id);
    expect(input.bundle!.status).toBe('ACTIVE');
    expect(input.bundle!.contentHash).toBe(w.bundle!.contentHash);
    expect(input.bundle!.profiles.map((profile) => [profile.state, profile.approver !== null])).toEqual([['PUBLISHED', true]]);
    expect(input.bundle!.mappings).toHaveLength(3);
    expect(input.bundle!.mappings.every((mapping) => mapping.state === 'PUBLISHED' && mapping.approver !== null && mapping.approvedFingerprint !== '')).toBe(true);
    expect(input.bundle!.documentRuleSet).not.toBeNull();
  });

  it('deriveDocuments(): 원인은 요청의 cause 이고 입력 키는 정해진 다섯 개뿐이다', async () => {
    const w = ready();
    await post(requestBody(w, { cause: 'INJURY' }));
    expect(deriveSpy).toHaveBeenCalledTimes(1);
    const input = deriveSpy.mock.calls[0]![0];
    expect(Object.keys(input).sort()).toEqual(['cause', 'clinicSetting', 'insurerType', 'overallState', 'ruleSet', 'treatments']);
    expect(input.cause).toBe('INJURY');
    expect(input.insurerType).toBe('NON_LIFE');
    expect(input.clinicSetting).toBe('OUTPATIENT_ONLY');
    expect(input.overallState).toBe('ESTIMATED');
    expect(input.ruleSet?.id).toBe('TEST_FIXTURE_DOCUMENT_RULE_SET_1');
  });
});

describe('AC-006g 원인만 다른 세 요청은 result 블록이 바이트까지 같다', () => {
  it('INJURY·ILLNESS·UNKNOWN: result 의 JSON 문자열이 같고, 엔진 입력도 같고, 서류 산출만 원인을 받는다', async () => {
    const w = ready();
    const texts: string[] = [];
    const documents: Array<EstimateBody['documents']> = [];
    for (const cause of ['INJURY', 'ILLNESS', 'UNKNOWN'] as const) {
      const body = estimateBody(await post(requestBody(w, { cause })));
      texts.push(JSON.stringify(body.result));
      documents.push(body.documents);
    }
    expect(texts[1]).toBe(texts[0]);
    expect(texts[2]).toBe(texts[0]);
    const inputs = estimateSpy.mock.calls.map(([input]) => JSON.stringify(input));
    expect(inputs).toHaveLength(3);
    expect(inputs[1]).toBe(inputs[0]);
    expect(inputs[2]).toBe(inputs[0]);
    expect(deriveSpy.mock.calls.map(([input]) => input.cause)).toEqual(['INJURY', 'ILLNESS', 'UNKNOWN']);
    expect(documents[0]).toMatchObject({ mode: 'SINGLE_CAUSE' });
    expect(documents[2]).toMatchObject({ mode: 'UNKNOWN_CAUSE' });
    expect(JSON.stringify(documents[0])).not.toBe(JSON.stringify(documents[1]));
  });
});

describe('AC-019d 서류 산출 입력: 선택한 모든 치료(확인된 제외 포함), 공통 기본비용 줄은 제외', () => {
  const imaging = { imaging: true, biopsy: false, opinionRequired: false };
  const [tv1, tv2] = validCatalogRequest().treatmentVersions as [ReturnType<typeof makeTreatmentVersion>, ReturnType<typeof makeTreatmentVersion>];
  /** T2 가 확인된 제외(EXCLUDED 매핑)이고 영상 표시를 가진 세계. */
  const excludedImagingWorld = (flags = imaging) =>
    ready({
      treatments: [tv1, { ...tv2, documentFlags: flags }],
      spec: specOf({ mappings: [{ target: T1, kind: 'COVERED' }, { target: T2, kind: 'EXCLUDED' }, { target: BASE_FEE_ID, kind: 'COVERED' }] }),
    });
  const imagingLine = (body: EstimateBody) => body.documents!.lines!.find((line) => line.line === 'IMAGING_READING')!;

  it('(a) 확인된 제외 치료만 영상 표시를 가져도 그 서류 줄이 필요하다: 제외된 치료의 표시도 센다', async () => {
    const w = excludedImagingWorld();
    const body = estimateBody(await post(requestBody(w, { cause: 'INJURY' })));
    expect(body.result.state).toBe('ESTIMATED_WITH_EXCLUSIONS');
    expect(body.result.lines.find((line) => line.treatmentId === T2)!.state).toBe('EXCLUDED_CONFIRMED');
    expect(imagingLine(body).required).toBe(true);
    // 대조: 같은 세계에서 표시가 없으면 필요하지 않다.
    const plain = excludedImagingWorld({ imaging: false, biopsy: false, opinionRequired: false });
    expect(imagingLine(estimateBody(await post(requestBody(plain, { cause: 'INJURY' })))).required).toBe(false);
  });

  it('(a) 실제 인자: 서류 산출은 선택한 치료 둘의 서류 표시를 모두 받는다 (제외된 치료 포함, 기본비용 줄 없음)', async () => {
    const w = excludedImagingWorld();
    await post(requestBody(w, { cause: 'INJURY' }));
    const input = deriveSpy.mock.calls[0]![0];
    expect(input.overallState).toBe('ESTIMATED_WITH_EXCLUSIONS');
    expect(input.treatments).toHaveLength(2);
    expect(input.treatments).toContainEqual({ documentFlags: imaging });
    expect(input.treatments).toContainEqual({ documentFlags: { imaging: false, biopsy: false, opinionRequired: false } });
    expect(input.treatments.every((entry) => Object.keys(entry).join() === 'documentFlags')).toBe(true);
  });

  it('(b) 공통 기본비용 줄만 영상 표시를 가져도(통과형 감시로 붙인다) 그 서류 줄은 필요하지 않고 서류 산출 인자에도 기본비용 줄이 없다', async () => {
    hooks.baseFeeLine = (line) => ({ ...line, documentFlags: { imaging: true, biopsy: false, opinionRequired: false } });
    const w = ready();
    const body = estimateBody(await post(requestBody(w, { cause: 'INJURY' })));
    // 감시가 실제로 붙었다: 엔진 입력의 기본비용 줄이 영상 표시를 가졌다.
    expect(estimateSpy.mock.calls[0]![0].baseFeeLines[0]!.documentFlags.imaging).toBe(true);
    expect(imagingLine(body).required).toBe(false);
    const input = deriveSpy.mock.calls[0]![0];
    expect(input.treatments).toHaveLength(2);
    expect(input.treatments.every((entry) => !entry.documentFlags.imaging)).toBe(true);
  });

  it('(c) treatmentIds 의 순서만 바꾼 요청은 documents 가 바이트까지 같다', async () => {
    const w = excludedImagingWorld();
    const a = await post(requestBody(w, { cause: 'UNKNOWN', treatmentIds: [T1, T2] }));
    const b = await post(requestBody(w, { cause: 'UNKNOWN', treatmentIds: [T2, T1] }));
    expect(JSON.stringify(estimateBody(a).documents)).toBe(JSON.stringify(estimateBody(b).documents));
    expect(estimateBody(a).documents).not.toBeNull();
  });

  it('전체가 ON_HOLD 이면 documents 는 null 이다', async () => {
    const w = ready({ spec: specOf({ mappings: [{ target: T1, kind: 'COVERED' }] }) });
    const body = estimateBody(await post(requestBody(w)));
    expect(body.result.state).toBe('ON_HOLD');
    expect(body.documents).toBeNull();
  });

  it('서류 규칙 묶음을 담지 않은 묶음: 금액은 그대로이고 documents 는 RULES_UNAVAILABLE 이다', async () => {
    const w = ready({ spec: specOf({ ruleSetOrigin: null }) });
    const body = estimateBody(await post(requestBody(w)));
    expect(body.result.state).toBe('ESTIMATED');
    expect(body.documents).toEqual({ state: 'RULES_UNAVAILABLE' });
  });
});

describe('AC-021b 보류도 HTTP 200 이다', () => {
  it('매핑이 없는 치료가 있으면 200 ON_HOLD: 병원 결제액은 숫자, 보험금 둘과 documents 는 null', async () => {
    const w = ready({ spec: specOf({ mappings: [{ target: T1, kind: 'COVERED' }, { target: BASE_FEE_ID, kind: 'COVERED' }] }) });
    const result = await post(requestBody(w));
    expect(result.status).toBe(200);
    const body = estimateBody(result);
    expect(body.result.state).toBe('ON_HOLD');
    expect(body.result.amounts).toEqual({ hospitalPayment: FULL_HOSPITAL_PAYMENT, baseFeeIncluded: 'INCLUDED', expectedInsurancePayout: null, expectedOutOfPocketAfterPayout: null });
    expect(body.result.holdReasons).toEqual([{ treatmentId: T2, code: 'MAPPING_ABSENT' }]);
    expect(body.documents).toBeNull();
    expect(body.versions.ruleBundleStatus).toBe('ACTIVE');
    expect(body.versions.profile).toMatchObject({ id: 'TEST_FIXTURE_PROFILE_1' });
  });

  it('칸(세대·보험사 형태)에 프로필이 없으면 200 ON_HOLD PROFILE_ABSENT 이고 versions.profile 은 null 이다', async () => {
    const w = ready();
    const body = estimateBody(await post(requestBody(w, { generation: 'GEN1_AS' })));
    expect(body.result.state).toBe('ON_HOLD');
    expect(new Set(body.result.lines.map((line) => line.holdReason))).toEqual(new Set(['PROFILE_ABSENT']));
    expect(body.versions.profile).toBeNull();
    expect(body.documents).toBeNull();
  });

  it('규칙 사용 범위가 없는 병원: 200 ON_HOLD CLINIC_RULE_SCOPE_ABSENT, 묶음 버전·가용성·프로필이 모두 null, 묶음 안의 어떤 항목도 읽지 않는다', async () => {
    const w = ready({ spec: null });
    w.world.repo.spy.reset();
    const result = await post(requestBody(w));
    expect(result.status).toBe(200);
    const body = estimateBody(result);
    expect(body.versions).toEqual({ catalogVersion: w.catalog.id, ruleBundleVersion: null, ruleBundleStatus: null, profile: null });
    expect(new Set(body.result.lines.map((line) => line.holdReason))).toEqual(new Set(['CLINIC_RULE_SCOPE_ABSENT']));
    expect(body.result.amounts.hospitalPayment).toBe(FULL_HOSPITAL_PAYMENT);
    expect(body.documents).toBeNull();
    const reads = nonZeroReads(w.world.repo);
    for (const itemRead of ['readItemStates', 'getItemVersion', 'getRuleBundleVersion', 'getItemState', 'getBundleStatus']) {
      expect(reads[itemRead], itemRead).toBeUndefined();
    }
  });

  it('묶음이 중지된 병원: 200 ON_HOLD RULE_BUNDLE_SUSPENDED 이고 묶음 안의 어떤 항목도 읽지 않는다', async () => {
    const w = ready();
    suspendBundle(w.world, w.bundle!.id);
    w.world.repo.spy.reset();
    const result = await post(requestBody(w));
    expect(result.status).toBe(200);
    const body = estimateBody(result);
    expect(new Set(body.result.lines.map((line) => line.holdReason))).toEqual(new Set(['RULE_BUNDLE_SUSPENDED']));
    expect(body.versions.profile).toBeNull();
    const reads = nonZeroReads(w.world.repo);
    for (const itemRead of ['readItemStates', 'getItemVersion', 'getRuleBundleVersion', 'getItemState']) {
      expect(reads[itemRead], itemRead).toBeUndefined();
    }
    expect(reads.getBundleStatus).toBe(1);
  });

  it('정상 계산(ACTIVE)의 읽기: 가용성 1회, 항목 상태 읽기 정확히 1회, 묶음 기록 1회, 항목 내용은 항목 수(5)만큼', async () => {
    const w = ready();
    w.world.repo.spy.reset();
    expect((await post(requestBody(w))).status).toBe(200);
    const reads = nonZeroReads(w.world.repo);
    expect(reads.readItemStates).toBe(1);
    expect(reads.getBundleStatus).toBe(1);
    expect(reads.getClinicRuleScope).toBe(1);
    expect(reads.getRuleBundleVersion).toBe(1);
    expect(reads.getItemVersion).toBe(5);
  });
});

describe('AC-010d 응답 origin 은 계산에 쓰인 출처 가운데 OPERATING 이 아닌 것이 하나라도 있으면 OPERATING 이 아니다', () => {
  async function originOf(w: EstimateWorld, overrides: Record<string, unknown> = {}): Promise<string> {
    serve(w);
    return estimateBody(await post(requestBody(w, overrides))).origin;
  }

  it('출처 우선순위는 닫힌 열거 목록 ORIGINS 의 역순이다 (TEST_FIXTURE > DEMO > OPERATING): 열거 목록의 선언 순서를 고정한다', () => {
    expect(ORIGINS).toEqual(['OPERATING', 'DEMO', 'TEST_FIXTURE']);
  });

  it('모두 OPERATING 이면 origin = OPERATING 이다 (서류 규칙 묶음도 쓰였다)', async () => {
    const w = originWorld();
    serve(w);
    const body = estimateBody(await post(requestBody(w)));
    expect(body.origin).toBe('OPERATING');
    expect(body.documents).toMatchObject({ state: 'AVAILABLE', origin: 'OPERATING' });
    expect(body.versions.profile!.origin).toBe('OPERATING');
    expect(body.result.state).toBe('ESTIMATED');
  });

  it.each(ORIGIN_SLOTS.map((slot) => [slot] as const))('%s 만 TEST_FIXTURE 이고 나머지가 OPERATING 이면 origin = TEST_FIXTURE 다', async (slot: OriginSlot) => {
    const w = originWorld({ [slot]: 'TEST_FIXTURE' });
    expect(await originOf(w)).toBe('TEST_FIXTURE');
  });

  it.each([['치료 줄', 'treatments'], ['공통 기본비용 줄', 'baseFee']] as const)('%s 만 DEMO 이면 origin = DEMO 다 (줄 허용 출처는 시험 구성에서 DEMO 를 받는다)', async (_label, slot) => {
    const w = originWorld({ [slot]: 'DEMO' });
    expect(await originOf(w)).toBe('DEMO');
  });

  it('TEST_FIXTURE 와 DEMO 가 섞이면 TEST_FIXTURE 가 우선이다', async () => {
    const w = originWorld({ profile: 'TEST_FIXTURE', treatments: 'DEMO' });
    expect(await originOf(w)).toBe('TEST_FIXTURE');
  });

  it('쓰이지 않은 항목의 출처는 보지 않는다: 고르지 않은 치료의 매핑이 TEST_FIXTURE 여도 origin 은 OPERATING 이다', async () => {
    const w = originWorld({ mappingT2: 'TEST_FIXTURE' });
    expect(await originOf(w, { treatmentIds: [T1] })).toBe('OPERATING');
    expect(await originOf(w, { treatmentIds: [T1, T2] })).toBe('TEST_FIXTURE');
  });

  it('쓰이지 않은 서류 규칙 묶음의 출처는 보지 않는다: 전체가 보류이면 documents 가 null 이라 서류 규칙 묶음은 쓰이지 않았다', async () => {
    const w = originWorld({ ruleSet: 'TEST_FIXTURE' });
    suspendBundle(w.world, w.bundle!.id);
    expect(await originOf(w)).toBe('OPERATING');
  });

  it('묶음이 중지된 응답의 origin 은 줄의 출처로 정해진다 (프로필은 쓰이지 않았다)', async () => {
    const w = originWorld({ treatments: 'TEST_FIXTURE' });
    suspendBundle(w.world, w.bundle!.id);
    expect(await originOf(w)).toBe('TEST_FIXTURE');
  });
});

describe('AC-011f 묶음 중지와 복구 시나리오 (도메인 서비스로 준비하고 공개 계산 API 로 계산한다)', () => {
  it('(1) ESTIMATED (2) 중지 뒤 같은 요청은 409 도 이전 결과의 재사용도 아닌 200 ON_HOLD (3) 새 묶음 게시·재지정 뒤 옛 버전은 409, 새 버전은 ESTIMATED, 다른 병원은 영향이 없다', async () => {
    const w = buildWorld();
    const other = publishSecondClinicCatalog(w.world);
    const otherSpec = specOf({
      idSuffix: '_OTHER',
      mappings: [
        { target: 'TEST_FIXTURE_OTHER_TREATMENT_1', kind: 'COVERED' },
        { target: 'TEST_FIXTURE_FEE_OTHER_1', kind: 'COVERED' },
      ],
    });
    const otherBundle = publishRefs(w.world, approveSpec(w.world, otherSpec));
    assignRuleScope(w.world.deps, TEST_FIXTURE_PO_1, 'TEST_FIXTURE_CLINIC_2', otherBundle.id);
    serve(w);
    const otherRequest = { catalogVersion: other.id, ruleBundleVersion: otherBundle.id, generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds: ['TEST_FIXTURE_OTHER_TREATMENT_1'] };
    const otherBefore = await callPost(POST, CLINIC_2_SLUG, otherRequest);
    expect(estimateBody(otherBefore).result.state).toBe('ESTIMATED');

    // (1)
    const request = requestBody(w);
    const first = estimateBody(await post(request));
    expect(first.result.state).toBe('ESTIMATED');
    expect(first.versions.ruleBundleStatus).toBe('ACTIVE');

    // (2) 같은 입력, 같은 두 버전
    suspendBundle(w.world, w.bundle!.id);
    const second = await post(request);
    expect(second.status).toBe(200);
    const suspended = estimateBody(second);
    expect(suspended.result.state).toBe('ON_HOLD');
    expect(suspended.result.lines.every((line) => line.holdReason === 'RULE_BUNDLE_SUSPENDED')).toBe(true);
    expect(typeof suspended.result.amounts.hospitalPayment).toBe('number');
    expect(suspended.result.amounts.hospitalPayment).toBe(FULL_HOSPITAL_PAYMENT);
    expect(suspended.versions.ruleBundleStatus).toBe('SUSPENDED');
    expect(suspended.versions.ruleBundleVersion).toBe(w.bundle!.id);

    // 병원 B 는 영향이 없다 (응답이 중지 전과 바이트까지 같다).
    expect((await callPost(POST, CLINIC_2_SLUG, otherRequest)).text).toBe(otherBefore.text);

    // (3) 새 묶음 게시 + 병원 A 재지정
    const fresh = publishRefs(w.world, approveSpec(w.world, specOf({ idSuffix: '_B' })));
    assignRuleScope(w.world.deps, TEST_FIXTURE_PO_1, TEST_FIXTURE_CLINIC_ID, fresh.id);
    const stale = await post(request);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: 'VERSION_MISMATCH',
      latest: { ruleBundleVersion: fresh.id, ruleBundleStatus: 'ACTIVE' },
      changes: { ruleChanged: true },
    });
    const renewed = estimateBody(await post(requestBody({ catalog: w.catalog, bundle: fresh })));
    expect(renewed.result.state).toBe('ESTIMATED');
    expect(renewed.versions.ruleBundleVersion).toBe(fresh.id);
    expect((await callPost(POST, CLINIC_2_SLUG, otherRequest)).text).toBe(otherBefore.text);
  });
});
