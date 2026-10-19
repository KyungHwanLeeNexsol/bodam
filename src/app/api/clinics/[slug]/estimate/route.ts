import { handleEstimate } from '../../../../../server/api/estimate';
import { getApiServices } from '../../../../services';

// POST /api/clinics/{slug}/estimate — 얇은 라우트: Next.js 16 은 params 를 약속(Promise)으로 넘긴다. 처리는 src/server 의 핸들러가 한다.
// 요청에서 읽는 것은 본문(json())뿐이다: 헤더·쿼리·URL 은 읽지 않는다. 본문 파싱은 병원 확인 뒤에 핸들러가 부른다(없는 병원에는 본문을 읽지 않는다).
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await context.params;
  return handleEstimate(getApiServices(), slug, () => request.json() as Promise<unknown>);
}
