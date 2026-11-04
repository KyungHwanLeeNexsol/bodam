import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/app/kiosk/view/copy';
import { TEST_NOTICE, previewFrameHtml } from '../../e2e/harness/notice';

// 미리보기 고정 안내 띠 (SPEC-REIMBURSEMENT-001 M6, 2026-11-04): 앞단 서버(tests/e2e/harness)가 만드는 것이고 운영 코드(src/)에는 없다.

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('미리보기 고정 안내', () => {
  it('앞단의 안내 문장은 앱 결과 화면의 시험 데이터 배너 문장과 같다 (소유자 지시 문장)', () => {
    expect(TEST_NOTICE).toBe('테스트 데이터로 계산한 예시입니다. 실제 보험금 안내에 사용할 수 없습니다.');
    expect(TEST_NOTICE).toBe(COPY.result.testData);
  });

  it('틀은 안내 띠 하나와 앱 iframe 하나로 이루어지고, 앱 주소는 쿼리 없이 요청 경로 그대로다', () => {
    const html = previewFrameHtml('/kiosk/test-fixture-clinic-1');
    expect(html.match(/data-test-notice/g)).toHaveLength(1);
    expect(html.match(/<iframe/g)).toHaveLength(1);
    expect(html).toContain('src="/kiosk/test-fixture-clinic-1"');
    expect(html).toContain(`>${TEST_NOTICE}</p>`);
    // 틀은 스크립트도 저장소 접근도 없다: 세션 값을 다루지 않는다.
    expect(html).not.toMatch(/<script|localStorage|sessionStorage|indexedDB|document\.cookie/);
  });

  it('요청 경로의 따옴표·꺾쇠는 속성에서 이스케이프된다 (앞단이 임의 경로로 마크업을 깨지 않는다)', () => {
    const html = previewFrameHtml('/kiosk/a"b<c>&d');
    expect(html).toContain('src="/kiosk/a&quot;b&lt;c&gt;&amp;d"');
    expect(html.match(/<iframe/g)).toHaveLength(1);
  });

  it('운영 코드(src/)에는 안내 띠·앞단 틀·--test-notice 가 없다 (시험 전용 안내는 앞단에만 있다)', () => {
    const offenders = sourceFiles('src')
      .filter((path) => /\.(ts|tsx|css|mjs|js)$/.test(path))
      .filter((path) => /data-test-notice|test-notice|preview-notice|harness\/notice|previewFrameHtml/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
