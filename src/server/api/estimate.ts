import { deriveDocuments, selectDocumentRuleSet } from '../../engine/documents';
import { estimate } from '../../engine/estimate';
import { resolveMapping } from '../../engine/resolve';
import type { Cell } from '../../engine/resolve';
import type { UsabilityContext } from '../../engine/usability';
import type { DocumentsResult, EstimateInput, EstimateResult, Origin, PublishedLine, RuleBundleSnapshot } from '../../engine/types';
import { canonicalDigest } from '../digest';
import type { Clinic } from '../domain/entities';
import { ORIGINS } from '../validate/shape';
import { assertBundleStructure, composeBundleSnapshot, loadBundleContent } from './bundle-content';
import { readBundleRef } from './bundle-ref';
import type { BundleRef } from './bundle-ref';
import { SETTING_OF } from './catalog';
import { findClinicBySlug } from './clinic';
import { assertLineAssembly, resolveLines } from './estimate-lines';
import { parseEstimateRequest } from './estimate-request';
import type { EstimateRequest } from './estimate-request';
import { versionMismatchBody, versionsMatch } from './estimate-versions';
import { errorResponse, jsonResponse } from './http';
import { ServerIntegrityError, guarded } from './integrity';
import { readPublishedCatalog } from './published-catalog';
import type { PublishedCatalog } from './published-catalog';
import type { ApiServices } from './services';

// POST /api/clinics/{slug}/estimate (SPEC-REIMBURSEMENT-001 M4.B, design.md DD-19·DD-14·DD-04·DD-06·DD-03, AC-006f·AC-006g·AC-006i·AC-010d·AC-011f·AC-019a~d·AC-020a·AC-021a~c·e·h~m).
//
// 요청 검증의 층 (DD-19 "요청 검증의 층"이 정본이고 앞선 층의 응답 하나만 나간다):
//   0 병원 확인(404) → 1 요청 구조(400) → 2 지원 세대·빈 치료(422) → 3 현재 버전 비교(409) → 4 현재 카탈로그 기준 치료 ID 대조(422) → 5 계산(200)
// 층 0~2 는 서버 데이터를 읽기 전에 거절한다(병원 확인의 slug 조회뿐). 층 3·4 는 카탈로그와 규칙 사용 범위·묶음 가용성만 읽고 항목 상태·묶음 내용은 읽지 않는다.
// 층 5 에서 규칙 사용 범위가 없거나 묶음이 중지(SUSPENDED)이면 묶음 안의 어떤 항목도 읽지 않고 엔진이 보류 결과를 낸다(200 ON_HOLD, 409 아님).
//
// 요청 거절(4xx)은 값으로 돌려주고, 서버 데이터 무결성 결함(저장소 자료가 서로 맞지 않음, 줄 조립 검사 실패, 묶음 구조 결함, 엔진이 서버가 넘긴 입력을 거절)은
// ServerIntegrityError 를 던져 500 INTERNAL_ERROR 로 바뀐다(integrity.ts). 두 종류가 섞이지 않는다.
//
// 이 계층은 엔진의 판정을 대신하지 않는다: 줄·항목 합성은 projection.ts, 계산은 estimate(), 서류는 deriveDocuments()/selectDocumentRuleSet()이다.
// 요청의 원인(cause)은 deriveDocuments 에만 들어가고 estimate() 에는 어디에도 없다(DD-01).

/** 성공 응답 본문 (보류 포함, HTTP 200). */
export interface EstimateResponse {
  versions: {
    catalogVersion: string;
    ruleBundleVersion: string | null;
    ruleBundleStatus: 'ACTIVE' | 'SUSPENDED' | null;
    profile: { id: string; version: string; origin: Origin } | null;
  };
  /** 계산에 쓰인 프로필·매핑·서류 규칙 묶음·줄의 출처 요약 (DD-04). */
  origin: Origin;
  result: EstimateResult;
  documents: DocumentsResult | null;
}

// @MX:NOTE: [AUTO] [문서에 없음] 묶음이 중지(SUSPENDED)이면 항목을 읽지 않으므로 엔진에 넘기는 스냅샷은 id 와 status 만 실제 값이고 내용은 비어 있다.
// 엔진은 isBundleUsable 에서 status 만 보고 모든 줄을 RULE_BUNDLE_SUSPENDED 로 보류하며 contentHash·profiles·mappings·documentRuleSet 을 읽지 않는다(DD-04).
// contentHash 는 묶음 기록을 읽어야 알 수 있는데 중지된 묶음은 어떤 기록도 읽지 않는 것이 계약이라 빈 문자열을 둔다. 응답에는 이 값이 나가지 않는다.
function suspendedSnapshot(id: string): RuleBundleSnapshot {
  return { id, contentHash: '', status: 'SUSPENDED', profiles: [], mappings: [], documentRuleSet: null };
}

/**
 * 병원의 규칙 사용 범위를 엔진 입력의 묶음으로 만든다. 범위가 없으면 null(엔진이 CLINIC_RULE_SCOPE_ABSENT), 중지이면 내용을 읽지 않은 중지 스냅샷,
 * ACTIVE 이면 내용을 읽고(캐시 적중이면 항목 내용을 다시 읽지 않는다, bundle-content.ts) 구조를 검사한 뒤 항목의 현재 상태를 요청마다 한 번 새로 읽어 합성한다.
 */
function readBundle(services: ApiServices, ref: BundleRef): RuleBundleSnapshot | null {
  if (ref.ruleBundleVersionId === null) {
    return null;
  }
  if (ref.ruleBundleStatus === 'SUSPENDED') {
    return suspendedSnapshot(ref.ruleBundleVersionId);
  }
  const content = loadBundleContent(services.repo, ref.ruleBundleVersionId, services.bundleCache);
  assertBundleStructure(content);
  return composeBundleSnapshot(services.repo, content, ref.ruleBundleStatus);
}

/** 서류 산출에 넘기는 치료: 선택한 치료 전부(확인된 제외 포함)의 서류 표시. 공통 기본비용 줄은 넣지 않는다(DD-06). 같은 치료는 한 번이다. */
function documentTreatments(lines: readonly PublishedLine[]): Array<{ documentFlags: PublishedLine['documentFlags'] }> {
  const seen = new Set<string>();
  const out: Array<{ documentFlags: PublishedLine['documentFlags'] }> = [];
  for (const line of lines) {
    if (!seen.has(line.treatmentId)) {
      seen.add(line.treatmentId);
      out.push({ documentFlags: { ...line.documentFlags } });
    }
  }
  return out;
}

// @MX:NOTE: [AUTO] [문서에 없음] 출처 요약의 우선순위(DD-04: OPERATING 이 아닌 것이 하나라도 있으면 그 출처, 여럿이면 TEST_FIXTURE 우선, 다음 DEMO, 모두 OPERATING 이면 OPERATING)는
// 닫힌 열거 목록 ORIGINS(validate/shape.ts, 선언 순서 OPERATING → DEMO → TEST_FIXTURE)의 역순과 같다. 출처 이름은 그 목록 한 곳에만 적는다
// (tests/server/no-seed-paths.test.ts 가 src/server 에서 시험 출처 이름이 나오는 곳을 한 곳으로 지킨다). 선언 순서가 바뀌면 AC-010d 의 혼합 시험이 실패한다.
const SUMMARY_PRECEDENCE: readonly Origin[] = [...ORIGINS].reverse();

// "쓰인 것" = 응답의 모든 줄, 쓰인 프로필(basis.profile), 줄 판정이 끝난 줄(보류가 아닌 줄)에 쓰인 매핑, 산출된 서류 규칙 묶음(documents 가 AVAILABLE).
// origins 는 비어 있지 않다(고른 치료가 1개 이상이라 응답의 줄이 1개 이상이다). 우선순위 목록이 모든 출처를 담으므로 항상 찾는다.
function summarizeOrigin(origins: readonly Origin[]): Origin {
  return SUMMARY_PRECEDENCE.find((origin) => origins.includes(origin)) as Origin;
}

/**
 * 판정이 끝난 줄(ESTIMATED·EXCLUDED_CONFIRMED)에 쓰인 매핑의 출처. 엔진의 결과에는 어느 매핑이 쓰였는지가 없어서 엔진의 resolveMapping 을 같은 인자로 다시 부른다
 * (판단을 새로 만들지 않는다: 같은 함수, 같은 입력). 판정이 끝난 줄인데 매핑이 정해지지 않는다면 엔진 결과와 서버 입력이 어긋난 서버 결함이다.
 */
function usedMappingOrigins(result: EstimateResult, inputLines: readonly PublishedLine[], bundle: RuleBundleSnapshot | null, cell: Cell, ctx: UsabilityContext): Origin[] {
  const decided = result.lines.filter((line) => line.state !== 'ON_HOLD');
  return decided.map((decidedLine) => {
    // 판정이 끝난 줄이 하나라도 있으면 묶음이 있다(묶음이 없거나 중지이면 모든 줄이 보류다, DD-04). 줄은 엔진에 넘긴 줄과 같은 treatmentId 로 찾는다.
    const line = inputLines.find((candidate) => candidate.treatmentId === decidedLine.treatmentId)!;
    const resolution = resolveMapping(line, bundle!, cell, ctx);
    if (!resolution.resolved) {
      throw new ServerIntegrityError('ORIGIN_MAPPING_UNRESOLVED');
    }
    return resolution.mapping.origin;
  });
}

function calculate(services: ApiServices, clinic: Clinic, request: EstimateRequest, published: PublishedCatalog, bundleRef: BundleRef): EstimateResponse {
  const at = services.today();
  const acceptedOrigins = { rules: [...services.acceptedOrigins.rules], lines: [...services.acceptedOrigins.lines] };

  // 줄: 그 병원의 현재 게시 카탈로그에서 만든다. 클라이언트가 보낸 가격·지문·분류는 어디에도 쓰지 않는다. 엔진 앞에서 서버 책임 네 가지를 확인한다.
  const { lines, baseFeeLines } = resolveLines(published, request.treatmentIds);
  assertLineAssembly(request.treatmentIds, lines, baseFeeLines);

  const bundle = readBundle(services, bundleRef);
  const input: EstimateInput = {
    generation: request.generation,
    insurerType: request.insurerType,
    treatmentIds: request.treatmentIds,
    lines,
    baseFeeLines,
    bundle,
    at,
    acceptedOrigins,
  };
  const outcome = estimate(input, { digest: canonicalDigest });
  if (!outcome.ok) {
    // 엔진 거절은 계산 결과가 아니라 거절이다. 서버가 넘긴 입력이 거절됐으므로 서버 결함이고 결과 객체를 만들지 않는다.
    throw new ServerIntegrityError(`ENGINE_${outcome.rejection.code}`);
  }
  const result = outcome.result;

  const ctx: UsabilityContext = { at, acceptedOrigins: acceptedOrigins.rules, digest: canonicalDigest };
  const documents = deriveDocuments({
    overallState: result.state,
    cause: request.cause,
    insurerType: request.insurerType,
    treatments: documentTreatments(lines),
    clinicSetting: SETTING_OF[clinic.institutionType],
    ruleSet: selectDocumentRuleSet(bundle, ctx),
  });

  const profile = result.basis.profile;
  const origins: Origin[] = [
    ...result.lines.map((line) => line.origin),
    ...(profile === null ? [] : [profile.origin]),
    ...(documents !== null && documents.state === 'AVAILABLE' ? [documents.origin] : []),
    ...usedMappingOrigins(result, [...lines, ...baseFeeLines], bundle, { generation: request.generation, insurerType: request.insurerType }, ctx),
  ];

  return {
    versions: {
      catalogVersion: request.catalogVersion,
      ruleBundleVersion: bundleRef.ruleBundleVersionId,
      ruleBundleStatus: bundleRef.ruleBundleStatus,
      profile: profile === null ? null : { id: profile.id, version: profile.version, origin: profile.origin },
    },
    origin: summarizeOrigin(origins),
    result,
    documents,
  };
}

// @MX:ANCHOR: [AUTO] 계산 요청의 단일 처리점. route.ts 의 POST 가 부르고 모든 통합 시험(M4.B~C)이 이 경로를 지난다.
// @MX:REASON: 요청 검증의 층 순서(404 → 400 → 422 → 409 → 422 → 계산)와 "층 0~2 는 서버 데이터를 읽지 않는다", "중지·범위 없음은 항목을 읽지 않는다"는 약속이 이 한 함수에서 지켜진다. 순서가 바뀌면 거절 코드가 어긋난다.
/**
 * route.ts 의 POST 가 부르는 핸들러. readBody 는 요청 본문을 파싱한 JSON 값을 돌려주는 함수다(병원 확인 뒤에 부른다: 없는 병원에는 본문을 읽지도 않는다).
 * 파싱에 실패하면 JSON 이 아닌 본문이므로 400 INVALID_REQUEST 다.
 */
export function handleEstimate(services: ApiServices, slug: string, readBody: () => Promise<unknown>): Promise<Response> {
  return guarded(services.log, async () => {
    // 층 0
    const clinic = findClinicBySlug(services.repo, slug);
    if (clinic === null) {
      return errorResponse('CLINIC_NOT_FOUND');
    }
    // 층 1·2
    let raw: unknown;
    try {
      raw = await readBody();
    } catch {
      return errorResponse('INVALID_REQUEST');
    }
    const parsed = parseEstimateRequest(raw);
    if (!parsed.ok) {
      return errorResponse(parsed.error);
    }
    const request = parsed.request;

    // 층 3: 병원의 현재 카탈로그와 규칙 사용 범위·묶음 가용성을 이 요청 안에서 새로 읽는다.
    const published = readPublishedCatalog(services.repo, clinic);
    const bundleRef = readBundleRef(services.repo, clinic.id);
    if (!versionsMatch(request, published, bundleRef)) {
      return jsonResponse(409, versionMismatchBody(services.repo, clinic, request, published, bundleRef));
    }
    // 층 4
    const publishedIds = new Set(published.treatments.map(({ treatment }) => treatment.id));
    if (request.treatmentIds.some((id) => !publishedIds.has(id))) {
      return errorResponse('TREATMENT_NOT_PUBLISHED');
    }
    // 층 5
    return jsonResponse(200, calculate(services, clinic, request, published, bundleRef));
  });
}
