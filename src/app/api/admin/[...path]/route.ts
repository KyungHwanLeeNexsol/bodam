import { handleAdmin } from '../../../../server/admin/router';
import { getAdminServices } from '../../../admin-services';

// /api/admin/** — 얇은 라우트: 처리와 인증·권한 판정은 src/server/admin 이 한다. 운영 구성은 인증 공급자가 없어 모든 요청이 401 이다(src/app/admin-services.ts).
// Next.js 16 은 params 를 약속(Promise)으로 넘긴다.

type Context = { params: Promise<{ path: string[] }> };

async function dispatch(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  return handleAdmin(getAdminServices(), request, path);
}

export const GET = dispatch;
export const PUT = dispatch;
export const POST = dispatch;
export const DELETE = dispatch;
