// 시험 자료(TEST_FIXTURE). 시험용 앞단 서버가 미리보기에서 화면 전환과 상관없이 늘 보여 주는 고정 안내 (SPEC-REIMBURSEMENT-001 M6, 2026-11-04 소유자 지시).
//  - 키오스크 앱(src/)은 이 파일을 가져오지 않고 이 안내를 만들지도 않는다. 앞단 서버가 문서 요청에 한해 "안내 띠 + 앱을 담은 틀(iframe)"을 돌려준다.
//    그래서 계산 응답이 오기 전·통신 오류·초기화·이용 완료처럼 앱 안의 화면이 어떻게 바뀌어도, 새로고침으로 앱 상태가 지워져도 안내는 같은 자리에 남는다.
//  - 운영 구성(next start 를 앞단 없이 그대로 연 것)에는 이 띠가 없다. 운영 API 에 출처 필드를 더하거나 시험용 우회 설정을 두지 않는다.
//  - 문장은 앱의 결과 화면 배너(COPY.result.testData)와 같아야 한다. tests/kiosk/static/preview-notice.test.ts 가 둘이 같은지 본다.

export const TEST_NOTICE = '테스트 데이터로 계산한 예시입니다. 실제 보험금 안내에 사용할 수 없습니다.';

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 앱을 담은 틀. innerUrl 은 브라우저가 요청한 경로 그대로다(쿼리를 더하지 않는다). 틀 자신은 어떤 세션 값도 담지 않는다. */
export function previewFrameHtml(innerUrl: string): string {
  return [
    '<!doctype html>',
    '<html lang="ko">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>보담 (시험 미리보기)</title>',
    '<style>',
    'html,body{height:100%;margin:0;background:#fff}',
    'body{display:flex;flex-direction:column;overflow:hidden}',
    // 어두운 갈색 글자 / 연한 노란 바탕: 대비 약 9:1. 줄이 길어지면 줄바꿈으로 늘어나고 잘리지 않는다.
    '.preview-notice{flex:none;box-sizing:border-box;width:100%;margin:0;padding:14px 24px;background:#fff4cc;color:#4a2f00;border-bottom:4px solid #b45309;',
    "font:700 28px/1.4 'Pretendard','Malgun Gothic','Noto Sans KR',system-ui,sans-serif;text-align:center;word-break:keep-all}",
    '.preview-app{flex:1 1 auto;min-height:0;width:100%;border:0;display:block;background:#fff}',
    '</style>',
    '</head>',
    '<body>',
    `<p class="preview-notice" role="note" data-test-notice>${TEST_NOTICE}</p>`,
    `<iframe class="preview-app" title="보담" src="${escapeAttribute(innerUrl)}"></iframe>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
