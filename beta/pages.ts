// 베타 서버가 직접 만드는 화면 (입장·차단·찾을 수 없음·안내·틀). 키오스크 앱(Next) 화면은 여기서 만들지 않는다.
//  - 서버가 만드는 모든 화면과 브라우저로 여는 키오스크 화면의 맨 위에는 시험 데이터 띠(TEST_NOTICE)가 고정돼 있다(헤더를 위조하는 클라이언트는 띠 없는 앱 문서를 받을 수 있다: 표시 장치이지 보안 통제가 아니다). 키오스크 화면은 앱을 같은 출처의 iframe 에 담은 틀이 이 띠를 맡는다:
//    앱 안의 화면이 어떻게 바뀌어도(계산 중·오류·초기화) 새로고침으로 앱 상태가 지워져도 띠는 같은 자리에 남는다.
//  - 문장은 앱의 결과 화면 배너(COPY.result.testData)와 같아야 한다(시험이 본다).
//  - 이 파일은 병원 자료·검토자 정보·토큰을 담지 않는다. 문구는 모두 고정이다.

export const TEST_NOTICE = '테스트 데이터로 계산한 예시입니다. 실제 보험금 안내에 사용할 수 없습니다.';
export const BETA_LABEL = '손해사정사 검토용 비공개 베타';

export interface Page {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const BASE_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-robots-tag': 'noindex, nofollow',
};

const STYLE = [
  'html,body{margin:0;background:#fff;color:#1f2933}',
  "body{font:400 18px/1.6 'Pretendard','Malgun Gothic','Noto Sans KR',system-ui,sans-serif}",
  '.beta-notice{box-sizing:border-box;width:100%;margin:0;padding:14px 24px;background:#fff4cc;color:#4a2f00;border-bottom:4px solid #b45309;font-weight:700;font-size:24px;line-height:1.4;text-align:center;word-break:keep-all}',
  '.beta-label{margin:0;padding:6px 24px;background:#4a2f00;color:#fff;font-size:15px;text-align:center}',
  'main{max-width:720px;margin:0 auto;padding:24px}',
  'a.scenario,button{display:block;box-sizing:border-box;width:100%;margin:12px 0;padding:16px 20px;border:2px solid #1d4ed8;border-radius:12px;background:#fff;color:#1d4ed8;font:inherit;font-weight:700;text-decoration:none;text-align:left;cursor:pointer}',
  'a.scenario small{display:block;font-weight:400;color:#475569}',
  'input{box-sizing:border-box;width:100%;padding:12px;border:2px solid #94a3b8;border-radius:8px;font:inherit}',
  '.status{min-height:1.6em;color:#b91c1c;font-weight:700}',
].join('');

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shell(title: string, main: string, extraHead = ''): string {
  return [
    '<!doctype html>',
    '<html lang="ko">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    extraHead,
    '</head>',
    '<body>',
    `<p class="beta-notice" role="note" data-test-notice>${TEST_NOTICE}</p>`,
    `<p class="beta-label">${BETA_LABEL}</p>`,
    `<main>${main}</main>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function html(status: number, body: string, csp: string, extra: Record<string, string> = {}): Page {
  return { status, headers: { ...BASE_HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp, ...extra }, body };
}

const CSP_STATIC = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/** 초대 입장 화면. 초대 링크는 `/beta/enter#t=<토큰>` 이다: 토큰은 # 뒤라서 서버 로그·Referer 에 남지 않는다. 직접 붙여 넣을 수도 있다. */
export function enterPage(): Page {
  const main = [
    '<h1>초대받은 검토자 입장</h1>',
    '<p>받으신 초대 링크로 들어오시면 자동으로 입장합니다. 링크가 열리지 않으면 초대 코드를 아래에 붙여 넣어 주세요.</p>',
    '<form id="enter-form" autocomplete="off">',
    '<label for="token">초대 코드</label>',
    '<input id="token" name="token" type="password" autocomplete="off" spellcheck="false" required>',
    '<button type="submit">입장</button>',
    '</form>',
    '<p id="status" class="status" role="status" aria-live="polite"></p>',
  ].join('');
  return html(200, shell('초대 입장 · 보담 베타', main, '<script src="/beta/enter.js" defer></script>'), "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
}

export const ENTER_SCRIPT = `(function () {
  var statusEl = document.getElementById('status');
  var form = document.getElementById('enter-form');
  function say(text) { statusEl.textContent = text; }
  function enter(token) {
    say('확인하는 중입니다…');
    fetch('/beta/enter', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: token }) })
      .then(function (response) {
        if (response.ok) { location.replace('/'); return; }
        say(response.status === 429 ? '시도가 너무 많습니다. 잠시 뒤에 다시 해 주세요.' : '초대 코드가 올바르지 않습니다.');
      })
      .catch(function () { say('연결하지 못했습니다. 잠시 뒤에 다시 해 주세요.'); });
  }
  var match = /(?:^|[#&])t=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (match) { history.replaceState(null, '', location.pathname); enter(match[1]); }
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var value = document.getElementById('token').value.trim();
    if (value !== '') enter(value);
  });
})();
`;

/** 초대 세션이 없을 때(화면 요청). 앱이나 병원 자료를 담지 않는다. */
export function blockedPage(): Page {
  const main = ['<h1>초대가 필요한 화면입니다</h1>', '<p>이 베타는 초대받은 검토자만 볼 수 있습니다. 받으신 초대 링크로 다시 들어와 주세요.</p>', '<p><a href="/beta/enter">초대 입장 화면으로</a></p>'].join('');
  return html(401, shell('초대가 필요합니다 · 보담 베타', main), CSP_STATIC);
}

/** 접속 종료일이 지난 뒤(모든 화면 요청). 앱이나 병원 자료를 담지 않는다. */
export function endedPage(expiresOn: string | null): Page {
  const when = expiresOn === null ? '' : ` (${escapeHtml(expiresOn)}까지)`;
  const main = ['<h1>검토 기간이 끝났습니다</h1>', `<p>이 베타의 접속 기간${when}이 끝나 더 이상 열 수 없습니다.</p>`].join('');
  return html(410, shell('검토 기간 종료 · 보담 베타', main), CSP_STATIC);
}

export function notFoundPage(): Page {
  const main = ['<h1>찾을 수 없는 화면입니다</h1>', '<p>이 베타에는 키오스크 시험 화면만 있습니다.</p>', '<p><a href="/">시험 시나리오 목록으로</a></p>'].join('');
  return html(404, shell('찾을 수 없음 · 보담 베타', main), CSP_STATIC);
}

export interface ScenarioLink {
  slug: string;
  title: string;
  description: string;
}

/** 입장한 검토자의 첫 화면: 시험 시나리오 목록과 나가기. */
export function indexPage(scenarios: readonly ScenarioLink[]): Page {
  const links = scenarios
    .map((scenario) => `<a class="scenario" href="/kiosk/${encodeURIComponent(scenario.slug)}">${escapeHtml(scenario.title)}<small>${escapeHtml(scenario.description)}</small></a>`)
    .join('');
  const main = [
    '<h1>보담 키오스크 시험 화면</h1>',
    '<p>아래 시나리오를 눌러 키오스크 화면을 처음부터 끝까지 확인해 주세요. 모든 자료는 시험용 가짜 값이며 실제 병원·환자 자료가 아닙니다.</p>',
    links,
    '<form method="post" action="/beta/leave"><button type="submit">검토 마치고 나가기</button></form>',
  ].join('');
  return html(200, shell('시험 시나리오 · 보담 베타', main), CSP_STATIC);
}

/** 키오스크 화면을 담는 틀: 시험 데이터 띠 + 앱(같은 출처 iframe). innerUrl 은 요청 경로 그대로다(쿼리 없음). */
export function kioskFramePage(innerUrl: string): Page {
  const body = [
    '<!doctype html>',
    '<html lang="ko">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    '<title>보담 (시험 베타)</title>',
    '<style>',
    'html,body{height:100%;margin:0;background:#fff}',
    'body{display:flex;flex-direction:column;overflow:hidden}',
    // 어두운 갈색 글자 / 연한 노란 바탕: 대비 약 9:1. 줄이 길어지면 줄바꿈으로 늘어나고 잘리지 않는다.
    ".beta-notice{flex:none;box-sizing:border-box;width:100%;margin:0;padding:14px 24px;background:#fff4cc;color:#4a2f00;border-bottom:4px solid #b45309;font:700 28px/1.4 'Pretendard','Malgun Gothic','Noto Sans KR',system-ui,sans-serif;text-align:center;word-break:keep-all}",
    '.beta-app{flex:1 1 auto;min-height:0;width:100%;border:0;display:block;background:#fff}',
    '</style>',
    '</head>',
    '<body>',
    `<p class="beta-notice" role="note" data-test-notice>${TEST_NOTICE}</p>`,
    `<iframe class="beta-app" title="보담" src="${escapeHtml(innerUrl)}"></iframe>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
  return html(200, body, "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; frame-ancestors 'none'");
}
