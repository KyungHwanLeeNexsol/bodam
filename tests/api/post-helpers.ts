import type { Called } from './helpers';

// 계산 요청(POST) 통합 시험 도우미. 실제 route.ts 의 POST 를 Next.js 가 부르는 모양(요청 + params 약속)으로 부른다.

export type PostHandler = (request: Request, context: { params: Promise<{ slug: string }> }) => Promise<Response>;

async function readResponse(response: Response): Promise<Called> {
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: JSON.parse(text) as unknown };
}

/** 본문 문자열을 그대로 싣는다 (JSON 이 아닌 본문 시험). null 이면 본문이 없다. */
export async function callPostRaw(handler: PostHandler, slug: string, rawBody: string | null): Promise<Called> {
  const init: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' } };
  if (rawBody !== null) {
    init.body = rawBody;
  }
  return readResponse(await handler(new Request(`http://localhost/api/clinics/${encodeURIComponent(slug)}/estimate`, init), { params: Promise.resolve({ slug }) }));
}

/** JSON 으로 직렬화한 본문을 싣는다. */
export function callPost(handler: PostHandler, slug: string, body: unknown): Promise<Called> {
  return callPostRaw(handler, slug, JSON.stringify(body));
}

/**
 * 본문 읽기를 직접 정하는 요청 (필드 접근 감시 시험). 핸들러는 요청의 `json()` 만 부르므로 `json()` 이 감시용 객체를 돌려주게 한다.
 * 핸들러가 `json()` 이외의 것(헤더·url·본문 스트림)을 읽으면 이 요청 대역은 던진다.
 */
export async function callPostWithJson(handler: PostHandler, slug: string, json: () => Promise<unknown>): Promise<Called> {
  const forbidden = (name: string) => () => {
    throw new Error(`TEST_FIXTURE: 요청의 ${name} 는 읽으면 안 된다`);
  };
  const fake = new Proxy(
    { json },
    {
      get(target, property) {
        if (property === 'json') return target.json;
        return forbidden(String(property))();
      },
    },
  ) as unknown as Request;
  return readResponse(await handler(fake, { params: Promise.resolve({ slug }) }));
}
