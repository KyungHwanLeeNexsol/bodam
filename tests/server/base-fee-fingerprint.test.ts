import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { publishRuleBundle } from '../../src/server/bundle-publish';
import * as coverageTargetModule from '../../src/server/coverage-target';
import { currentCoverageTarget } from '../../src/server/coverage-target';
import type { CommonBaseFee } from '../../src/server/domain/entities';
import { toEngineBaseFeeLine } from '../../src/server/domain/projection';
import * as fingerprintModule from '../../src/server/fingerprint';
import { COMMON_BASE_FEE_JUDGMENT_FIELDS, calcClassOfBaseFee, coverageFingerprint, coverageFingerprintOf, coverageFingerprintOfBaseFee } from '../../src/server/fingerprint';
import { currentTreatmentVersion } from '../../src/server/treatment-current';
import { makeClinic, makeCommonBaseFee, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import {
  BASE_FEE_ID,
  T1,
  approveFeeMapping,
  baseFeeCatalogWorld,
  catalogRequestOf,
  lineOfBaseFee,
  makeBaseFeeVersion,
  publishFeeCatalog,
  publishedBaseFeePath,
} from '../fixtures/server/base-fee.fixture';
import { newRepo, snapshotOf } from '../fixtures/server/repo.fixture';
import { TEST_FIXTURE_RV_PUBLISHER, catalogWorld, publishCatalogOf } from '../fixtures/server/versioning.fixture';

// 공통 기본비용의 지문과 "현재 보장 대상" 조회, 그리고 승인·게시·줄 변환이 같은 함수를 쓴다는 증명 (M3 외부 검토 보완 ①).
// 지문 함수는 대상 종류마다 하나다 (design.md DD-15): 치료는 coverageFingerprintOf, 기본비용은 coverageFingerprintOfBaseFee.
// 현재 보장 대상 조회는 하나다: 승인(approve)·규칙 묶음 게시·그 밖의 호출자는 currentCoverageTarget 만 쓴다.

// 참고용 감시: 같은 모듈 안의 호출은 잡히지 않지만 모듈 사이의 호출(승인 → 조회, 줄 변환 → 지문)은 모두 잡힌다. 래퍼는 원래 함수에 위임한다.
vi.mock('../../src/server/coverage-target', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/server/coverage-target')>();
  return { ...actual, currentCoverageTarget: vi.fn(actual.currentCoverageTarget) };
});
vi.mock('../../src/server/fingerprint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/server/fingerprint')>();
  return { ...actual, coverageFingerprintOfBaseFee: vi.fn(actual.coverageFingerprintOfBaseFee), coverageFingerprintOf: vi.fn(actual.coverageFingerprintOf) };
});

const spiedTarget = vi.mocked(coverageTargetModule.currentCoverageTarget);
const spiedFeeFingerprint = vi.mocked(fingerprintModule.coverageFingerprintOfBaseFee);

const BASE = makeBaseFeeVersion(1);

describe('coverageFingerprintOfBaseFee: 보장 판단 필드는 code 와 benefitType 뿐이다', () => {
  it('닫힌 목록 [not in docs]', () => {
    expect([...COMMON_BASE_FEE_JUDGMENT_FIELDS]).toEqual(['code', 'benefitType']);
  });

  it('기본비용 버전의 모든 필드는 보장 판단 필드이거나 알려진 비판단 필드다 (필드를 늘리면 어느 쪽인지 정해야 한다)', () => {
    const NON_JUDGMENT = ['id', 'baseFeeId', 'clinicId', 'displayName', 'amount', 'origin'];
    expect(Object.keys(BASE).sort()).toEqual([...COMMON_BASE_FEE_JUDGMENT_FIELDS, ...NON_JUDGMENT].sort());
  });

  const NON_JUDGMENT_CHANGES: Array<[string, Partial<CommonBaseFee>]> = [
    ['amount', { amount: 9_999 }],
    ['displayName', { displayName: 'TEST_FIXTURE 다른 이름' }],
    ['origin', { origin: 'DEMO' }],
    ['clinicId', { clinicId: 'TEST_FIXTURE_CLINIC_9' }],
    ['버전 id', { id: 'TEST_FIXTURE_BASE_FEE_A_V9' }],
    ['baseFeeId', { baseFeeId: 'TEST_FIXTURE_BASE_FEE_Z' }],
  ];
  it.each(NON_JUDGMENT_CHANGES)('%s 가 달라도 지문은 같다', (_name, change) => {
    expect(coverageFingerprintOfBaseFee({ ...BASE, ...change })).toBe(coverageFingerprintOfBaseFee(BASE));
  });

  const JUDGMENT_CHANGES: Array<[string, Partial<CommonBaseFee>]> = [
    ['code', { code: 'TEST_FIXTURE_OTHER_CODE' }],
    ['benefitType', { benefitType: 'NON_BENEFIT' }],
  ];
  it.each(JUDGMENT_CHANGES)('%s 가 달라지면 지문도 달라진다', (_name, change) => {
    expect(coverageFingerprintOfBaseFee({ ...BASE, ...change })).not.toBe(coverageFingerprintOfBaseFee(BASE));
  });

  it('분류는 급여 구분에서 정한다: BENEFIT → GENERAL_BENEFIT, NON_BENEFIT → GENERAL_NON_BENEFIT (확인 필요로 두지 않는다)', () => {
    expect(calcClassOfBaseFee('BENEFIT')).toBe('GENERAL_BENEFIT');
    expect(calcClassOfBaseFee('NON_BENEFIT')).toBe('GENERAL_NON_BENEFIT');
  });

  it('지문은 (기본비용 코드, 행위 코드 없음, 급여 구분, 파생 분류) 를 기존 지문 함수에 넣은 값이다 (두 번째 해시 구현이 아니다)', () => {
    for (const benefitType of ['BENEFIT', 'NON_BENEFIT'] as const) {
      const fee = makeBaseFeeVersion(1, { benefitType });
      expect(coverageFingerprintOfBaseFee(fee)).toBe(
        coverageFingerprint({ treatmentCode: fee.code, procedureCodes: [], benefitType, calcClass: benefitType === 'BENEFIT' ? 'GENERAL_BENEFIT' : 'GENERAL_NON_BENEFIT' }),
      );
    }
  });

  it('엔진 줄(toEngineBaseFeeLine)이 싣는 지문과 같다: 승인이 고정하는 값과 줄의 coverageFingerprint 가 한 함수에서 나온다', () => {
    for (const fee of [BASE, makeBaseFeeVersion(2, { benefitType: 'NON_BENEFIT', code: 'TEST_FIXTURE_X' }), makeCommonBaseFee({ id: 'TEST_FIXTURE_FEE_7' })]) {
      expect(toEngineBaseFeeLine(fee).coverageFingerprint).toBe(coverageFingerprintOfBaseFee(fee));
      expect(toEngineBaseFeeLine(fee)).toEqual(lineOfBaseFee(fee));
    }
  });

  it('치료의 지문과 같은 입력이면 같은 값이다 (같은 지문 함수 위에 있다) — 코드와 급여 구분이 같고 행위 코드가 없는 치료 버전', () => {
    const treatment = makeTreatmentVersion({ treatmentCode: BASE.code, procedureCodes: [], benefitType: 'BENEFIT', calcClass: 'GENERAL_BENEFIT' });
    expect(coverageFingerprintOf(treatment)).toBe(coverageFingerprintOfBaseFee(BASE));
  });
});

describe('currentCoverageTarget: 치료 먼저, 기본비용 다음, 둘 다 아니면 null', () => {
  function world() {
    const w = catalogWorld();
    publishCatalogOf(w, catalogRequestOf([BASE]));
    return w;
  }

  it('치료 id → TREATMENT, 현재 치료 버전과 그 지문', () => {
    const w = world();
    const target = currentCoverageTarget(w.repo, T1);
    expect(target).toEqual({ kind: 'TREATMENT', version: makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_1', treatmentId: T1 }), fingerprint: coverageFingerprintOf(makeTreatmentVersion()) });
    expect(target?.kind === 'TREATMENT' ? target.version : null).toEqual(currentTreatmentVersion(w.repo, T1));
  });

  it('기본비용의 안정 식별자 → BASE_FEE, 현재 기본비용 버전과 그 지문', () => {
    const w = world();
    expect(currentCoverageTarget(w.repo, BASE_FEE_ID)).toEqual({ kind: 'BASE_FEE', fee: BASE, fingerprint: coverageFingerprintOfBaseFee(BASE) });
  });

  it('치료도 기본비용도 아닌 id, 기본비용의 버전 id, 빈 저장소 → null', () => {
    const w = world();
    expect(currentCoverageTarget(w.repo, 'TEST_FIXTURE_NO_SUCH_TARGET')).toBeNull();
    expect(currentCoverageTarget(w.repo, BASE.id)).toBeNull(); // 버전 id 는 매핑 대상이 아니다 (안정 식별자만 대상이다)
    expect(currentCoverageTarget(newRepo(), BASE_FEE_ID)).toBeNull();
  });

  it('기본비용: 현재 카탈로그 버전에 든 버전이 가장 나중에 쓴 버전보다 우선한다', () => {
    const w = world();
    const written = makeBaseFeeVersion(2, { code: 'TEST_FIXTURE_BASE_FEE_CODE_CHANGED' });
    w.repo.putCommonBaseFee(written); // 저장소 원시 동작: 카탈로그에는 담기지 않았다
    const target = currentCoverageTarget(w.repo, BASE_FEE_ID);
    expect(target?.kind === 'BASE_FEE' ? target.fee.id : null).toBe(BASE.id);
    publishFeeCatalog(w, [written]);
    const adopted = currentCoverageTarget(w.repo, BASE_FEE_ID);
    expect(adopted?.kind === 'BASE_FEE' ? adopted.fee.id : null).toBe(written.id);
  });

  it('기본비용: 현재 카탈로그에 없으면 쓰기 순서상 가장 나중 버전이다 (카탈로그가 다른 기본비용만 담았거나 카탈로그가 없는 병원)', () => {
    const w = world();
    publishFeeCatalog(w, []); // 현재 카탈로그는 이 기본비용을 담지 않는다
    w.repo.putCommonBaseFee(makeBaseFeeVersion(3, { amount: 7_000 }));
    w.repo.putCommonBaseFee(makeBaseFeeVersion(2, { amount: 6_000 }));
    const latest = currentCoverageTarget(w.repo, BASE_FEE_ID);
    expect(latest?.kind === 'BASE_FEE' ? latest.fee.id : null).toBe(makeBaseFeeVersion(2).id); // 쓰기 순서: V1, V3, V2 → 마지막은 V2

    const noCatalog = newRepo();
    noCatalog.saveClinic(makeClinic());
    noCatalog.putCommonBaseFee(makeBaseFeeVersion(1));
    noCatalog.putCommonBaseFee(makeBaseFeeVersion(2));
    const fallback = currentCoverageTarget(noCatalog, BASE_FEE_ID);
    expect(fallback?.kind === 'BASE_FEE' ? fallback.fee.id : null).toBe(makeBaseFeeVersion(2).id);
  });

  it('저장소를 읽기만 한다', () => {
    const w = world();
    const before = snapshotOf(w.repo);
    currentCoverageTarget(w.repo, T1);
    currentCoverageTarget(w.repo, BASE_FEE_ID);
    currentCoverageTarget(w.repo, 'TEST_FIXTURE_NO_SUCH_TARGET');
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});

describe('승인·규칙 묶음 게시·줄 변환은 같은 공유 함수를 부른다 (호출로 보이는 연결)', () => {
  it('approve() 가 기본비용 매핑의 지문을 고정할 때 currentCoverageTarget 을 부르고, 고정된 값은 그 조회가 낸 지문이다', () => {
    const w = baseFeeCatalogWorld();
    spiedTarget.mockClear();
    const ref = approveFeeMapping(w);
    expect(spiedTarget.mock.calls.filter(([, targetId]) => targetId === BASE_FEE_ID)).toHaveLength(1);
    const returned = spiedTarget.mock.results.find((_result, index) => spiedTarget.mock.calls[index]![1] === BASE_FEE_ID)!.value as ReturnType<typeof currentCoverageTarget>;
    expect(w.repo.getItemState(ref)?.approvedFingerprint).toBe(returned?.fingerprint);
  });

  it('publishRuleBundle() 가 매핑마다 currentCoverageTarget 을 부른다 (기본비용 매핑 포함)', () => {
    const { world, refs } = publishedBaseFeePath('COVERED');
    spiedTarget.mockClear();
    publishRuleBundle(world.deps, TEST_FIXTURE_RV_PUBLISHER, refs);
    expect(spiedTarget.mock.calls.map(([, targetId]) => targetId).sort()).toEqual([BASE_FEE_ID, 'TEST_FIXTURE_TREATMENT_1', 'TEST_FIXTURE_TREATMENT_2'].sort());
  });

  it('toEngineBaseFeeLine() 와 카탈로그 게시의 재검토 전환이 coverageFingerprintOfBaseFee 를 부른다', () => {
    spiedFeeFingerprint.mockClear();
    const line = toEngineBaseFeeLine(BASE);
    expect(spiedFeeFingerprint).toHaveBeenCalledWith(BASE);
    expect(line.coverageFingerprint).toBe(spiedFeeFingerprint.mock.results[0]!.value);

    const { world } = publishedBaseFeePath('COVERED');
    spiedFeeFingerprint.mockClear();
    publishFeeCatalog(world, [makeBaseFeeVersion(2, { amount: 6_000 })]);
    expect(spiedFeeFingerprint.mock.calls.some(([fee]) => (fee as CommonBaseFee).id === makeBaseFeeVersion(2).id)).toBe(true);
  });
});

describe('소스 구조: 지문과 조회의 구현은 하나씩이다', () => {
  const SERVER_DIR = fileURLToPath(new URL('../../src/server', import.meta.url));
  const read = (dir: string): Array<{ file: string; text: string }> =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return read(path);
      return entry.name.endsWith('.ts') ? [{ file: path.slice(SERVER_DIR.length + 1), text: readFileSync(path, 'utf8') }] : [];
    });
  const files = read(SERVER_DIR);
  const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const source = (name: string): string => strip(files.find(({ file }) => file === name)!.text);
  const definitions = (name: string): string[] => files.filter(({ text }) => new RegExp(`function\\s+${name}\\b`).test(strip(text))).map(({ file }) => file);

  it('함수 정의는 각각 한 파일에만 있다', () => {
    expect(definitions('coverageFingerprintOfBaseFee')).toEqual(['fingerprint.ts']);
    expect(definitions('coverageFingerprintOf')).toEqual(['fingerprint.ts']);
    expect(definitions('coverageFingerprint')).toEqual(['fingerprint.ts']);
    expect(definitions('calcClassOfBaseFee')).toEqual(['fingerprint.ts']);
    expect(definitions('currentCoverageTarget')).toEqual(['coverage-target.ts']);
    expect(definitions('triggerReReviewForTarget')).toEqual(['re-review.ts']);
  });

  it('승인과 규칙 묶음 게시는 currentCoverageTarget 만 쓰고 지문·치료 버전 조회를 따로 부르지 않는다', () => {
    for (const file of ['approval.ts', 'bundle-publish.ts']) {
      const text = source(file);
      expect(text, file).toMatch(/\bcurrentCoverageTarget\b/);
      expect(files.find((entry) => entry.file === file)!.text, file).toMatch(/import\s*\{[^}]*\bcurrentCoverageTarget\b[^}]*\}\s*from\s*'\.\/coverage-target'/);
      for (const forbidden of ['currentTreatmentVersion', 'coverageFingerprintOf', 'coverageFingerprintOfBaseFee', 'coverageFingerprint']) {
        expect(text, `${file} 가 ${forbidden} 를 따로 쓴다`).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
      }
    }
  });

  it('줄 변환(projection.ts)은 지문 함수로 지문을 만들고 분류를 자기 안에서 정하지 않는다', () => {
    const text = source('domain/projection.ts');
    expect(text).toMatch(/\bcoverageFingerprintOfBaseFee\b/);
    expect(text).toMatch(/\bcalcClassOfBaseFee\b/);
    expect(text).not.toMatch(/\bcoverageFingerprint\(/);
    expect(text).not.toMatch(/GENERAL_(NON_)?BENEFIT/);
  });

  it('재검토 전환 본문은 하나다: 치료·기본비용 진입점은 모두 triggerReReviewForTarget 에 위임하고 전이 기록은 한 곳에서만 쓴다', () => {
    const text = source('re-review.ts');
    expect(text.match(/recordItemTransition\(/g)).toHaveLength(1);
    expect(text.match(/triggerReReviewForTarget\(/g)!.length).toBeGreaterThanOrEqual(3); // 정의 하나 + 위임 둘
  });

  it('catalog-publish 는 치료 버전과 기본비용 버전 모두에 재검토 전환을 부른다', () => {
    const text = source('catalog-publish.ts');
    expect(text).toMatch(/triggerReReview\(/);
    expect(text).toMatch(/triggerReReviewForBaseFee\(/);
  });
});
