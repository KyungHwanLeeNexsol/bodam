// Next.js 설정 (SPEC-REIMBURSEMENT-001 M6, BRIEF D1, AC-021g).
// 키오스크 문서(/kiosk/{clinicSlug})와 관리자 문서(/admin/…)는 Cache-Control: no-store 로 내려보낸다: 브라우저·중간 캐시가 화면을 저장하지 않고, 뒤로 가기로 이전 환자의 화면이 다시 보이지 않게 한다.
// 계산 응답·options 응답의 no-store 는 API 쪽(src/server/api/http.ts, AC-021e)이 이미 가진다.

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/kiosk/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        // 관리자 문서(M7)도 저장하지 않는다: 병원 가격·초안이 공유 PC 의 캐시에 남지 않게 한다. 관리자 API 응답의 no-store 는 API 쪽(src/server/api/http.ts)이 가진다.
        source: '/admin/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

export default nextConfig;
