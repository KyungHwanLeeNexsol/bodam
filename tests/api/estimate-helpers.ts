import { expect } from 'vitest';
import type { MemoryRepository } from '../../src/server/repo/memory/memory-repository';
import { CollectingLog, createTestServices, useTestServices } from '../fixtures/server/api-composition.fixture';
import type { TestServicesOptions } from '../fixtures/server/api-composition.fixture';
import type { EstimateWorld } from '../fixtures/server/estimate-world.fixture';
import type { Called } from './helpers';

// 계산 요청 통합 시험이 공유하는 도우미: 응답 본문의 모양, 시험 구성 지정, 읽기 감시 확인.

export interface LineBody {
  treatmentId: string;
  displayName: string;
  benefitType: string;
  patientAmount: number;
  isBaseFee: boolean;
  origin: string;
  state: string;
  groupKey?: string;
  holdReason?: string;
  exclusionReason?: string;
}

export interface EstimateBody {
  versions: {
    catalogVersion: string;
    ruleBundleVersion: string | null;
    ruleBundleStatus: string | null;
    profile: { id: string; version: string; origin: string } | null;
  };
  origin: string;
  result: {
    state: string;
    amounts: { hospitalPayment: number; baseFeeIncluded: string; expectedInsurancePayout: number | null; expectedOutOfPocketAfterPayout: number | null };
    lines: LineBody[];
    groups: unknown[];
    referenceGroups: unknown[];
    assumptions: string[];
    holdReasons: Array<{ treatmentId: string; code: string }>;
    excludedItems: unknown[];
    basis: unknown;
  };
  documents: {
    state: string;
    mode?: string;
    lines?: Array<{ line: string; required: boolean; scope?: string; reasons?: string[] }>;
    ruleSetId?: string;
    ruleSetVersion?: string;
    origin?: string;
  } | null;
}

export const estimateBody = (called: Called): EstimateBody => called.body as EstimateBody;

/** 세계의 저장소를 시험 구성으로 지정하고 로그 수집기를 돌려준다. */
export function serve(world: EstimateWorld | MemoryRepository, options: Partial<TestServicesOptions> = {}): CollectingLog {
  const log = new CollectingLog();
  const repo = 'world' in world ? world.world.repo : world;
  useTestServices(createTestServices({ repo, log, ...options }));
  return log;
}

/** 응답이 no-store 이고 JSON 이다 (AC-021e). */
export function expectNoStoreJson(called: Called): void {
  expect(called.headers.get('cache-control')).toBe('no-store');
  expect(called.headers.get('content-type')).toBe('application/json');
}

/** 거절 응답: 상태와 본문이 정확히 { error } 하나다. */
export function expectRejection(called: Called, status: number, code: string): void {
  expect(called.status).toBe(status);
  expect(called.body).toEqual({ error: code });
  expectNoStoreJson(called);
}

/** 읽기 감시: 병원 확인(slug 조회, listClinics 한 번)만 일어나고 다른 저장소 읽기는 0이다 (AC-021h~j). */
export function expectOnlySlugLookup(repo: MemoryRepository): void {
  const { listClinics, ...others } = repo.spy.counts;
  expect(listClinics).toBe(1);
  expect(Object.entries(others).filter(([, count]) => count > 0)).toEqual([]);
}

/** 읽기 감시에서 0 이 아닌 항목만 모은다. */
export function nonZeroReads(repo: MemoryRepository): Record<string, number> {
  return Object.fromEntries(Object.entries(repo.spy.counts).filter(([, count]) => count > 0));
}
