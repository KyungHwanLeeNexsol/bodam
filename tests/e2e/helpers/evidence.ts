import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 시험 자료(TEST_FIXTURE). 브라우저 시험이 남기는 측정 증거의 저장 위치 (한 곳).
// 환경 변수 KIOSK_E2E_EVIDENCE_DIR 이 있을 때만 그 폴더 아래에 파일을 쓴다. 없으면(보통의 실행) 아무것도 쓰지 않는다: 시험을 돌려도 저장소에 파일이 생기거나 자라지 않는다.
// 단계 이름 같은 고정 경로는 시험 코드에 두지 않는다 - 증거를 모을 때 실행하는 쪽이 폴더를 정한다 (예: KIOSK_E2E_EVIDENCE_DIR=.moai/state/verify/<이름>).

export const EVIDENCE_DIR_ENV = 'KIOSK_E2E_EVIDENCE_DIR';

/** 증거를 쓸 폴더. 환경 변수가 없거나 비어 있으면 null (쓰지 않는다). */
export function evidenceDir(): string | null {
  const value = process.env[EVIDENCE_DIR_ENV];
  return value === undefined || value.trim() === '' ? null : path.resolve(value);
}

function target(file: string): string | null {
  const dir = evidenceDir();
  if (dir === null) return null;
  const full = path.join(dir, file);
  mkdirSync(path.dirname(full), { recursive: true });
  return full;
}

/** JSONL 파일에 한 줄을 덧붙인다. 증거 폴더가 정해지지 않았으면 아무것도 하지 않는다. */
export function appendEvidence(file: string, record: unknown): void {
  const full = target(file);
  if (full !== null) appendFileSync(full, `${JSON.stringify(record)}\n`);
}

/** JSON 파일 하나를 쓴다(있으면 덮어쓴다). 증거 폴더가 정해지지 않았으면 아무것도 하지 않는다. */
export function writeEvidenceFile(file: string, data: unknown): void {
  const full = target(file);
  if (full !== null) writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`);
}
