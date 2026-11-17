import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EVIDENCE_DIR_ENV, appendEvidence, appendEvidenceLine, evidenceDir, resetEvidenceFile, writeEvidenceFile } from '../../e2e/helpers/evidence';

// 브라우저 시험의 증거 파일 (F6): 저장 위치는 환경 변수 KIOSK_E2E_EVIDENCE_DIR 한 곳이고, 정해지지 않으면 아무것도 쓰지 않는다.
// 시험 코드에 단계 이름이 박힌 경로(.moai/state/verify/...)가 없고, 평범한 실행이 저장소에 파일을 만들거나 키우지 않는다.

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const saved = process.env[EVIDENCE_DIR_ENV];
const made: string[] = [];

afterEach(() => {
  if (saved === undefined) delete process.env[EVIDENCE_DIR_ENV];
  else process.env[EVIDENCE_DIR_ENV] = saved;
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)]));
}

describe('증거 파일 쓰기 도구 (tests/e2e/helpers/evidence.ts)', () => {
  it('환경 변수가 없으면 쓰지 않는다 (폴더도 만들지 않는다)', () => {
    delete process.env[EVIDENCE_DIR_ENV];
    expect(evidenceDir()).toBeNull();
    const probe = join(mkdtempSync(join(tmpdir(), 'kiosk-evidence-')), 'never');
    made.push(join(probe, '..'));
    appendEvidence('a/b.jsonl', { x: 1 });
    writeEvidenceFile('a/c.json', { x: 1 });
    expect(existsSync(probe)).toBe(false);
    expect(readdirSync(join(probe, '..'))).toEqual([]);
  });

  it('빈 값이어도 쓰지 않는다', () => {
    process.env[EVIDENCE_DIR_ENV] = '   ';
    expect(evidenceDir()).toBeNull();
  });

  it('환경 변수가 있으면 그 폴더 아래에 JSONL 은 덧붙이고 JSON 은 쓴다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kiosk-evidence-'));
    made.push(dir);
    process.env[EVIDENCE_DIR_ENV] = dir;
    appendEvidence('contrast/c.jsonl', { n: 1 });
    appendEvidence('contrast/c.jsonl', { n: 2 });
    writeEvidenceFile('exposure/e.json', { ok: true });
    expect(readFileSync(join(dir, 'contrast/c.jsonl'), 'utf8')).toBe('{"n":1}\n{"n":2}\n');
    expect(JSON.parse(readFileSync(join(dir, 'exposure/e.json'), 'utf8'))).toEqual({ ok: true });
    expect(listFiles(dir).map((file) => relative(dir, file).replace(/\\/g, '/')).sort()).toEqual(['contrast/c.jsonl', 'exposure/e.json']);
  });
});

describe('실행 기록(텍스트) 쓰기 도구 (M7 묶음 구성 시험이 쓴다)', () => {
  it('환경 변수가 없으면 쓰지 않는다', () => {
    delete process.env[EVIDENCE_DIR_ENV];
    const probe = join(mkdtempSync(join(tmpdir(), 'kiosk-evidence-')), 'never');
    made.push(join(probe, '..'));
    resetEvidenceFile('x/log.txt');
    appendEvidenceLine('x/log.txt', '한 줄');
    expect(existsSync(probe)).toBe(false);
    expect(readdirSync(join(probe, '..'))).toEqual([]);
  });

  it('환경 변수가 있으면 한 줄씩 덧붙이고, 비우면 처음부터 다시 쓴다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kiosk-evidence-'));
    made.push(dir);
    process.env[EVIDENCE_DIR_ENV] = dir;
    appendEvidenceLine('log.txt', '첫 줄');
    appendEvidenceLine('log.txt', '둘째 줄');
    expect(readFileSync(join(dir, 'log.txt'), 'utf8')).toBe('첫 줄\n둘째 줄\n');
    resetEvidenceFile('log.txt');
    expect(readFileSync(join(dir, 'log.txt'), 'utf8')).toBe('');
    appendEvidenceLine('log.txt', '다시');
    expect(readFileSync(join(dir, 'log.txt'), 'utf8')).toBe('다시\n');
  });
});

describe('커밋된 브라우저 시험 코드', () => {
  it('증거 폴더 경로(.moai/state/verify)나 파일 쓰기를 직접 갖지 않는다 (evidence.ts 한 곳만 쓴다)', () => {
    const files = listFiles(join(REPO, 'tests/e2e')).filter((file) => /\.ts$/.test(file) && !/helpers[\\/]evidence\.ts$/.test(file));
    expect(files.length).toBeGreaterThan(0);
    const found = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        // 주석 줄은 설명일 뿐이다.
        .filter(({ line }) => !/^\s*(\/\/|\/\*|\*)/.test(line) && /\.moai\/state\/verify|appendFileSync|writeFileSync/.test(line))
        .map(({ number }) => `${relative(REPO, file).replace(/\\/g, '/')}:${String(number)}`),
    );
    expect(found).toEqual([]);
  });
});
