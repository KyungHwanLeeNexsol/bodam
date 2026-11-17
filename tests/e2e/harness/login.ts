import { TEST_ACCOUNTS } from '../../fixtures/server/admin.fixture';
import type { TestAccountKey } from '../../fixtures/server/admin.fixture';
import { TEST_NOTICE } from './notice';

// 시험 로그인 화면 (SPEC-REIMBURSEMENT-001 M7 첫 기능, 시험 앞단 전용). 관리자 인증 공급자가 정해지지 않아(plan.md §E #2) 로컬 미리보기에서 시험 계정으로 들어가는 길이다.
//  - 이 화면과 POST /__harness/login 은 tests/e2e/harness 에만 있다. src/ 에는 시험 로그인도 기본 관리자도 없고, 운영 구성의 인증기는 어떤 요청도 인증하지 않는다.
//  - 계정을 고르면 앞단이 서버 쪽 세션 표(TestAdminAuthenticator)에 세션을 만들고 HttpOnly 쿠키로 토큰을 내려 준다. 관리자 API 의 판정은 이 쿠키가 가리키는 세션의 신원(사용자·소속)으로만 한다.
//  - 계정은 모두 TEST_FIXTURE 가짜 주체이며 실제 운영 계정이 아니다.

export const ACCOUNT_KEYS = Object.keys(TEST_ACCOUNTS) as TestAccountKey[];

/**
 * 로그인 직후 들어갈 화면. 플랫폼 단위 검토 담당자(RV, 병원에 묶이지 않은 소속)는 검토 대기열, 플랫폼 단위 운영자(PO)는 규칙 사용 범위(M7 묶음 구성)로 들어간다.
 * 나머지 계정(병원 소속 HA · 병원에 매인 RV)은 소속 병원의 가격 관리로 들어간다. 여러 플랫폼 역할이 있으면 RV 가 먼저다(시험 계정에는 없다).
 */
export function accountHome(key: TestAccountKey): string {
  const account = TEST_ACCOUNTS[key];
  if (account.memberships.some((membership) => membership.role === 'RV' && membership.clinicId === null)) return '/admin/review-queue';
  if (account.memberships.some((membership) => membership.role === 'PO' && membership.clinicId === null)) return '/admin/rule-scope';
  return `/admin/${encodeURIComponent(account.home)}/treatments`;
}

export function loginPageHtml(): string {
  const buttons = ACCOUNT_KEYS.map((key) => {
    const account = TEST_ACCOUNTS[key];
    return `<li><form method="post" action="/__harness/login"><input type="hidden" name="account" value="${key}"><button type="submit" data-test-account="${key}">${account.label}</button></form></li>`;
  }).join('\n');
  return [
    '<!doctype html>',
    '<html lang="ko">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>보담 관리자 시험 로그인</title>',
    '<style>',
    "body{margin:0;font:16px/1.5 'Pretendard','Malgun Gothic',system-ui,sans-serif;color:#0f172a;background:#f8fafc}",
    '.band{margin:0;padding:14px 24px;background:#fff4cc;color:#4a2f00;border-bottom:4px solid #b45309;font-weight:700;text-align:center}',
    'main{max-width:640px;margin:32px auto;padding:0 24px}',
    'ul{list-style:none;padding:0;display:flex;flex-direction:column;gap:12px}',
    'button{min-height:48px;width:100%;padding:8px 16px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;font:inherit;font-weight:700;cursor:pointer}',
    'button:focus-visible{outline:3px solid #2563eb;outline-offset:2px}',
    'p{color:#475569}',
    '</style></head>',
    '<body>',
    `<p class="band" role="note" data-test-notice>${TEST_NOTICE}</p>`,
    '<main>',
    '<h1>보담 관리자 시험 로그인</h1>',
    '<p>시험 계정을 고르면 이 미리보기 서버에서만 유효한 세션이 만들어집니다. 운영 환경에는 이 화면이 없고, 인증 공급자가 연결되기 전에는 관리자 기능을 쓸 수 없습니다.</p>',
    '<ul>',
    buttons,
    '</ul>',
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
