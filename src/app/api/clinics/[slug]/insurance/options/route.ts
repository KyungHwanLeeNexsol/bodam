import { handleOptions } from '../../../../../../server/api/options';
import { getApiServices } from '../../../../../services';

// GET /api/clinics/{slug}/insurance/options — 얇은 라우트: Next.js 16 은 params 를 약속(Promise)으로 넘긴다. 처리는 src/server 의 핸들러가 한다.
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await context.params;
  return handleOptions(getApiServices(), slug);
}
